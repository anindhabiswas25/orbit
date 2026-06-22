// Verify all deployed contracts on SnowTrace (Avalanche Fuji explorer).
// Requires SNOWTRACE_API_KEY in .env.
// Run: npx hardhat run scripts/verify-contracts.js --network fuji

const { run }    = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');
require('dotenv').config();

const FUJI = {
  USDC:               '0x3E937B4881CBd500d05EeDAB7BA203f2b7B3f74f',
  AAVE_POOL:          '0x4b8D85eDa37cAFBDd8E66d0B0DE63AB4E1D40c6',
  AAVE_DATA_PROVIDER: '0x8f57153F18b7273f9A814b93b31Cb3f9b035e7C2',
  AAVE_AUSDC:         '0x9daBC9860F8792AeE427808BDeF1f77eFeA4E3B',
  BENQI_QIUSDC:       '0x7c926c29a2E3Ef3C425Ea4CBa0B01fb9ad14Ab2',
};

async function verify(address, contractName, constructorArguments) {
  console.log(`\nVerifying ${contractName} at ${address}...`);
  try {
    await run('verify:verify', { address, constructorArguments });
    console.log(`  ✓ ${contractName} verified`);
  } catch (err) {
    if (err.message.toLowerCase().includes('already verified')) {
      console.log(`  ✓ ${contractName} already verified`);
    } else {
      console.log(`  ✗ ${contractName} verification failed: ${err.message}`);
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Contract Verification (SnowTrace)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Explorer: https://testnet.snowtrace.io`);
  console.log('');

  await verify(ADDRESSES.FeePool, 'FeePool', [FUJI.USDC]);
  await verify(ADDRESSES.AgentRegistry, 'AgentRegistry', [FUJI.USDC]);
  await verify(ADDRESSES.YieldRegistry, 'YieldRegistry', []);
  await verify(ADDRESSES.AgentSelectionEngine, 'AgentSelectionEngine', [
    ADDRESSES.AgentRegistry,
    ADDRESSES.YieldRegistry,
    ADDRESSES.FeePool,
  ]);
  await verify(ADDRESSES.YieldVault, 'YieldVault', [
    FUJI.USDC,
    ADDRESSES.AgentSelectionEngine,
    ADDRESSES.FeePool,
  ]);
  await verify(ADDRESSES.AaveAdapter, 'AaveAdapter', [
    ADDRESSES.YieldVault,
    FUJI.AAVE_POOL,
    FUJI.AAVE_DATA_PROVIDER,
    FUJI.USDC,
    FUJI.AAVE_AUSDC,
  ]);
  await verify(ADDRESSES.BenqiAdapter, 'BenqiAdapter', [
    ADDRESSES.YieldVault,
    FUJI.BENQI_QIUSDC,
    FUJI.USDC,
  ]);
  await verify(ADDRESSES.MockPoolA, 'MockPoolA', [ADDRESSES.YieldVault, FUJI.USDC, 500]);
  await verify(ADDRESSES.MockPoolB, 'MockPoolB', [ADDRESSES.YieldVault, FUJI.USDC, 480]);

  console.log('');
  console.log('✓ Verification complete');
  console.log('');
  console.log('View contracts on SnowTrace:');
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) {
      console.log(`  ${name.padEnd(25)} https://testnet.snowtrace.io/address/${addr}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
