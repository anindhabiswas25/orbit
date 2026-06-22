const { ethers } = require('hardhat');
const ADDRESSES = require('../deployed-addresses.json');

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Wiring Verification');
  console.log('═══════════════════════════════════════════════════════\n');

  const feePool = await ethers.getContractAt('FeePool', ADDRESSES.FeePool);
  const ledger  = await ethers.getContractAt('PaymentLedger', ADDRESSES.PaymentLedger);
  const engine  = await ethers.getContractAt('AgentSelectionEngine', ADDRESSES.AgentSelectionEngine);

  const fpOrchestrator = await feePool.orchestrator();
  const fpVault = await feePool.vault();
  const ledgerOrchestrator = await ledger.orchestrator();
  const engineLedger = await engine.paymentLedger();
  const engineVault = await engine.vault();

  console.log('FeePool:');
  console.log('  orchestrator:', fpOrchestrator);
  console.log('  vault:       ', fpVault);
  console.log('');
  console.log('PaymentLedger:');
  console.log('  orchestrator:', ledgerOrchestrator);
  console.log('');
  console.log('AgentSelectionEngine:');
  console.log('  paymentLedger:', engineLedger);
  console.log('  vault:        ', engineVault);
  console.log('');

  const expected = '0x1a965c90dB06887944AAA3B72f62De04db9aFf20'.toLowerCase();
  const checks = [
    ['FeePool.orchestrator', fpOrchestrator.toLowerCase() === expected],
    ['PaymentLedger.orchestrator', ledgerOrchestrator.toLowerCase() === expected],
    ['Engine.paymentLedger → PaymentLedger', engineLedger.toLowerCase() === ADDRESSES.PaymentLedger.toLowerCase()],
    ['Engine.vault → YieldVault', engineVault.toLowerCase() === ADDRESSES.YieldVault.toLowerCase()],
    ['FeePool.vault → YieldVault', fpVault.toLowerCase() === ADDRESSES.YieldVault.toLowerCase()],
  ];

  console.log('Checks:');
  let allPass = true;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) allPass = false;
  }
  console.log('');
  console.log(allPass ? '✓ All wiring checks passed!' : '✗ SOME CHECKS FAILED');
}

main().catch(err => { console.error(err); process.exit(1); });
