// Register 4 agents on Fuji: 2 Scouts + 2 Executors
// Handles USDC funding, stake approval, on-chain registration, and YieldRegistry authorization.
// Run: node scripts/register-4-agents.js

const { ethers } = require('ethers');
const ADDRESSES  = require('../deployed-addresses.json');
require('dotenv').config();

const SCOUT    = 0;
const EXECUTOR = 1;
const STAKE    = ethers.parseUnits('5', 6); // 5 USDC

const ERC20_ABI = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'function transfer(address,uint256) returns(bool)',
];

function loadABI(name) {
  return require(`../artifacts/contracts/${name}.sol/${name}.json`).abi;
}

const AGENTS = [
  {
    name:     'Scout1-Alpha',
    key:      process.env.SCOUT1_PRIVATE_KEY,
    type:     SCOUT,
    endpoint: 'https://scout1.orbit-protocol.xyz/agent-card',
    fee:      50,  // 0.50% per job
    devWallet: process.env.SCOUT1_DEV_WALLET,
  },
  {
    name:     'Scout2-Beta',
    key:      process.env.SCOUT2_PRIVATE_KEY,
    type:     SCOUT,
    endpoint: 'https://scout2.orbit-protocol.xyz/agent-card',
    fee:      30,  // 0.30% per job
    devWallet: process.env.SCOUT2_DEV_WALLET,
  },
  {
    name:     'Executor1-Prime',
    key:      process.env.EXECUTOR1_PRIVATE_KEY,
    type:     EXECUTOR,
    endpoint: 'https://exec1.orbit-protocol.xyz/agent-card',
    fee:      50,  // 0.50% per job
    devWallet: process.env.EXECUTOR1_DEV_WALLET,
  },
  {
    name:     'Executor2-Rapid',
    key:      process.env.EXECUTOR2_PRIVATE_KEY,
    type:     EXECUTOR,
    endpoint: 'https://exec2.orbit-protocol.xyz/agent-card',
    fee:      40,  // 0.40% per job
    devWallet: process.env.EXECUTOR2_DEV_WALLET,
  },
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const registryABI = loadABI('AgentRegistry');
  const yieldRegABI = loadABI('YieldRegistry');
  const registry    = new ethers.Contract(ADDRESSES.AgentRegistry, registryABI, provider);
  const yieldReg    = new ethers.Contract(ADDRESSES.YieldRegistry, yieldRegABI, deployer);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Register 4 Agents (Fuji)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Registry: ${ADDRESSES.AgentRegistry}`);
  console.log('');

  for (let i = 0; i < AGENTS.length; i++) {
    const agent = AGENTS[i];
    const typeName = agent.type === SCOUT ? 'Scout' : 'Executor';

    if (!agent.key) {
      console.log(`  ⚠ Skipping ${agent.name}: no private key`);
      continue;
    }

    console.log(`\n[${i + 1}/${AGENTS.length}] ${agent.name} (${typeName})`);

    const agentWallet = new ethers.Wallet(agent.key, provider);
    console.log(`  Wallet: ${agentWallet.address}`);

    // Check if already registered
    const existing = await registry.getAgent(agentWallet.address);
    if (existing.wallet !== ethers.ZeroAddress && Number(existing.status) === 0) {
      console.log(`  • Already registered (rep=${existing.reputationScore}). Skipping.`);
      if (agent.type === SCOUT) {
        const isAuth = await yieldReg.authorizedAgents(agentWallet.address);
        if (!isAuth) {
          await (await yieldReg.authorizeAgent(agentWallet.address)).wait();
          console.log(`  ✓ Authorized in YieldRegistry`);
        } else {
          console.log(`  • Already authorized in YieldRegistry`);
        }
      }
      continue;
    }

    const reg = new ethers.Contract(ADDRESSES.AgentRegistry, registryABI, agentWallet);

    if (agent.type === EXECUTOR) {
      // Executors must stake 5 USDC
      const usdc = new ethers.Contract(ADDRESSES.USDC, ERC20_ABI, agentWallet);
      let balance = await usdc.balanceOf(agentWallet.address);
      console.log(`  USDC balance: ${Number(balance) / 1e6}`);

      if (balance < STAKE) {
        const deficit = STAKE - balance;
        console.log(`  Funding ${Number(deficit) / 1e6} USDC from deployer...`);
        const deployerUsdc = new ethers.Contract(ADDRESSES.USDC, ERC20_ABI, deployer);
        const tx = await deployerUsdc.transfer(agentWallet.address, deficit);
        await tx.wait();
        balance = await usdc.balanceOf(agentWallet.address);
        console.log(`  ✓ Funded. New balance: ${Number(balance) / 1e6} USDC`);
      }

      const approveTx = await usdc.approve(ADDRESSES.AgentRegistry, STAKE);
      await approveTx.wait();
      console.log(`  ✓ Stake approved (5 USDC)`);
    } else {
      console.log(`  Scout — free registration (no stake)`);
    }

    // Register
    const registerTx = await reg.register(agent.type, agent.endpoint, agent.fee, agent.devWallet);
    const receipt = await registerTx.wait();
    console.log(`  ✓ Registered on-chain. Tx: ${receipt.hash}`);

    // Authorize scouts in YieldRegistry
    if (agent.type === SCOUT) {
      const authTx = await yieldReg.authorizeAgent(agentWallet.address);
      await authTx.wait();
      console.log(`  ✓ Authorized in YieldRegistry`);
    }

    console.log(`  ✓ ${agent.name} ready`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Registration Summary');
  console.log('═══════════════════════════════════════════════════════');
  const scouts    = await registry.getAllScouts();
  const executors = await registry.getAllExecutors();
  console.log(`  Total Scouts:    ${scouts.length}`);
  console.log(`  Total Executors: ${executors.length}`);
  for (const w of [...scouts, ...executors]) {
    const a = await registry.getAgent(w);
    const type = Number(a.agentType) === 0 ? 'Scout' : 'Executor';
    console.log(`    ${type.padEnd(10)} ${w}  rep=${a.reputationScore}  fee=${a.fee}bps  stake=${Number(a.stake)/1e6}USDC`);
  }
  console.log('');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
