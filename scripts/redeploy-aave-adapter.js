// Redeploy AaveAdapter with correct Aave V3 Fuji addresses.
// The original deployment used Circle USDC as placeholder for all constructor args.
// This script deploys a new AaveAdapter with real Aave V3 Pool, DataProvider, and aUSDC.
//
// Run: npx hardhat run scripts/redeploy-aave-adapter.js --network fuji

const { ethers } = require('hardhat');
const fs         = require('fs');
const path       = require('path');

const ADDRESSES_PATH = path.join(__dirname, '..', 'deployed-addresses.json');
const ADDRESSES      = require(ADDRESSES_PATH);

const FUJI_AAVE = {
  POOL:          '0x8B9b2AF4afB389b4a70A474dfD4AdCD4a302bb40',
  DATA_PROVIDER: '0xC65cbd1e309Bf0e841Ee6f6E786480598e6a4014',
  A_USDC:        '0x9CFcc1B289E59FBe1E769f020C77315DF8473760',
};

const USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Redeploy AaveAdapter (Real Aave V3)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} AVAX`);
  console.log('');

  const vaultAddr = ADDRESSES.YieldVault;
  console.log(`  YieldVault:     ${vaultAddr}`);
  console.log(`  YieldRegistry:  ${ADDRESSES.YieldRegistry}`);
  console.log(`  Old AaveAdapter: ${ADDRESSES.AaveAdapter}`);
  console.log('');

  // Step 1: Deploy new AaveAdapter with correct Aave V3 addresses
  console.log('[1/3] Deploying new AaveAdapter...');
  const Factory = await ethers.getContractFactory('AaveAdapter', deployer);
  const adapter = await Factory.deploy(
    vaultAddr,
    FUJI_AAVE.POOL,
    FUJI_AAVE.DATA_PROVIDER,
    USDC,
    FUJI_AAVE.A_USDC
  );
  await adapter.waitForDeployment();
  const newAddr = await adapter.getAddress();
  console.log(`  ✓ New AaveAdapter deployed: ${newAddr}`);

  // Step 2: Register in YieldRegistry
  console.log('[2/3] Registering in YieldRegistry...');
  const yieldRegFactory = await ethers.getContractFactory('YieldRegistry', deployer);
  const yieldReg = yieldRegFactory.attach(ADDRESSES.YieldRegistry);
  const regTx = await yieldReg.registerAdapter(newAddr, 'AAVE V3 Live');
  await regTx.wait();
  console.log(`  ✓ Registered as "AAVE V3 Live" in YieldRegistry`);

  // Step 3: Quick smoke test — read APY
  console.log('[3/3] Smoke test — reading APY...');
  const IYieldAdapter = require('../artifacts/contracts/interfaces/IYieldAdapter.sol/IYieldAdapter.json').abi;
  const liveAdapter = new ethers.Contract(newAddr, IYieldAdapter, deployer);
  const apy = await liveAdapter.getAPY();
  const name = await liveAdapter.protocolName();
  console.log(`  ✓ protocolName(): ${name}`);
  console.log(`  ✓ getAPY():       ${Number(apy)} bps (${(Number(apy) / 100).toFixed(2)}%)`);

  // Step 4: Update deployed-addresses.json
  const oldAaveAddr = ADDRESSES.AaveAdapter;
  ADDRESSES.AaveAdapter     = newAddr;
  ADDRESSES.AaveAdapterOld  = oldAaveAddr;
  ADDRESSES.redeployedAt    = new Date().toISOString();
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(ADDRESSES, null, 2));
  console.log('');
  console.log(`  ✓ deployed-addresses.json updated`);
  console.log(`    AaveAdapter:    ${newAddr}`);
  console.log(`    AaveAdapterOld: ${oldAaveAddr}`);

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Done! AaveAdapter now points to real Aave V3 on Fuji');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  if (Number(apy) === 0) {
    console.log('⚠  APY is 0 — this may mean Aave V3 USDC market on Fuji has no');
    console.log('   active supply/borrow. Try supplying USDC via app.aave.com (testnet mode)');
    console.log('   to seed the market, then APY should become non-zero.');
  } else {
    console.log(`✓  Real Aave V3 APY: ${(Number(apy) / 100).toFixed(2)}%`);
    console.log('   Agents will now see this when scanning protocols.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
