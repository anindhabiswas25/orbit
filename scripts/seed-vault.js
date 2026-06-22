// Deposits 100 USDC into YieldVault from deployer wallet for demo purposes.
// Requires deployer to have ≥100 USDC on Fuji.
// Run: npx hardhat run scripts/seed-vault.js --network fuji

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');
require('dotenv').config();

const DEPOSIT_AMOUNT = ethers.parseUnits('100', 6); // 100 USDC

const ERC20_ABI = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Seed Vault');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Amount:   100 USDC`);
  console.log('');

  const usdc     = new ethers.Contract(ADDRESSES.USDC, ERC20_ABI, deployer);
  const vaultABI = (await ethers.getContractFactory('YieldVault')).interface;
  const vault    = new ethers.Contract(ADDRESSES.YieldVault, vaultABI, deployer);

  // Check USDC balance
  const balance = await usdc.balanceOf(deployer.address);
  if (balance < DEPOSIT_AMOUNT) {
    throw new Error(
      `Deployer has ${Number(balance)/1e6} USDC. Need 100 USDC.\n` +
      'Get Circle testnet USDC at: https://faucet.circle.com (select Avalanche Fuji)'
    );
  }
  console.log(`  Deployer USDC balance: ${Number(balance)/1e6} USDC`);

  // Approve vault to spend USDC
  process.stdout.write('  Approving 100 USDC...');
  const approveTx = await usdc.approve(ADDRESSES.YieldVault, DEPOSIT_AMOUNT);
  await approveTx.wait();
  console.log(' ✓');

  // Deposit
  process.stdout.write('  Depositing 100 USDC into vault...');
  const depositTx = await vault.deposit(DEPOSIT_AMOUNT);
  const receipt   = await depositTx.wait();
  console.log(` ✓  (${receipt.hash.slice(0, 12)}...)`);

  // Verify
  const vaultBalance = await vault.getVaultBalance();
  const userShares   = await vault.getUserShares(deployer.address);
  const userBalance  = await vault.getUserBalance(deployer.address);

  console.log('');
  console.log('Vault state after deposit:');
  console.log(`  Total vault USDC:  ${Number(vaultBalance)/1e6} USDC`);
  console.log(`  User shares:       ${Number(userShares)/1e6}`);
  console.log(`  User USDC value:   ${Number(userBalance)/1e6} USDC`);
  console.log(`  Fee collected:     ${(100 * 0.001).toFixed(3)} USDC (0.10%)`);
  console.log('');
  console.log('✓ Vault seeded successfully');
  console.log('');
  console.log('NEXT STEP:');
  console.log('  npx hardhat run scripts/verify-contracts.js --network fuji');
}

main().catch(err => { console.error(err); process.exit(1); });
