// Register two MORE intelligent agents on Fuji:
//   • MomentumScout  (scout)    — agents/scout/momentum-scout.js
//   • AdaptiveExec   (executor) — agents/executor/adaptive-executor.js
//
// Generates wallets if missing (persists keys to .env), funds them with USDC + AVAX
// from the deployer, registers + authorizes them. If the deployer is short on USDC,
// it first reclaims the deployer's own vault position.
//
// Run: node scripts/register-extra-agents.js

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const ADDRESSES = require('../deployed-addresses.json');
const ENV_PATH  = path.join(__dirname, '..', '.env');

const SCOUT = 0, EXECUTOR = 1;
const STAKE = ethers.parseUnits('5', 6);
const ERC20 = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'function transfer(address,uint256) returns(bool)',
];
const loadABI = (n) => require(`../artifacts/contracts/${n}.sol/${n}.json`).abi;

const NEW_AGENTS = [
  { name: 'MomentumScout', envKey: 'MOMENTUM_SCOUT_KEY', type: SCOUT,
    endpoint: 'https://agents.orbit-protocol.xyz/momentum-scout/card', fee: 45 },
  { name: 'AdaptiveExec',  envKey: 'ADAPTIVE_EXEC_KEY',  type: EXECUTOR,
    endpoint: 'https://agents.orbit-protocol.xyz/adaptive-executor/card', fee: 45 },
];

function appendEnv(key, value) {
  const line = `${key}=${value}`;
  let body = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (body.includes(`${key}=`)) return; // already present
  if (body.length && !body.endsWith('\n')) body += '\n';
  body += line + '\n';
  fs.writeFileSync(ENV_PATH, body);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const usdcD    = new ethers.Contract(ADDRESSES.USDC, ERC20, deployer);
  const registry = new ethers.Contract(ADDRESSES.AgentRegistry, loadABI('AgentRegistry'), provider);
  const yieldReg = new ethers.Contract(ADDRESSES.YieldRegistry, loadABI('YieldRegistry'), deployer);
  const vault    = new ethers.Contract(ADDRESSES.YieldVault, loadABI('YieldVault'), deployer);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit — Register 2 More Intelligent Agents');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer: ${deployer.address}`);

  // Ensure the deployer has enough USDC to stake both agents (10 USDC + buffer).
  let bal = await usdcD.balanceOf(deployer.address);
  console.log(`  USDC:     ${ethers.formatUnits(bal, 6)}`);
  const needed = STAKE * 2n + ethers.parseUnits('0.5', 6);
  if (bal < needed) {
    const shares = await vault.getUserShares(deployer.address);
    if (shares > 0n) {
      console.log(`  Reclaiming deployer vault position (${ethers.formatUnits(shares, 6)} shares) to fund stakes...`);
      await (await vault.withdraw(shares)).wait();
      bal = await usdcD.balanceOf(deployer.address);
      console.log(`  ✓ USDC now: ${ethers.formatUnits(bal, 6)}`);
    }
  }
  if (bal < needed) throw new Error(`Deployer still short on USDC (have ${ethers.formatUnits(bal, 6)}, need ${ethers.formatUnits(needed, 6)}). Top up via faucet.circle.com.`);
  console.log('');

  for (const a of NEW_AGENTS) {
    console.log(`\n[${a.name}] (${a.type === SCOUT ? 'scout' : 'executor'})`);

    // Generate + persist key if missing.
    let key = process.env[a.envKey];
    if (!key) {
      const w = ethers.Wallet.createRandom();
      key = w.privateKey;
      appendEnv(a.envKey, key);
      process.env[a.envKey] = key;
      console.log(`  generated wallet, saved ${a.envKey} to .env`);
    }
    const wallet = new ethers.Wallet(key, provider);
    console.log(`  Wallet: ${wallet.address}`);

    // Idempotency: skip if already registered + active.
    const existing = await registry.getAgent(wallet.address);
    if (existing.wallet !== ethers.ZeroAddress && Number(existing.status) === 0) {
      console.log('  • already registered, skipping');
      if (a.type === SCOUT && !(await yieldReg.authorizedAgents(wallet.address))) {
        await (await yieldReg.authorizeAgent(wallet.address)).wait();
        console.log('  ✓ authorized in YieldRegistry');
      }
      continue;
    }

    // Fund AVAX for gas.
    const avax = await provider.getBalance(wallet.address);
    if (avax < ethers.parseEther('0.05')) {
      await (await deployer.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.06') })).wait();
      console.log('  ✓ funded 0.06 AVAX');
    }
    // Fund USDC stake.
    const ub = await usdcD.balanceOf(wallet.address);
    if (ub < STAKE) {
      await (await usdcD.transfer(wallet.address, STAKE - ub)).wait();
      console.log('  ✓ funded 5 USDC');
    }

    // Approve + register (as the agent).
    const usdcA = new ethers.Contract(ADDRESSES.USDC, ERC20, wallet);
    await (await usdcA.approve(ADDRESSES.AgentRegistry, STAKE)).wait();
    const reg = new ethers.Contract(ADDRESSES.AgentRegistry, loadABI('AgentRegistry'), wallet);
    const receipt = await (await reg.register(a.type, a.endpoint, a.fee, wallet.address)).wait();
    console.log(`  ✓ registered (tx ${receipt.hash.slice(0, 12)}…)`);

    if (a.type === SCOUT) {
      await (await yieldReg.authorizeAgent(wallet.address)).wait();
      console.log('  ✓ authorized in YieldRegistry');
    }
  }

  // Summary.
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  New agents ready');
  console.log('═══════════════════════════════════════════════════════');
  for (const a of NEW_AGENTS) {
    const w = new ethers.Wallet(process.env[a.envKey]);
    console.log(`  ${a.name.padEnd(14)} ${w.address}`);
    console.log(`     endpoint: ${a.endpoint}`);
    console.log(`     fee:      ${(a.fee / 100).toFixed(2)}%   key: ${a.envKey} (in .env)`);
  }
  const scouts = await registry.getAllScouts();
  const execs  = await registry.getAllExecutors();
  console.log(`\n  Total registered: ${scouts.length} scouts + ${execs.length} executors`);
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
