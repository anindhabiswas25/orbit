// live-loop.js — full end-to-end live demo on Fuji.
//
// 1. Spawns the 4 agents (2 scouts + 2 executors) as child processes.
// 2. Deposits USDC into the vault (as the deployer/user wallet).
// 3. Sets MockPoolA to a high APY so it wins, then triggers a scout cycle.
// 4. Waits for scout → executor to route the funds into MockPoolA.
// 5. Samples the pool balance + vault value over time to show yield accruing.
//
// Run: node scripts/live-loop.js
// Env: DEPOSIT_USDC (default 20), WIN_APY_BPS (default 50000 = 500%),
//      SAMPLES (default 6), SAMPLE_MS (default 20000)

require('dotenv').config();
const { ethers } = require('ethers');
const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');

const A = require('../deployed-addresses.json');

const RPC          = process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
const DEPOSIT_USDC = process.env.DEPOSIT_USDC || '20';
const WIN_APY_BPS  = parseInt(process.env.WIN_APY_BPS || '50000', 10);
const SAMPLES      = parseInt(process.env.SAMPLES || '6', 10);
const SAMPLE_MS    = parseInt(process.env.SAMPLE_MS || '20000', 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const u6    = (n) => (Number(n) / 1e6).toFixed(6);
const pct   = (bps) => `${(Number(bps) / 100).toFixed(2)}%`;

const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const AGENTS = [
  { name: 'SmartScout1', file: 'agents/scout/smart-scout.js',       key: process.env.SCOUT1_PRIVATE_KEY },
  { name: 'BasicScout2', file: 'agents/scout/index.js',             key: process.env.SCOUT2_PRIVATE_KEY },
  { name: 'SmartExec1',  file: 'agents/executor/smart-executor.js', key: process.env.EXECUTOR1_PRIVATE_KEY },
  { name: 'BasicExec2',  file: 'agents/executor/index.js',          key: process.env.EXECUTOR2_PRIVATE_KEY },
];

const children = [];
function startAgents() {
  for (const a of AGENTS) {
    if (!a.key) { console.log(`  ⚠ ${a.name}: no key, skipping`); continue; }
    const logPath = path.join(LOG_DIR, `${a.name}.log`);
    const fd = fs.openSync(logPath, 'w');
    const child = spawn('node', [a.file], {
      cwd:  path.join(__dirname, '..'),
      env:  { ...process.env, AGENT_PRIVATE_KEY: a.key, AGENT_NAME: a.name },
      stdio: ['ignore', fd, fd],
    });
    children.push(child);
    console.log(`  ▶ started ${a.name.padEnd(12)} (pid ${child.pid}) → logs/${a.name}.log`);
  }
}
function stopAgents() {
  for (const c of children) { try { c.kill('SIGINT'); } catch {} }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const wallet   = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const VAULT = require('../artifacts/contracts/YieldVault.sol/YieldVault.json').abi;
  const ENGINE = require('../artifacts/contracts/AgentSelectionEngine.sol/AgentSelectionEngine.json').abi;
  const YREG = require('../artifacts/contracts/YieldRegistry.sol/YieldRegistry.json').abi;
  const POOL = require('../artifacts/contracts/adapters/MockPoolA.sol/MockPoolA.json').abi;
  const ERC20 = ['function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'];

  const vault    = new ethers.Contract(A.YieldVault, VAULT, wallet);
  const engine   = new ethers.Contract(A.AgentSelectionEngine, ENGINE, wallet);
  const yieldReg = new ethers.Contract(A.YieldRegistry, YREG, wallet);
  const usdc     = new ethers.Contract(A.USDC, ERC20, wallet);
  const poolA    = new ethers.Contract(A.MockPoolA, POOL, wallet);
  const poolB    = new ethers.Contract(A.MockPoolB, POOL, wallet);

  const NAME = {
    [A.MockPoolA.toLowerCase()]: 'MockPoolA',
    [A.MockPoolB.toLowerCase()]: 'MockPoolB',
    [A.AaveAdapter.toLowerCase()]: 'AAVE V3',
    [A.BenqiAdapter.toLowerCase()]: 'Benqi',
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit — Full Live Loop (Fuji)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  User/keeper: ${wallet.address}`);
  console.log('');
  console.log('Starting agents...');
  startAgents();
  console.log('  waiting 8s for agents to begin polling...');
  await sleep(8000);

  // ── Deposit ────────────────────────────────────────────────────────────────
  const amount = ethers.parseUnits(DEPOSIT_USDC, 6);
  console.log(`\nDepositing ${DEPOSIT_USDC} USDC into the vault...`);
  await (await usdc.approve(A.YieldVault, amount)).wait();
  await (await vault.deposit(amount)).wait();
  console.log(`  ✓ deposited. vault.totalAssets = ${u6(await vault.totalAssets())} USDC`);
  console.log(`  current adapter = ${NAME[(await vault.getCurrentAdapter()).toLowerCase()] || 'none (idle)'}`);

  // ── Set APYs so MockPoolA wins, trigger scout cycle ──────────────────────────
  console.log(`\nSetting APYs → MockPoolA ${pct(WIN_APY_BPS)} (winner) | MockPoolB 4.80%`);
  await (await poolA.setAPY(WIN_APY_BPS)).wait();
  await (await poolB.setAPY(480)).wait();

  console.log('Triggering scout cycle (engine.triggerScoutCycle)...');
  try { await (await engine.triggerScoutCycle()).wait(); }
  catch (e) { console.log(`  (trigger note: ${e.shortMessage || e.message})`); }

  // ── Wait for the agents to route funds into the pool ─────────────────────────
  console.log('\nWaiting for scout → executor to route funds into the winning pool...');
  const targetAdapter = A.MockPoolA.toLowerCase();
  let routed = false;
  for (let i = 0; i < 30; i++) {  // up to ~150s
    const [best, active] = await Promise.all([yieldReg.bestProtocol(), vault.getCurrentAdapter()]);
    const bestN = NAME[best?.toLowerCase()] || 'none';
    const activeN = NAME[active?.toLowerCase()] || 'none (idle)';
    process.stdout.write(`  [t+${i * 5}s] scout best=${bestN}  vault active=${activeN}\r`);
    if (active.toLowerCase() === targetAdapter) { routed = true; console.log(`\n  ✓ funds routed into ${activeN} by the executor agent`); break; }
    await sleep(5000);
  }
  if (!routed) {
    console.log('\n  ⚠ funds were not routed within the window. Check logs/ for agent errors.');
    stopAgents();
    process.exit(1);
  }

  // ── Sample accrual over time ─────────────────────────────────────────────────
  console.log(`\nSampling yield accrual (${SAMPLES} samples, every ${SAMPLE_MS / 1000}s):`);
  console.log('  ┌──────────┬────────────────────┬────────────────────┬────────────────────┐');
  console.log('  │  time    │  pool getBalance   │  vault totalAssets │  your balance      │');
  console.log('  ├──────────┼────────────────────┼────────────────────┼────────────────────┤');
  let first = null;
  for (let i = 0; i < SAMPLES; i++) {
    const [pb, ta, ub] = await Promise.all([
      poolA.getBalance(),
      vault.totalAssets(),
      vault.getUserBalance(wallet.address),
    ]);
    if (first === null) first = pb;
    const t = `t+${String(i * SAMPLE_MS / 1000).padStart(3)}s`;
    console.log(`  │ ${t.padEnd(8)} │ ${u6(pb).padStart(18)} │ ${u6(ta).padStart(18)} │ ${u6(ub).padStart(18)} │`);
    if (i < SAMPLES - 1) await sleep(SAMPLE_MS);
  }
  console.log('  └──────────┴────────────────────┴────────────────────┴────────────────────┘');

  const last = await poolA.getBalance();
  const grew = last - first;
  console.log(`\n  Pool balance grew by ${u6(grew)} USDC over ${(SAMPLES - 1) * SAMPLE_MS / 1000}s of real-time accrual.`);
  console.log(`  Reserve remaining: ${u6(await poolA.getReserve())} USDC.`);
  console.log(`  APY: ${pct(WIN_APY_BPS)} — at this rate the per-second accrual is small but strictly increasing.`);

  console.log('\n✓ Live loop complete. The deposited position remains in the vault for frontend testing.');
  console.log('  Agent logs: logs/SmartScout1.log, BasicScout2.log, SmartExec1.log, BasicExec2.log');

  stopAgents();
  await sleep(500);
  process.exit(0);
}

process.on('SIGINT', () => { stopAgents(); process.exit(1); });
main().catch(err => { console.error('\nFATAL:', err.message); stopAgents(); process.exit(1); });
