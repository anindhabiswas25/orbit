// run-demo.js — drives the live Orbit yield demo on Fuji.
//
// What it does, each cycle:
//   1. Moves the APYs on MockPoolA / MockPoolB so a NEW pool becomes the best yield.
//   2. Triggers a scout cycle on the engine (respecting the 60s SCOUT_INTERVAL).
//   3. The running scout/executor agents react: the winning scout posts the best
//      protocol and earns +1 rep; the engine assigns the executor, which rebalances
//      the vault into that pool and earns +1 rep.
//   4. Prints the live reputation leaderboard + vault state after each cycle.
//
// This is how the demo agents earn REAL reputation and visibly chase the best yield.
//
// PREREQUISITES (in separate terminals, before running this):
//   - npm run register-demo            # 2 scouts + 1 executor registered
//   - vault funded                     # npm run seed
//   - the 3 agent processes running:
//       AGENT_PRIVATE_KEY=$DEMO_AGENT_A_KEY AGENT_NAME=ReliableScout  npm run scout
//       AGENT_PRIVATE_KEY=$DEMO_AGENT_B_KEY AGENT_NAME=FastScout      npm run scout
//       AGENT_PRIVATE_KEY=$DEMO_AGENT_C_KEY AGENT_NAME=PrimeExecutor  npm run executor
//
// Run: npx hardhat run scripts/run-demo.js --network fuji   (or: npm run demo)
// Optional: DEMO_CYCLES=6 npm run demo

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');
require('dotenv').config();

const SCOUT_INTERVAL = 60;                          // engine constant (seconds)
const SETTLE_MS      = 35_000;                      // time to let agents complete a cycle
const CYCLES         = parseInt(process.env.DEMO_CYCLES || '4', 10);

