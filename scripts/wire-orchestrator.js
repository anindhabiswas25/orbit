// Wire the Orchestrator wallet as the sole payment authority.
// Run: ORCHESTRATOR_WALLET=0x... npx hardhat run scripts/wire-orchestrator.js --network fuji

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');

async function main() {
  const [deployer] = await ethers.getSigners();

  const ORCHESTRATOR = process.env.ORCHESTRATOR_WALLET;
  if (!ORCHESTRATOR) {
    throw new Error('Set ORCHESTRATOR_WALLET env var to the orchestrator wallet address');
  }

  console.log('Wiring Orchestrator:', ORCHESTRATOR);

  const feePool = await ethers.getContractAt('FeePool',              ADDRESSES.FeePool);
  const engine  = await ethers.getContractAt('AgentSelectionEngine', ADDRESSES.AgentSelectionEngine);
  const ledger  = await ethers.getContractAt('PaymentLedger',        ADDRESSES.PaymentLedger);

  await (await feePool.setOrchestrator(ORCHESTRATOR)).wait();
  console.log('✓ FeePool.setOrchestrator()');

  await (await engine.setPaymentLedger(ADDRESSES.PaymentLedger)).wait();
  console.log('✓ Engine.setPaymentLedger()');

  await (await ledger.setOrchestrator(ORCHESTRATOR)).wait();
  console.log('✓ PaymentLedger.setOrchestrator()');

  console.log('\n✓ Orchestrator wired. Deploy and start orchestrator process.');
}

main().catch(err => { console.error(err); process.exit(1); });
