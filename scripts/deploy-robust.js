// Robust standalone deploy — bypasses hardhat's signer to avoid the Fuji
// nonce-caching bug. Uses ethers directly with cacheTimeout:-1 and explicit
// manual nonce management so back-to-back deploys never collide.
//
// Run: node scripts/deploy-robust.js

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const FUJI = { USDC: '0x5425890298aed601595a70AB815c96711a31Bc65' };
const FUJI_AAVE = {
  POOL:          '0x8B9b2AF4afB389b4a70A474dfD4AdCD4a302bb40',
  DATA_PROVIDER: '0xC65cbd1e309Bf0e841Ee6f6E786480598e6a4014',
  A_USDC:        '0x9CFcc1B289E59FBe1E769f020C77315DF8473760',
};

const ARTIFACT = {
  FeePool:              'contracts/FeePool.sol/FeePool.json',
  AgentRegistry:        'contracts/AgentRegistry.sol/AgentRegistry.json',
  YieldRegistry:        'contracts/YieldRegistry.sol/YieldRegistry.json',
  AgentSelectionEngine: 'contracts/AgentSelectionEngine.sol/AgentSelectionEngine.json',
  YieldVault:           'contracts/YieldVault.sol/YieldVault.json',
  AaveAdapter:          'contracts/adapters/AaveAdapter.sol/AaveAdapter.json',
  BenqiAdapter:         'contracts/adapters/BenqiAdapter.sol/BenqiAdapter.json',
  MockPoolA:            'contracts/adapters/MockPoolA.sol/MockPoolA.json',
  MockPoolB:            'contracts/adapters/MockPoolB.sol/MockPoolB.json',
  PaymentLedger:        'contracts/PaymentLedger.sol/PaymentLedger.json',
};

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', ARTIFACT[name]), 'utf8'));
}

const DEPLOY_RPC = process.env.DEPLOY_RPC_URL || 'https://avalanche-fuji-c-chain-rpc.publicnode.com';

async function main() {
  // batchMaxCount:1 — one RPC call at a time (avoids load-balancer batch
  // inconsistency + free-tier batch limits). cacheTimeout:-1 — never serve a
  // stale nonce. Per-request timeout raised for slow large-contract deploys.
  const fetchReq = new ethers.FetchRequest(DEPLOY_RPC);
  fetchReq.timeout = 120000;
  const provider = new ethers.JsonRpcProvider(fetchReq, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Robust Deploy (manual nonce)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Deployer:', deployer.address);
  console.log('  Balance: ', ethers.formatEther(await provider.getBalance(deployer.address)), 'AVAX');
  console.log('');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Deploy one contract, fully confirmed, then poll until the settled nonce
  // advances before returning. Retry on nonce/replacement errors, bumping the
  // gas price each attempt so a phantom pending tx gets replaced.
  async function deploy(name, args) {
    const art = loadArtifact(name);
    const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);

    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const nonce = await provider.getTransactionCount(deployer.address, 'latest');
        const fee   = await provider.getFeeData();
        // bump gas price 15% per attempt to beat any underpriced phantom tx
        const bump  = (v) => v ? (v * BigInt(115 + (attempt - 1) * 20)) / 100n : undefined;
        const overrides = { nonce };
        if (fee.gasPrice) overrides.gasPrice = bump(fee.gasPrice);

        const contract = await factory.deploy(...args, overrides);
        await contract.waitForDeployment();
        const address = await contract.getAddress();

        for (let i = 0; i < 20; i++) {
          const latest = await provider.getTransactionCount(deployer.address, 'latest');
          if (latest > nonce) break;
          await sleep(1500);
        }
        console.log(`  ✓ ${name.padEnd(22)} ${address}  (nonce ${nonce})`);
        return address;
      } catch (err) {
        const msg = err.shortMessage || err.message || '';
        // Retry on ANY transient error (nonce/replacement/timeout/server).
        // A possibly-mined tx is harmless to re-attempt — we just deploy a fresh
        // copy at the next nonce and use that address.
        if (attempt < 8) {
          console.log(`  … ${name} attempt ${attempt} failed (${msg.slice(0, 45)}), settling 5s`);
          await sleep(5000);
          continue;
        }
        throw err;
      }
    }
  }

  const addresses = {};
  addresses.FeePool              = await deploy('FeePool', [FUJI.USDC]);
  addresses.AgentRegistry        = await deploy('AgentRegistry', [FUJI.USDC]);
  addresses.YieldRegistry        = await deploy('YieldRegistry', []);
  addresses.AgentSelectionEngine = await deploy('AgentSelectionEngine', [addresses.AgentRegistry, addresses.YieldRegistry, addresses.FeePool]);
  addresses.YieldVault           = await deploy('YieldVault', [FUJI.USDC, addresses.AgentSelectionEngine, addresses.FeePool]);
  addresses.AaveAdapter          = await deploy('AaveAdapter', [addresses.YieldVault, FUJI_AAVE.POOL, FUJI_AAVE.DATA_PROVIDER, FUJI.USDC, FUJI_AAVE.A_USDC]);
  addresses.BenqiAdapter         = await deploy('BenqiAdapter', [addresses.YieldVault, FUJI.USDC, FUJI.USDC]);
  addresses.MockPoolA            = await deploy('MockPoolA', [addresses.YieldVault, FUJI.USDC, 500]);
  addresses.MockPoolB            = await deploy('MockPoolB', [addresses.YieldVault, FUJI.USDC, 480]);
  addresses.PaymentLedger        = await deploy('PaymentLedger', []);

  const outputData = {
    ...addresses,
    USDC:       FUJI.USDC,
    network:    'fuji',
    chainId:    43113,
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'deployed-addresses.json'), JSON.stringify(outputData, null, 2));

  console.log('');
  console.log('✓ All 10 contracts deployed');
  console.log('✓ deployed-addresses.json written');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
