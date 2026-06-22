// migrate-registry-engine.js
//
// Deploys new AgentRegistry + AgentSelectionEngine with:
//   - No reputation floor: all active staked agents are eligible
//   - Round-robin job assignment: every agent gets turns
//   - setRegistry() on engine for future upgrades
//   - setEngine() on vault for future upgrades
//
// Then re-registers all agents and restores the system state.
// Keeps YieldVault, YieldRegistry, FeePool, all adapters at the same addresses.
//
// Run: node scripts/migrate-registry-engine.js

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const ADDR     = require('../deployed-addresses.json');
const ENV_PATH = path.join(__dirname, '..', '.env');

const STAKE = ethers.parseUnits('5', 6);
const ERC20 = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'function transfer(address,uint256) returns(bool)',
];

function loadABI(n) {
  return require(`../artifacts/contracts/${n}.sol/${n}.json`).abi;
}

const SCOUT = 0, EXECUTOR = 1;

// All agents to re-register.
// envKey = key in process.env. repScore = reputation to seed (0 = start fresh).
const AGENTS = [
  { name: 'SmartScout1',   envKey: 'SCOUT1_PRIVATE_KEY',     type: SCOUT,    endpoint: 'https://scout1.orbit-protocol.xyz/agent-card',            fee: 50, repScore: 0 },
  { name: 'Scout2',        envKey: 'SCOUT2_PRIVATE_KEY',     type: SCOUT,    endpoint: 'https://scout2.orbit-protocol.xyz/agent-card',            fee: 30, repScore: 0 },
  { name: 'MomentumScout', envKey: 'MOMENTUM_SCOUT_KEY',     type: SCOUT,    endpoint: 'https://agents.orbit-protocol.xyz/momentum-scout/card',   fee: 45, repScore: 0 },
  { name: 'AlphaScout',    envKey: 'ALPHA_SCOUT_KEY',        type: SCOUT,    endpoint: 'https://agents.orbit-protocol.xyz/alpha-scout/card',      fee: 40, repScore: 0 },
  { name: 'SmartExec1',    envKey: 'EXECUTOR1_PRIVATE_KEY',  type: EXECUTOR, endpoint: 'https://exec1.orbit-protocol.xyz/agent-card',             fee: 50, repScore: 0 },
  { name: 'Exec2',         envKey: 'EXECUTOR2_PRIVATE_KEY',  type: EXECUTOR, endpoint: 'https://exec2.orbit-protocol.xyz/agent-card',             fee: 40, repScore: 0 },
  { name: 'AdaptiveExec',  envKey: 'ADAPTIVE_EXEC_KEY',      type: EXECUTOR, endpoint: 'https://agents.orbit-protocol.xyz/adaptive-executor/card',fee: 45, repScore: 0 },
];

