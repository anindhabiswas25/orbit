// Register the Alpha Scout agent on Fuji.
// Generates a wallet (if ALPHA_SCOUT_KEY not in .env), funds it from the deployer,
// registers as scout, and authorizes in YieldRegistry.
//
// Run: node scripts/register-alpha-scout.js

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const ADDRESSES = require('../deployed-addresses.json');
const ENV_PATH  = path.join(__dirname, '..', '.env');

const SCOUT = 0;
const STAKE = ethers.parseUnits('5', 6);
const ERC20 = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'function transfer(address,uint256) returns(bool)',
];
const loadABI = (n) => require(`../artifacts/contracts/${n}.sol/${n}.json`).abi;

function appendEnv(key, value) {
  const line = `${key}=${value}`;
  let body = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (body.includes(`${key}=`)) return;
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
  console.log('  Orbit — Register Alpha Scout');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer: ${deployer.address}`);

  // Ensure deployer has enough USDC
  let bal = await usdcD.balanceOf(deployer.address);
  console.log(`  USDC:     ${ethers.formatUnits(bal, 6)}`);
  const needed = STAKE + ethers.parseUnits('0.5', 6);
  if (bal < needed) {
    const shares = await vault.getUserShares(deployer.address);
    if (shares > 0n) {
      console.log(`  Reclaiming deployer vault position to fund stake...`);
      await (await vault.withdraw(shares)).wait();
      bal = await usdcD.balanceOf(deployer.address);
      console.log(`  USDC now: ${ethers.formatUnits(bal, 6)}`);
    }
  }
  if (bal < needed) {
    throw new Error(`Deployer short on USDC (have ${ethers.formatUnits(bal, 6)}, need ${ethers.formatUnits(needed, 6)}). Top up via faucet.circle.com.`);
  }

  // Generate or load wallet
  let key = process.env.ALPHA_SCOUT_KEY;
  if (!key) {
    const w = ethers.Wallet.createRandom();
    key = w.privateKey;
    appendEnv('ALPHA_SCOUT_KEY', key);
    process.env.ALPHA_SCOUT_KEY = key;
    console.log('\n  Generated new wallet, saved ALPHA_SCOUT_KEY to .env');
  }
  const wallet = new ethers.Wallet(key, provider);
  console.log(`  Alpha Scout wallet: ${wallet.address}`);

  // Check if already registered
  const existing = await registry.getAgent(wallet.address);
  if (existing.wallet !== ethers.ZeroAddress && Number(existing.status) === 0) {
    console.log('  Already registered and active!');
    if (!(await yieldReg.authorizedAgents(wallet.address))) {
      await (await yieldReg.authorizeAgent(wallet.address)).wait();
      console.log('  Authorized in YieldRegistry');
    } else {
      console.log('  Already authorized in YieldRegistry');
    }
    printSummary(wallet);
    return;
  }

  // Fund AVAX for gas
  const avax = await provider.getBalance(wallet.address);
  if (avax < ethers.parseEther('0.05')) {
    const tx = await deployer.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.08') });
    await tx.wait();
    console.log('  Funded 0.08 AVAX for gas');
  } else {
    console.log(`  AVAX OK: ${ethers.formatEther(avax)}`);
  }

  // Fund USDC for stake
  const ub = await usdcD.balanceOf(wallet.address);
  if (ub < STAKE) {
    await (await usdcD.transfer(wallet.address, STAKE - ub)).wait();
    console.log('  Funded 5 USDC for stake');
  } else {
    console.log(`  USDC OK: ${ethers.formatUnits(ub, 6)}`);
  }

  // Approve + register as scout
  const usdcA = new ethers.Contract(ADDRESSES.USDC, ERC20, wallet);
  console.log('\n  Approving USDC...');
  await (await usdcA.approve(ADDRESSES.AgentRegistry, STAKE)).wait();

  const reg = new ethers.Contract(ADDRESSES.AgentRegistry, loadABI('AgentRegistry'), wallet);
  const endpoint = 'https://agents.orbit-protocol.xyz/alpha-scout/card';
  const fee = 40; // 0.40% — competitive fee to attract more job assignments
  console.log('  Registering...');
  const receipt = await (await reg.register(SCOUT, endpoint, fee, wallet.address)).wait();
  console.log(`  Registered! tx: ${receipt.hash}`);
  console.log(`  https://testnet.snowtrace.io/tx/${receipt.hash}`);

  // Authorize in YieldRegistry (required for scouts)
  console.log('\n  Authorizing in YieldRegistry...');
  await (await yieldReg.authorizeAgent(wallet.address)).wait();
  console.log('  Authorized!');

  printSummary(wallet);
}

function printSummary(wallet) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Alpha Scout — Ready');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Wallet:   ${wallet.address}`);
  console.log(`  Endpoint: https://agents.orbit-protocol.xyz/alpha-scout/card`);
  console.log(`  Fee:      0.40%`);
  console.log(`  Env key:  ALPHA_SCOUT_KEY (in .env)`);
  console.log(`  Stake:    5 USDC`);
  console.log('');
  console.log('  To run:');
  console.log('    AGENT_PRIVATE_KEY=$ALPHA_SCOUT_KEY AGENT_NAME=AlphaScout npm run alpha-scout');
  console.log('  Or:');
  console.log('    set -a; . ./.env; set +a');
  console.log('    AGENT_PRIVATE_KEY=$ALPHA_SCOUT_KEY npm run alpha-scout');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
