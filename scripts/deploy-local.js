// Deploy the FULL Orbit stack to a LOCAL Hardhat node for e2e testing.
//
// Unlike scripts/deploy.js (which targets Fuji and uses live AAVE/Benqi/USDC
// addresses), this script deploys a MockERC20 to stand in for USDC and points
// the AAVE/Benqi adapters at harmless placeholders. Real fund routing only ever
// happens through MockPoolA / MockPoolB, so the AAVE/Benqi adapters are never
// asked to move money (their getAPY() is try/catch-guarded and returns 0).
//
// Run:  npx hardhat run scripts/deploy-local.js --network localhost
//
// Writes deployed-addresses.json pointing at the local node and mints USDC to
// the deployer + three test agent accounts.

const { ethers } = require('hardhat');
const fs   = require('fs');
const path = require('path');

async function deploy(name, args, deployer) {
  const Factory  = await ethers.getContractFactory(name, deployer);
  const contract = await Factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ✓ ${name.padEnd(22)} ${address}`);
  return { contract, address };
}

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, agentA, agentB, agentC] = signers;
  const net = await ethers.provider.getNetwork();

  if (net.chainId !== 31337n) {
    throw new Error(`deploy-local is for the local hardhat node only (got chainId ${net.chainId})`);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — LOCAL Deployment (e2e harness)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer: ${deployer.address}`);
  console.log('');

  // ── Mock USDC ──────────────────────────────────────────────────────────────
  console.log('Deploying mock USDC + protocol stack...');
  const { contract: usdc, address: usdcAddr } =
    await deploy('MockERC20', ['USD Coin', 'USDC', 6], deployer);

  // Mint USDC: 1,000,000 to deployer (the "user"), 100 to each agent for stakes.
  const oneUSDC = 1_000_000n; // 1 USDC, 6 decimals
  await (await usdc.mint(deployer.address, 1_000_000n * oneUSDC)).wait();
  for (const a of [agentA, agentB, agentC]) {
    await (await usdc.mint(a.address, 100n * oneUSDC)).wait();
  }

  // ── Core contracts (same dependency order as deploy.js) ──────────────────────
  const { address: feePoolAddr } = await deploy('FeePool',       [usdcAddr], deployer);
  const { address: registryAddr } = await deploy('AgentRegistry', [usdcAddr], deployer);
  const { address: yieldRegAddr } = await deploy('YieldRegistry', [],        deployer);
  const { address: engineAddr } = await deploy(
    'AgentSelectionEngine', [registryAddr, yieldRegAddr, feePoolAddr], deployer);
  const { address: vaultAddr } = await deploy(
    'YieldVault', [usdcAddr, engineAddr, feePoolAddr], deployer);

  // AAVE / Benqi adapters — placeholders point at the mock USDC (no protocol on
  // a local node). They are registered but never used for routing.
  const { address: aaveAddr }  = await deploy(
    'AaveAdapter',  [vaultAddr, usdcAddr, usdcAddr, usdcAddr, usdcAddr], deployer);
  const { address: benqiAddr } = await deploy(
    'BenqiAdapter', [vaultAddr, usdcAddr, usdcAddr], deployer);
  const { address: mockAAddr } = await deploy('MockPoolA', [vaultAddr, usdcAddr, 500], deployer);
  const { address: mockBAddr } = await deploy('MockPoolB', [vaultAddr, usdcAddr, 480], deployer);
  const { address: ledgerAddr } = await deploy('PaymentLedger', [], deployer);

  // ── Cross-contract wiring (mirrors post-deploy-setup.js) ─────────────────────
  console.log('');
  console.log('Wiring contracts + registering adapters...');
  const registry = await ethers.getContractAt('AgentRegistry',        registryAddr, deployer);
  const engine   = await ethers.getContractAt('AgentSelectionEngine', engineAddr,   deployer);
  const feePool  = await ethers.getContractAt('FeePool',              feePoolAddr,  deployer);
  const yieldReg = await ethers.getContractAt('YieldRegistry',        yieldRegAddr, deployer);
  const ledger   = await ethers.getContractAt('PaymentLedger',        ledgerAddr,   deployer);

  await (await registry.setSelectionEngine(engineAddr)).wait();
  await (await engine.setVault(vaultAddr)).wait();
  await (await engine.setPaymentLedger(ledgerAddr)).wait();
  // Deployer acts as orchestrator in local tests
  await (await feePool.setOrchestrator(deployer.address)).wait();
  await (await feePool.setVault(vaultAddr)).wait();
  await (await ledger.setOrchestrator(deployer.address)).wait();
  await (await yieldReg.setSelectionEngine(engineAddr)).wait();
  await (await yieldReg.registerAdapter(aaveAddr,  'AAVE V3')).wait();
  await (await yieldReg.registerAdapter(benqiAddr, 'Benqi')).wait();
  await (await yieldReg.registerAdapter(mockAAddr, 'MockPoolA')).wait();
  await (await yieldReg.registerAdapter(mockBAddr, 'MockPoolB')).wait();

  // Authorize the three test agent wallets so their scout can call
  // updateBestProtocol() (the protocol operator does this after registration).
  for (const a of [agentA, agentB, agentC]) {
    await (await yieldReg.authorizeAgent(a.address)).wait();
  }

  // ── Write deployed-addresses.json ────────────────────────────────────────────
  const out = {
    FeePool:              feePoolAddr,
    AgentRegistry:        registryAddr,
    YieldRegistry:        yieldRegAddr,
    AgentSelectionEngine: engineAddr,
    YieldVault:           vaultAddr,
    AaveAdapter:          aaveAddr,
    BenqiAdapter:         benqiAddr,
    MockPoolA:            mockAAddr,
    MockPoolB:            mockBAddr,
    PaymentLedger:        ledgerAddr,
    USDC:                 usdcAddr,
    network:              'localhost',
    chainId:              31337,
    deployedAt:           new Date().toISOString(),
    deployedBy:           deployer.address,
  };
  fs.writeFileSync(
    path.join(__dirname, '..', 'deployed-addresses.json'),
    JSON.stringify(out, null, 2)
  );

  console.log('');
  console.log('✓ Local stack deployed, wired, agents authorized');
  console.log('✓ deployed-addresses.json written (chainId 31337)');
}

main().catch(err => { console.error(err); process.exit(1); });
