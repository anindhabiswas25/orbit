// Quick connection test — verifies the orchestrator can connect to Fuji
// and read all contract state.
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

function loadABI(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'chain', 'abis', name + '.json'), 'utf8'));
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
  const wallet = new ethers.Wallet(process.env.ORCHESTRATOR_PRIVATE_KEY, provider);
  const net = await provider.getNetwork();

  console.log('Network:', net.name, '(chainId:', Number(net.chainId) + ')');
  console.log('Orchestrator wallet:', wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log('AVAX balance:', ethers.formatEther(balance));

  const feePool = new ethers.Contract(process.env.CONTRACT_FEE_POOL, loadABI('FeePool'), wallet);
  const ledger = new ethers.Contract(process.env.CONTRACT_PAYMENT_LEDGER, loadABI('PaymentLedger'), wallet);
  const engine = new ethers.Contract(process.env.CONTRACT_AGENT_SELECTION_ENGINE, loadABI('AgentSelectionEngine'), wallet);

  const poolBal = await feePool.getBalance();
  const fpOrch = await feePool.orchestrator();
  const ldOrch = await ledger.orchestrator();
  const nextJob = await engine.nextJobId();

  console.log('\nFeePool balance:', Number(poolBal) / 1e6, 'USDC');
  console.log('FeePool.orchestrator:', fpOrch);
  console.log('PaymentLedger.orchestrator:', ldOrch);
  console.log('Engine.nextJobId:', Number(nextJob));

  const isMyWallet = fpOrch.toLowerCase() === wallet.address.toLowerCase()
    && ldOrch.toLowerCase() === wallet.address.toLowerCase();
  console.log('\n' + (isMyWallet
    ? '✓ Orchestrator wallet is authorized on both FeePool and PaymentLedger'
    : '✗ MISMATCH — orchestrator wallet not authorized'));
}

main().catch(err => { console.error(err); process.exit(1); });
