// Robust post-deploy wiring — same provider config as deploy-robust.js to dodge
// the Fuji public-RPC nonce issues. Reads deployed-addresses.json and wires all
// cross-contract references + registers the yield adapters.
//
// Run after deploy-robust.js: node scripts/setup-robust.js

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const ADDR = require('../deployed-addresses.json');
const DEPLOY_RPC = process.env.DEPLOY_RPC_URL || 'https://avalanche-fuji-c-chain-rpc.publicnode.com';

function loadABI(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', file), 'utf8')).abi;
}

const ABI = {
  FeePool:              loadABI('contracts/FeePool.sol/FeePool.json'),
  AgentRegistry:        loadABI('contracts/AgentRegistry.sol/AgentRegistry.json'),
  YieldRegistry:        loadABI('contracts/YieldRegistry.sol/YieldRegistry.json'),
  AgentSelectionEngine: loadABI('contracts/AgentSelectionEngine.sol/AgentSelectionEngine.json'),
  PaymentLedger:        loadABI('contracts/PaymentLedger.sol/PaymentLedger.json'),
};

async function main() {
  const fetchReq = new ethers.FetchRequest(DEPLOY_RPC);
  fetchReq.timeout = 120000;
  const provider = new ethers.JsonRpcProvider(fetchReq, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const orchestrator = process.env.ORCHESTRATOR_WALLET || deployer.address;

  const feePool  = new ethers.Contract(ADDR.FeePool,              ABI.FeePool,              deployer);
  const registry = new ethers.Contract(ADDR.AgentRegistry,        ABI.AgentRegistry,        deployer);
  const yieldReg = new ethers.Contract(ADDR.YieldRegistry,        ABI.YieldRegistry,        deployer);
  const engine   = new ethers.Contract(ADDR.AgentSelectionEngine, ABI.AgentSelectionEngine, deployer);
  const ledger   = new ethers.Contract(ADDR.PaymentLedger,        ABI.PaymentLedger,        deployer);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Robust Post-Deploy Wiring');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Deployer:    ', deployer.address);
  console.log('  Orchestrator:', orchestrator);
  console.log('');

  // Send one tx with manual nonce + retry-on-any-error + settle wait.
  async function send(label, contract, method, args) {
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const nonce = await provider.getTransactionCount(deployer.address, 'latest');
        const fee   = await provider.getFeeData();
        const overrides = { nonce };
        if (fee.gasPrice) overrides.gasPrice = (fee.gasPrice * BigInt(115 + (attempt - 1) * 20)) / 100n;

        const tx = await contract[method](...args, overrides);
        const receipt = await tx.wait();

        for (let i = 0; i < 20; i++) {
          const latest = await provider.getTransactionCount(deployer.address, 'latest');
          if (latest > nonce) break;
          await sleep(1500);
        }
        console.log(`  ✓ ${label.padEnd(48)} (${receipt.hash.slice(0, 12)}…)`);
        return;
      } catch (err) {
        const msg = err.shortMessage || err.message || '';
        if (attempt < 8) {
          console.log(`  … ${label} attempt ${attempt} failed (${msg.slice(0, 40)}), settling 5s`);
          await sleep(5000);
          continue;
        }
        throw err;
      }
    }
  }

  console.log('Wiring cross-contract references...');
  await send('AgentRegistry.setSelectionEngine(engine)',  registry, 'setSelectionEngine', [ADDR.AgentSelectionEngine]);
  await send('AgentSelectionEngine.setVault(vault)',       engine,   'setVault',           [ADDR.YieldVault]);
  await send('FeePool.setOrchestrator(orchestrator)',      feePool,  'setOrchestrator',    [orchestrator]);
  await send('FeePool.setVault(vault)',                    feePool,  'setVault',           [ADDR.YieldVault]);
  await send('PaymentLedger.setOrchestrator(orchestrator)',ledger,   'setOrchestrator',    [orchestrator]);
  await send('AgentSelectionEngine.setPaymentLedger(led)', engine,   'setPaymentLedger',   [ADDR.PaymentLedger]);
  await send('YieldRegistry.setSelectionEngine(engine)',   yieldReg, 'setSelectionEngine', [ADDR.AgentSelectionEngine]);

  console.log('');
  console.log('Registering adapters in YieldRegistry...');
  await send('registerAdapter(AaveAdapter, "AAVE V3")',  yieldReg, 'registerAdapter', [ADDR.AaveAdapter,  'AAVE V3']);
  await send('registerAdapter(BenqiAdapter, "Benqi")',   yieldReg, 'registerAdapter', [ADDR.BenqiAdapter, 'Benqi']);
  await send('registerAdapter(MockPoolA, "MockPoolA")',  yieldReg, 'registerAdapter', [ADDR.MockPoolA,    'MockPoolA']);
  await send('registerAdapter(MockPoolB, "MockPoolB")',  yieldReg, 'registerAdapter', [ADDR.MockPoolB,    'MockPoolB']);

  console.log('');
  console.log('✓ Wiring complete');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
