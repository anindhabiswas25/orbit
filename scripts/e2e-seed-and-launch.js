// Full e2e seed and pre-flight check script
// 1. Direct-transfers 12 USDC to FeePool (bypasses onlyVault — payAgent checks raw balance)
// 2. Deposits 4 USDC into YieldVault to trigger scout/executor cycles
// 3. Prints state for verification
// Run: node scripts/e2e-seed-and-launch.js

require('dotenv').config();
const { ethers } = require('ethers');
const ADDRESSES  = require('../deployed-addresses.json');

const FeePoolABI  = require('../orchestrator/src/chain/abis/FeePool.json');
const VaultABI    = require('../orchestrator/src/chain/abis/YieldVault.json');
const RegistryABI = require('../orchestrator/src/chain/abis/AgentRegistry.json');

const RPC = process.env.FUJI_RPC_URL || 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
const ERC20_ABI = [
  'function balanceOf(address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
  'function transfer(address,uint256) returns(bool)',
];

const VAULT_DEPOSIT    = ethers.parseUnits('4', 6);   // 4 USDC
const FEEPOOL_SEED     = ethers.parseUnits('12', 6);  // 12 USDC direct transfer

async function main() {
  const provider  = new ethers.JsonRpcProvider(RPC, 43113, { cacheTimeout: -1 });
  const deployer  = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  console.log('══════════════════════════════════════════════════');
  console.log('  Orbit E2E — Seed & Pre-flight');
  console.log('  RPC:', RPC);
  console.log('  Deployer:', deployer.address);
  console.log('══════════════════════════════════════════════════\n');

  const usdc     = new ethers.Contract(ADDRESSES.USDC,       ERC20_ABI,    deployer);
  const feePool  = new ethers.Contract(ADDRESSES.FeePool,    FeePoolABI,   deployer);
  const vault    = new ethers.Contract(ADDRESSES.YieldVault, VaultABI,     deployer);
  const registry = new ethers.Contract(ADDRESSES.AgentRegistry, RegistryABI, provider);

  // ── Pre-flight balances ─────────────────────────────────────────────────
  const deployerUSDC = await usdc.balanceOf(deployer.address);
  const fpBefore     = await feePool.getBalance();
  const vaultBefore  = await vault.getVaultBalance();

  console.log('Pre-flight:');
  console.log('  Deployer USDC:', Number(deployerUSDC) / 1e6, 'USDC');
  console.log('  FeePool:      ', Number(fpBefore)    / 1e6, 'USDC');
  console.log('  Vault:        ', Number(vaultBefore) / 1e6, 'USDC\n');

  const scouts    = await registry.getAllScouts();
  const executors = await registry.getAllExecutors();
  console.log('Registered scouts   :', scouts);
  console.log('Registered executors:', executors, '\n');

  // ── Seed FeePool via direct ERC20 transfer ──────────────────────────────
  if (Number(fpBefore) < Number(FEEPOOL_SEED)) {
    const needed = FEEPOOL_SEED - fpBefore;
    if (deployerUSDC < needed) {
      console.warn(`Deployer has ${Number(deployerUSDC)/1e6} USDC, need ${Number(needed)/1e6} more for FeePool.`);
      console.warn('Skipping FeePool seed — orchestrator payments may fail if balance < 10 USDC reserve.\n');
    } else {
      process.stdout.write(`Seeding FeePool with ${Number(needed)/1e6} USDC (direct ERC20 transfer)...`);
      const tx = await usdc.transfer(ADDRESSES.FeePool, needed);
      await tx.wait();
      console.log(' ✓  tx:', tx.hash.slice(0, 20) + '...');
    }
  } else {
    console.log('FeePool already funded ✓');
  }

  // ── Deposit into YieldVault ─────────────────────────────────────────────
  const deployerUSDC2 = await usdc.balanceOf(deployer.address);
  if (Number(vaultBefore) === 0 && deployerUSDC2 >= VAULT_DEPOSIT) {
    process.stdout.write(`Approving vault for ${Number(VAULT_DEPOSIT)/1e6} USDC...`);
    const approveTx = await usdc.approve(ADDRESSES.YieldVault, VAULT_DEPOSIT);
    await approveTx.wait();
    console.log(' ✓');

    process.stdout.write(`Depositing ${Number(VAULT_DEPOSIT)/1e6} USDC into YieldVault...`);
    const depositTx = await vault.deposit(VAULT_DEPOSIT);
    const receipt   = await depositTx.wait();
    console.log(' ✓  tx:', receipt.hash.slice(0, 20) + '...');
  } else if (Number(vaultBefore) > 0) {
    console.log('Vault already has funds ✓');
  } else {
    console.warn('Deployer has insufficient USDC to seed vault.');
  }

  // ── Post-flight state ───────────────────────────────────────────────────
  const fpAfter    = await feePool.getBalance();
  const vaultAfter = await vault.getVaultBalance();

  console.log('\nPost-flight:');
  console.log('  FeePool:  ', Number(fpAfter)    / 1e6, 'USDC');
  console.log('  Vault:    ', Number(vaultAfter) / 1e6, 'USDC');
  console.log('  MIN_RESERVE: 10 USDC →', Number(fpAfter) >= 10_000_000 ? '✓ PASS' : '✗ FAIL (orchestrator payments will revert)');
  console.log('\n✓ Seed complete. Start agents + orchestrator now.\n');
}

main().catch(err => { console.error(err.message); process.exit(1); });
