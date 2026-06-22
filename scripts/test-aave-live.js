// Test the live AaveAdapter on Fuji — verifies getAPY(), getBalance(), and optionally deposits.
//
// Run: npx hardhat run scripts/test-aave-live.js --network fuji

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');

const IYieldAdapter = require('../artifacts/contracts/interfaces/IYieldAdapter.sol/IYieldAdapter.json').abi;

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const AAVE_DATA_PROVIDER_ABI = [
  'function getReserveData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Aave V3 Live Adapter — Fuji Test');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Wallet:       ${deployer.address}`);
  console.log(`  AaveAdapter:  ${ADDRESSES.AaveAdapter}`);
  console.log('');

  const adapter = new ethers.Contract(ADDRESSES.AaveAdapter, IYieldAdapter, deployer);
  const usdc    = new ethers.Contract(ADDRESSES.USDC, USDC_ABI, deployer);

  // Test 1: protocolName()
  const name = await adapter.protocolName();
  console.log(`[1] protocolName(): ${name}`);

  // Test 2: getAPY()
  const apy = await adapter.getAPY();
  console.log(`[2] getAPY():       ${Number(apy)} bps (${(Number(apy) / 100).toFixed(2)}%)`);

  // Test 3: getBalance()
  const balance = await adapter.getBalance();
  console.log(`[3] getBalance():   ${Number(balance)} (${(Number(balance) / 1e6).toFixed(6)} USDC)`);

  // Test 4: Read raw Aave DataProvider
  console.log('');
  console.log('Raw Aave V3 DataProvider query:');
  const dataProvider = new ethers.Contract(
    '0xC65cbd1e309Bf0e841Ee6f6E786480598e6a4014',
    AAVE_DATA_PROVIDER_ABI,
    deployer
  );
  try {
    const data = await dataProvider.getReserveData(ADDRESSES.USDC);
    const liquidityRate = data[5];
    const totalAToken   = data[2];
    const totalVarDebt  = data[4];
    console.log(`  liquidityRate (RAY): ${liquidityRate.toString()}`);
    console.log(`  liquidityRate (bps): ${Number(liquidityRate / 10n**23n)}`);
    console.log(`  totalAToken:         ${Number(totalAToken)} (${(Number(totalAToken) / 1e6).toFixed(2)} USDC)`);
    console.log(`  totalVariableDebt:   ${Number(totalVarDebt)} (${(Number(totalVarDebt) / 1e6).toFixed(2)} USDC)`);
  } catch (err) {
    console.log(`  ✗ getReserveData() failed: ${err.message}`);
  }

  // Test 5: Check deployer USDC balance
  console.log('');
  const usdcBal = await usdc.balanceOf(deployer.address);
  console.log(`Deployer USDC balance: ${(Number(usdcBal) / 1e6).toFixed(6)} USDC`);

  console.log('');
  if (Number(apy) > 0) {
    console.log('✓ Aave V3 adapter is LIVE and returning real APY');
  } else {
    console.log('⚠ APY is 0 — Aave V3 USDC market on Fuji may have no borrowers.');
    console.log('  The adapter is correctly wired but the market needs activity to generate yield.');
    console.log('  Try borrowing USDC via app.aave.com (testnet mode) to create supply interest.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
