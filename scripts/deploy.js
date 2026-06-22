// Deploy ALL contracts to Avalanche Fuji Testnet in strict order.
// Run: npx hardhat run scripts/deploy.js --network fuji
// Then immediately run: npx hardhat run scripts/post-deploy-setup.js --network fuji

const { ethers } = require('hardhat');
const fs         = require('fs');
const path       = require('path');

// ─── Fuji Testnet Protocol Addresses ────────────────────────────────────────
// USDC: Circle's native Fuji testnet token (faucet: faucet.circle.com).
// Aave V3 on Fuji uses the same Circle USDC (confirmed via aave-address-book).
// Benqi has no Fuji testnet deployment — adapter deployed with placeholder args.
const FUJI = {
  USDC: '0x5425890298aed601595a70AB815c96711a31Bc65', // Circle native testnet USDC
};

const FUJI_AAVE = {
  POOL:          '0x8B9b2AF4afB389b4a70A474dfD4AdCD4a302bb40',
  DATA_PROVIDER: '0xC65cbd1e309Bf0e841Ee6f6E786480598e6a4014',
  A_USDC:        '0x9CFcc1B289E59FBe1E769f020C77315DF8473760',
};

async function deploy(name, args, deployer) {
  const Factory  = await ethers.getContractFactory(name, deployer);
  const contract = await Factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ✓ ${name.padEnd(25)} ${address}`);
  return { contract, address };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Contract Deployment');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} AVAX`);
  console.log('');

  if (network.chainId !== 43113n && network.chainId !== 31337n) {
    throw new Error('Wrong network. Use --network fuji or --network hardhat');
  }

  const addresses = {};

  console.log('Deploying contracts in dependency order...');
  console.log('');

  // Step 1: FeePool (depends on: USDC)
  console.log('[1/10] FeePool');
  const { address: feePoolAddr } = await deploy('FeePool', [FUJI.USDC], deployer);
  addresses.FeePool = feePoolAddr;

  // Step 2: AgentRegistry (depends on: USDC)
  console.log('[2/10] AgentRegistry');
  const { address: registryAddr } = await deploy('AgentRegistry', [FUJI.USDC], deployer);
  addresses.AgentRegistry = registryAddr;

  // Step 3: YieldRegistry (no constructor deps)
  console.log('[3/10] YieldRegistry');
  const { address: yieldRegAddr } = await deploy('YieldRegistry', [], deployer);
  addresses.YieldRegistry = yieldRegAddr;

  // Step 4: AgentSelectionEngine (depends on: AgentRegistry, YieldRegistry, FeePool)
  console.log('[4/10] AgentSelectionEngine');
  const { address: engineAddr } = await deploy(
    'AgentSelectionEngine',
    [registryAddr, yieldRegAddr, feePoolAddr],
    deployer
  );
  addresses.AgentSelectionEngine = engineAddr;

  // Step 5: YieldVault (depends on: USDC, AgentSelectionEngine, FeePool)
  console.log('[5/10] YieldVault');
  const { address: vaultAddr } = await deploy(
    'YieldVault',
    [FUJI.USDC, engineAddr, feePoolAddr],
    deployer
  );
  addresses.YieldVault = vaultAddr;

  // Step 6: AaveAdapter (real Aave V3 Fuji addresses from aave-address-book)
  console.log('[6/10] AaveAdapter');
  const { address: aaveAddr } = await deploy(
    'AaveAdapter',
    [vaultAddr, FUJI_AAVE.POOL, FUJI_AAVE.DATA_PROVIDER, FUJI.USDC, FUJI_AAVE.A_USDC],
    deployer
  );
  addresses.AaveAdapter = aaveAddr;

  // Step 7: BenqiAdapter (placeholder — Benqi has no Fuji testnet deployment, mainnet only)
  console.log('[7/10] BenqiAdapter');
  const { address: benqiAddr } = await deploy(
    'BenqiAdapter',
    [vaultAddr, FUJI.USDC, FUJI.USDC],
    deployer
  );
  addresses.BenqiAdapter = benqiAddr;

  // Step 8: MockPoolA (initial APY = 5.00% = 500 bps)
  console.log('[8/10] MockPoolA');
  const { address: mockAAddr } = await deploy('MockPoolA', [vaultAddr, FUJI.USDC, 500], deployer);
  addresses.MockPoolA = mockAAddr;

  // Step 9: MockPoolB (initial APY = 4.80% = 480 bps)
  console.log('[9/10] MockPoolB');
  const { address: mockBAddr } = await deploy('MockPoolB', [vaultAddr, FUJI.USDC, 480], deployer);
  addresses.MockPoolB = mockBAddr;

  // Step 10: PaymentLedger (on-chain settlement record + double-pay guard)
  console.log('[10/10] PaymentLedger');
  const { address: ledgerAddr } = await deploy('PaymentLedger', [], deployer);
  addresses.PaymentLedger = ledgerAddr;

  // Write addresses file (used by all other scripts + agents + backend)
  const outputPath = path.join(__dirname, '..', 'deployed-addresses.json');
  const outputData = {
    ...addresses,
    USDC:       FUJI.USDC,
    network:    'fuji',
    chainId:    43113,
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
  };
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

  console.log('');
  console.log('✓ All 10 contracts deployed');
  console.log('✓ deployed-addresses.json written');
  console.log('');
  console.log('NEXT STEP:');
  console.log('  npx hardhat run scripts/post-deploy-setup.js --network fuji');
}

main().catch(err => { console.error(err); process.exit(1); });
