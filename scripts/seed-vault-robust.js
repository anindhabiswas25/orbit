// Robust vault seed — deposits USDC into YieldVault using the same Fuji-safe
// provider config as deploy-robust.js. Amount defaults to 5 USDC (override with
// SEED_USDC env var). Run: node scripts/seed-vault-robust.js

const { ethers } = require('ethers');
require('dotenv').config();

const ADDR = require('../deployed-addresses.json');
const DEPLOY_RPC = process.env.DEPLOY_RPC_URL || 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
const AMOUNT = ethers.parseUnits(process.env.SEED_USDC || '5', 6);

const ERC20_ABI = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
];
const VAULT_ABI = [
  'function deposit(uint256) returns(uint256)',
  'function getVaultBalance() view returns(uint256)',
  'function getUserBalance(address) view returns(uint256)',
];

async function main() {
  const fetchReq = new ethers.FetchRequest(DEPLOY_RPC);
  fetchReq.timeout = 120000;
  const provider = new ethers.JsonRpcProvider(fetchReq, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const usdc  = new ethers.Contract(ADDR.USDC, ERC20_ABI, deployer);
  const vault = new ethers.Contract(ADDR.YieldVault, VAULT_ABI, deployer);

  const bal = await usdc.balanceOf(deployer.address);
  console.log('Deployer USDC:', Number(bal) / 1e6, '| seeding:', Number(AMOUNT) / 1e6);
  if (bal < AMOUNT) throw new Error('Insufficient USDC. Get more at https://faucet.circle.com');

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
          if (await provider.getTransactionCount(deployer.address, 'latest') > nonce) break;
          await sleep(1500);
        }
        console.log(`  ✓ ${label} (${receipt.hash.slice(0, 12)}…)`);
        return;
      } catch (err) {
        if (attempt < 8) { console.log(`  … ${label} retry ${attempt}`); await sleep(5000); continue; }
        throw err;
      }
    }
  }

  await send('approve', usdc, 'approve', [ADDR.YieldVault, AMOUNT]);
  await send('deposit', vault, 'deposit', [AMOUNT]);

  console.log('Vault TVL now:', Number(await vault.getVaultBalance()) / 1e6, 'USDC');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