// Each cycle moves the winning pool. (bps: 1800 = 18.00%)
const APY_PLAN = [
  { MockPoolA: 1800, MockPoolB: 500  },   // A wins
  { MockPoolA: 600,  MockPoolB: 2100 },   // B wins  -> rebalance
  { MockPoolA: 2400, MockPoolB: 900  },   // A wins  -> rebalance
  { MockPoolA: 700,  MockPoolB: 2600 },   // B wins  -> rebalance
  { MockPoolA: 3000, MockPoolB: 1100 },   // A wins  -> rebalance
  { MockPoolA: 800,  MockPoolB: 3200 },   // B wins  -> rebalance
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct   = (bps) => `${(Number(bps) / 100).toFixed(2)}%`;
const usd   = (raw) => `${(Number(raw) / 1e6).toFixed(2)} USDC`;

const DEMO_WALLETS = [
  { name: 'ReliableScout', addr: addrOf(process.env.DEMO_AGENT_A_KEY) },
  { name: 'FastScout',     addr: addrOf(process.env.DEMO_AGENT_B_KEY) },
  { name: 'PrimeExecutor', addr: addrOf(process.env.DEMO_AGENT_C_KEY) },
];

function addrOf(key) {
  try { return key ? new ethers.Wallet(key).address : null; } catch { return null; }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider   = deployer.provider;

  const engineABI   = (await ethers.getContractFactory('AgentSelectionEngine')).interface;
  const yieldRegABI = (await ethers.getContractFactory('YieldRegistry')).interface;
  const vaultABI    = (await ethers.getContractFactory('YieldVault')).interface;
  const registryABI = (await ethers.getContractFactory('AgentRegistry')).interface;
  const poolABI     = ['function setAPY(uint256) external', 'function getAPY() view returns (uint256)'];

  const engine   = new ethers.Contract(ADDRESSES.AgentSelectionEngine, engineABI,   deployer);
  const yieldReg = new ethers.Contract(ADDRESSES.YieldRegistry,        yieldRegABI, deployer);
  const vault    = new ethers.Contract(ADDRESSES.YieldVault,           vaultABI,    deployer);
  const registry = new ethers.Contract(ADDRESSES.AgentRegistry,        registryABI, deployer);
  const poolA    = new ethers.Contract(ADDRESSES.MockPoolA, poolABI, deployer);
  const poolB    = new ethers.Contract(ADDRESSES.MockPoolB, poolABI, deployer);

  const POOL_NAME = {
    [ADDRESSES.MockPoolA.toLowerCase()]: 'MockPoolA',
    [ADDRESSES.MockPoolB.toLowerCase()]: 'MockPoolB',
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Live Yield Demo (Fuji)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Keeper (owner): ${deployer.address}`);
  console.log(`  Cycles:         ${CYCLES}`);

  // Pre-flight: vault must hold funds, else there is nothing to rebalance.
  const startBalance = await vault.getVaultBalance();
  console.log(`  Vault balance:  ${usd(startBalance)}`);
  if (startBalance === 0n) {
    throw new Error('Vault is empty — seed it first:  npm run seed');
  }
  console.log('');

  for (let i = 0; i < CYCLES; i++) {
    const plan = APY_PLAN[i % APY_PLAN.length];
    const winner = plan.MockPoolA >= plan.MockPoolB ? 'MockPoolA' : 'MockPoolB';

    console.log(`\n━━━ CYCLE ${i + 1}/${CYCLES} ━━━`);
    console.log(`  Setting APYs → MockPoolA ${pct(plan.MockPoolA)} | MockPoolB ${pct(plan.MockPoolB)}  (target: ${winner})`);
    await (await poolA.setAPY(plan.MockPoolA)).wait();
    await (await poolB.setAPY(plan.MockPoolB)).wait();

    // Respect the engine's 60s minimum between scout cycles.
    await waitForScoutWindow(engine);

    console.log('  → triggerScoutCycle()');
    try {
      await (await engine.triggerScoutCycle()).wait();
    } catch (err) {
      console.log(`    (skipped: ${err.shortMessage || err.message})`);
    }

    console.log(`  ⏳ waiting ${SETTLE_MS / 1000}s for scout + executor to complete...`);
    await sleep(SETTLE_MS);

    await report(engine, yieldReg, vault, registry, POOL_NAME);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✓ Demo run complete. Final standings:');
  await report(engine, yieldReg, vault, registry, POOL_NAME);
  console.log('\nWatch it live in the dashboard (npm run backend + frontend) or via:');
  console.log('  curl $NEXT_PUBLIC_API_URL/api/agents | jq');
}

async function waitForScoutWindow(engine) {
  const last = Number(await engine.lastScoutJobAt());
  if (last === 0) return;
  const now  = Math.floor(Date.now() / 1000);
  const wait = last + SCOUT_INTERVAL - now;
  if (wait > 0) {
    console.log(`  ⏳ scout interval: waiting ${wait}s before next trigger...`);
    await sleep((wait + 2) * 1000);
  }
}

async function report(engine, yieldReg, vault, registry, POOL_NAME) {
  const [best, bestAPY, active, activeAPY, balance] = await Promise.all([
    yieldReg.bestProtocol(),
    yieldReg.bestAPY(),
    yieldReg.activeProtocol(),
    yieldReg.activeAPY(),
    vault.getVaultBalance(),
  ]);

  console.log('  ── Vault ─────────────────────────────────');
  console.log(`     Active protocol : ${POOL_NAME[active?.toLowerCase()] || active} @ ${pct(activeAPY)}`);
  console.log(`     Best protocol   : ${POOL_NAME[best?.toLowerCase()]   || best} @ ${pct(bestAPY)}`);
  console.log(`     Balance         : ${usd(balance)}`);

  console.log('  ── Reputation leaderboard ────────────────');
  for (const w of DEMO_WALLETS) {
    if (!w.addr) continue;
    try {
      const a = await registry.getAgent(w.addr);
      if (a.wallet === ethers.ZeroAddress) { console.log(`     ${w.name.padEnd(14)} not registered`); continue; }
      console.log(
        `     ${w.name.padEnd(14)} rep=${String(a.reputationScore).padStart(3)}  ` +
        `done=${a.jobsCompleted}  failed=${a.jobsFailed}`
      );
    } catch { /* ignore */ }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
