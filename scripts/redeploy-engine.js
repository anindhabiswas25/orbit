// redeploy-engine.js
//
// Engine-only migration. Deploys a NEW AgentSelectionEngine (with the change
// that completeScoutJob only assigns an executor job when bestProtocol !=
// activeProtocol — i.e. only on a real rebalance opportunity) and re-points the
// existing contracts at it.
//
// Keeps AgentRegistry, YieldRegistry, YieldVault, FeePool, PaymentLedger and
// ALL adapters at their current addresses. Agents stay registered and scouts
// stay authorized — no re-registration, no re-staking.
//
// Run: node scripts/redeploy-engine.js

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const ADDR     = require('../deployed-addresses.json');
const ENV_PATH = path.join(__dirname, '..', '.env');

function loadABI(n)  { return require(`../artifacts/contracts/${n}.sol/${n}.json`).abi; }
function loadBytecode(n) { return require(`../artifacts/contracts/${n}.sol/${n}.json`).bytecode; }

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const registry = new ethers.Contract(ADDR.AgentRegistry, loadABI('AgentRegistry'), deployer);
  const yieldReg = new ethers.Contract(ADDR.YieldRegistry, loadABI('YieldRegistry'), deployer);
  const vault    = new ethers.Contract(ADDR.YieldVault,    loadABI('YieldVault'),    deployer);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit — Redeploy AgentSelectionEngine (engine-only)');
  console.log('  Change: executor only triggered on a real rebalance opportunity');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Deployer:', deployer.address);
  console.log('  Old engine:', ADDR.AgentSelectionEngine);

  // ── 1. Deploy new engine pointing at EXISTING registry/yieldReg/feePool ──
  console.log('\n[1/6] Deploying new AgentSelectionEngine...');
  const EngFactory = new ethers.ContractFactory(
    loadABI('AgentSelectionEngine'),
    loadBytecode('AgentSelectionEngine'),
    deployer
  );
  const newEngine = await (await EngFactory.deploy(ADDR.AgentRegistry, ADDR.YieldRegistry, ADDR.FeePool)).waitForDeployment();
  const newEngineAddr = await newEngine.getAddress();
  console.log('  New engine:', newEngineAddr);

  // ── 2. Wire vault into engine ────────────────────────────────────────────
  console.log('\n[2/6] engine.setVault...');
  await (await newEngine.setVault(ADDR.YieldVault)).wait();
  console.log('  ✓');

  // ── 3. Wire payment ledger into engine ───────────────────────────────────
  console.log('\n[3/6] engine.setPaymentLedger...');
  await (await newEngine.setPaymentLedger(ADDR.PaymentLedger)).wait();
  console.log('  ✓');

  // ── 4. Point AgentRegistry at new engine (for reputation updates) ────────
  console.log('\n[4/6] registry.setSelectionEngine...');
  await (await registry.setSelectionEngine(newEngineAddr)).wait();
  console.log('  ✓');

  // ── 5. Point YieldVault at new engine (for rebalance authority) ──────────
  console.log('\n[5/6] vault.setEngine...');
  await (await vault.setEngine(newEngineAddr)).wait();
  console.log('  ✓');

  // ── 6. Point YieldRegistry at new engine (for logRebalance authority) ────
  console.log('\n[6/6] yieldReg.setSelectionEngine...');
  await (await yieldReg.setSelectionEngine(newEngineAddr)).wait();
  console.log('  ✓');

  // ── Persist new address ──────────────────────────────────────────────────
  const addresses = { ...ADDR, AgentSelectionEngine: newEngineAddr };
  fs.writeFileSync(path.join(__dirname, '..', 'deployed-addresses.json'), JSON.stringify(addresses, null, 2));
  console.log('\n  deployed-addresses.json updated');

  const fujiPath = path.join(__dirname, '..', 'packages/core/src/chain/FujiAddresses.ts');
  if (fs.existsSync(fujiPath)) {
    let src = fs.readFileSync(fujiPath, 'utf8');
    src = src.replace(/ORBIT_SELECTION_ENGINE \|\| '[^']+'/, `ORBIT_SELECTION_ENGINE || '${newEngineAddr}'`);
    fs.writeFileSync(fujiPath, src);
    console.log('  FujiAddresses.ts updated');
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Engine migration complete');
  console.log('  New engine:', newEngineAddr);
  console.log('  Registry / YieldRegistry / Vault / agents — UNCHANGED');
  console.log('  NEXT: rebuild packages, restart agents + backend');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