// Scouts that need YieldRegistry authorization (all scouts)
const SCOUT_ENVKEYS = AGENTS.filter(a => a.type === SCOUT).map(a => a.envKey);

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const usdcD    = new ethers.Contract(ADDR.USDC,      ERC20,                  deployer);
  const vault    = new ethers.Contract(ADDR.YieldVault, loadABI('YieldVault'), deployer);
  const yieldReg = new ethers.Contract(ADDR.YieldRegistry, loadABI('YieldRegistry'), deployer);
  const feePool  = new ethers.Contract(ADDR.FeePool,   loadABI('FeePool'),     provider);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit — Migrate Registry + Engine (v2)');
  console.log('  Fix: no rep floor, round-robin job assignment');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Deployer:', deployer.address);

  // Ensure deployer has enough USDC for all agent stakes
  let bal = await usdcD.balanceOf(deployer.address);
  console.log('  USDC balance:', ethers.formatUnits(bal, 6));
  const needed = STAKE * BigInt(AGENTS.length) + ethers.parseUnits('1', 6);
  if (bal < needed) {
    // Try reclaiming vault position
    const shares = await vault.getUserShares(deployer.address);
    if (shares > 0n) {
      console.log('  Reclaiming vault position to fund stakes...');
      await (await vault.withdraw(shares)).wait();
      bal = await usdcD.balanceOf(deployer.address);
      console.log('  USDC now:', ethers.formatUnits(bal, 6));
    }
  }
  if (bal < needed) {
    throw new Error(`Deployer needs ${ethers.formatUnits(needed,6)} USDC but has ${ethers.formatUnits(bal,6)}. Top up via faucet.circle.com`);
  }

  // ── 1. Deploy new AgentRegistry ─────────────────────────────────────────
  console.log('\n[1/5] Deploying new AgentRegistry...');
  const RegFactory = new ethers.ContractFactory(
    loadABI('AgentRegistry'),
    require('../artifacts/contracts/AgentRegistry.sol/AgentRegistry.json').bytecode,
    deployer
  );
  const newRegistry = await (await RegFactory.deploy(ADDR.USDC)).waitForDeployment();
  const newRegistryAddr = await newRegistry.getAddress();
  console.log('  AgentRegistry v2:', newRegistryAddr);

  // ── 2. Deploy new AgentSelectionEngine ──────────────────────────────────
  console.log('\n[2/5] Deploying new AgentSelectionEngine...');
  const EngFactory = new ethers.ContractFactory(
    loadABI('AgentSelectionEngine'),
    require('../artifacts/contracts/AgentSelectionEngine.sol/AgentSelectionEngine.json').bytecode,
    deployer
  );
  const newEngine = await (await EngFactory.deploy(newRegistryAddr, ADDR.YieldRegistry, ADDR.FeePool)).waitForDeployment();
  const newEngineAddr = await newEngine.getAddress();
  console.log('  AgentSelectionEngine v2:', newEngineAddr);

  // ── 3. Wire up contracts ─────────────────────────────────────────────────
  console.log('\n[3/5] Wiring up contracts...');

  await (await newEngine.setVault(ADDR.YieldVault)).wait();
  console.log('  engine.setVault ✓');

  await (await newRegistry.setSelectionEngine(newEngineAddr)).wait();
  console.log('  registry.setSelectionEngine ✓');

  await (await vault.setEngine(newEngineAddr)).wait();
  console.log('  vault.setEngine ✓');

  await (await yieldReg.setSelectionEngine(newEngineAddr)).wait();
  console.log('  yieldReg.setSelectionEngine ✓');

  // ── 4. Register all agents ───────────────────────────────────────────────
  console.log('\n[4/5] Registering agents in new registry...');

  for (const a of AGENTS) {
    const key = process.env[a.envKey];
    if (!key) {
      console.log(`  SKIP ${a.name} — ${a.envKey} not in .env`);
      continue;
    }
    const wallet = new ethers.Wallet(key, provider);
    console.log(`\n  [${a.name}] ${wallet.address}`);

    // Fund AVAX if needed
    const avax = await provider.getBalance(wallet.address);
    if (avax < ethers.parseEther('0.03')) {
      await (await deployer.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.08') })).wait();
      console.log('    ✓ funded 0.08 AVAX');
    }

    // Fund USDC stake
    const ub = await usdcD.balanceOf(wallet.address);
    if (ub < STAKE) {
      await (await usdcD.transfer(wallet.address, STAKE - ub)).wait();
      console.log('    ✓ funded 5 USDC');
    }

    // Approve + register
    const usdcA = new ethers.Contract(ADDR.USDC, ERC20, wallet);
    await (await usdcA.approve(newRegistryAddr, STAKE)).wait();
    const reg = new ethers.Contract(newRegistryAddr, loadABI('AgentRegistry'), wallet);
    const receipt = await (await reg.register(a.type, a.endpoint, a.fee, wallet.address)).wait();
    console.log(`    ✓ registered tx: ${receipt.hash.slice(0,12)}…`);
  }

  // ── 5. Authorize all scouts in YieldRegistry ────────────────────────────
  console.log('\n[5/5] Authorizing scouts in YieldRegistry...');
  for (const envKey of SCOUT_ENVKEYS) {
    const key = process.env[envKey];
    if (!key) continue;
    const addr = new ethers.Wallet(key).address;
    const already = await yieldReg.authorizedAgents(addr);
    if (!already) {
      await (await yieldReg.authorizeAgent(addr)).wait();
      console.log('  ✓ authorized', addr.slice(0,10)+'...');
    } else {
      console.log('  already authorized', addr.slice(0,10)+'...');
    }
  }

  // ── Update deployed-addresses.json ──────────────────────────────────────
  const addresses = { ...ADDR, AgentRegistry: newRegistryAddr, AgentSelectionEngine: newEngineAddr };
  fs.writeFileSync(
    path.join(__dirname, '..', 'deployed-addresses.json'),
    JSON.stringify(addresses, null, 2)
  );
  console.log('\n  deployed-addresses.json updated');

  // ── Update FujiAddresses.ts fallback addresses ──────────────────────────
  const fujiPath = path.join(__dirname, '..', 'packages/core/src/chain/FujiAddresses.ts');
  if (fs.existsSync(fujiPath)) {
    let src = fs.readFileSync(fujiPath, 'utf8');
    src = src.replace(
      /ORBIT_AGENT_REGISTRY \|\| '[^']+'/,
      `ORBIT_AGENT_REGISTRY || '${newRegistryAddr}'`
    );
    src = src.replace(
      /ORBIT_SELECTION_ENGINE \|\| '[^']+'/,
      `ORBIT_SELECTION_ENGINE || '${newEngineAddr}'`
    );
    fs.writeFileSync(fujiPath, src);
    console.log('  FujiAddresses.ts updated');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Migration complete');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AgentRegistry v2:       ', newRegistryAddr);
  console.log('  AgentSelectionEngine v2:', newEngineAddr);
  console.log('  YieldVault (unchanged): ', ADDR.YieldVault);
  console.log('  YieldRegistry (unch.):  ', ADDR.YieldRegistry);
  console.log('');
  console.log('  All agents registered with rep=0 — equal starting point.');
  console.log('  Round-robin ensures every agent gets jobs in rotation.');
  console.log('  High-rep agents still get priority within each rotation.');
  console.log('');
  console.log('  NEXT: restart all agent processes and the backend.');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
