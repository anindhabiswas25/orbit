// Wire all cross-contract references after deployment.
// MUST run immediately after deploy.js completes.
// Run: npx hardhat run scripts/post-deploy-setup.js --network fuji

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');

async function getContract(name, address, signer) {
  const factory = await ethers.getContractFactory(name, signer);
  return factory.attach(address);
}

async function tx(label, promise) {
  process.stdout.write(`  ${label.padEnd(55)}... `);
  const receipt = await (await promise).wait();
  console.log(`✓  (${receipt.hash.slice(0, 12)}...)`);
  return receipt;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Post-Deploy Setup');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log('');

  const feePool  = await getContract('FeePool',              ADDRESSES.FeePool,              deployer);
  const registry = await getContract('AgentRegistry',        ADDRESSES.AgentRegistry,        deployer);
  const yieldReg = await getContract('YieldRegistry',        ADDRESSES.YieldRegistry,        deployer);
  const engine   = await getContract('AgentSelectionEngine', ADDRESSES.AgentSelectionEngine, deployer);
  const ledger   = await getContract('PaymentLedger',        ADDRESSES.PaymentLedger,        deployer);

  console.log('Wiring cross-contract references...');
  console.log('');

  // Wire AgentRegistry → knows the engine (so engine can update reputation)
  await tx('AgentRegistry.setSelectionEngine(engine)',
    registry.setSelectionEngine(ADDRESSES.AgentSelectionEngine));

  // Wire AgentSelectionEngine → knows the vault (so engine can rebalance)
  await tx('AgentSelectionEngine.setVault(vault)',
    engine.setVault(ADDRESSES.YieldVault));

  // Wire FeePool → orchestrator (deployer acts as initial orchestrator) + vault
  const orchestratorAddr = process.env.ORCHESTRATOR_WALLET || deployer.address;
  await tx(`FeePool.setOrchestrator(${orchestratorAddr.slice(0,10)}...)`,
    feePool.setOrchestrator(orchestratorAddr));
  await tx('FeePool.setVault(vault)',
    feePool.setVault(ADDRESSES.YieldVault));

  // Wire PaymentLedger → orchestrator
  await tx(`PaymentLedger.setOrchestrator(${orchestratorAddr.slice(0,10)}...)`,
    ledger.setOrchestrator(orchestratorAddr));

  // Wire AgentSelectionEngine → PaymentLedger
  await tx('AgentSelectionEngine.setPaymentLedger(ledger)',
    engine.setPaymentLedger(ADDRESSES.PaymentLedger));

  // Wire YieldRegistry → knows the engine (so engine can call logRebalance)
  await tx('YieldRegistry.setSelectionEngine(engine)',
    yieldReg.setSelectionEngine(ADDRESSES.AgentSelectionEngine));

  console.log('');
  console.log('Registering adapters in YieldRegistry...');
  console.log('');

  await tx('YieldRegistry.registerAdapter(AaveAdapter,  "AAVE V3")',
    yieldReg.registerAdapter(ADDRESSES.AaveAdapter,  'AAVE V3'));
  await tx('YieldRegistry.registerAdapter(BenqiAdapter, "Benqi")',
    yieldReg.registerAdapter(ADDRESSES.BenqiAdapter, 'Benqi'));
  await tx('YieldRegistry.registerAdapter(MockPoolA,    "MockPoolA")',
    yieldReg.registerAdapter(ADDRESSES.MockPoolA,    'MockPoolA'));
  await tx('YieldRegistry.registerAdapter(MockPoolB,    "MockPoolB")',
    yieldReg.registerAdapter(ADDRESSES.MockPoolB,    'MockPoolB'));

  console.log('');
  console.log('✓ Post-deploy setup complete');
  console.log('');
  console.log('NEXT STEPS:');
  console.log('  1. Register demo agents:');
  console.log('     npx hardhat run scripts/register-demo-agents.js --network fuji');
  console.log('  2. Seed vault with USDC:');
  console.log('     npx hardhat run scripts/seed-vault.js --network fuji');
  console.log('  3. Verify contracts on SnowTrace:');
  console.log('     npx hardhat run scripts/verify-contracts.js --network fuji');
}

main().catch(err => { console.error(err); process.exit(1); });
