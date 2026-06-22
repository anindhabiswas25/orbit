// Registers the 3 demo agents that power the live Orbit yield demo on Fuji.
//
//   Agent A (ReliableScout):  type=Scout     fee=50bps  — primary scout
//   Agent B (FastScout):      type=Scout     fee=30bps  — backup scout (wins when A is down/slashed)
//   Agent C (PrimeExecutor):  type=Executor  fee=50bps  — rebalances the vault into the best pool
//
// Reputation is NOT seeded here. Every agent starts at rep=0 and earns reputation
// the real way — +1 for each job it actually completes once you run the agent
// processes + `npm run demo`. See docs/test-e2e.md (the 3-agent yield demo).
//
// Each agent wallet must already hold 5 USDC (stake) + ~0.1 AVAX (gas) on Fuji.
//   USDC faucet: https://faucet.circle.com  (select Avalanche Fuji)
//   AVAX faucet: https://core.app/tools/testnet-faucet/
//
// Run: npx hardhat run scripts/register-demo-agents.js --network fuji
//  or: npm run register-demo

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');
require('dotenv').config();

const SCOUT    = 0;
const EXECUTOR = 1;

const DEMO_AGENTS = [
  {
    name:      'ReliableScout',
    key:       process.env.DEMO_AGENT_A_KEY,
    type:      SCOUT,
    endpoint:  'https://demo-a.orbit.xyz/agent-card',
    fee:       50,
    devWallet: process.env.DEMO_DEV_WALLET_A,
  },
  {
    name:      'FastScout',
    key:       process.env.DEMO_AGENT_B_KEY,
    type:      SCOUT,
    endpoint:  'https://demo-b.orbit.xyz/agent-card',
    fee:       30,
    devWallet: process.env.DEMO_DEV_WALLET_B,
  },
  {
    name:      'PrimeExecutor',
    key:       process.env.DEMO_AGENT_C_KEY,
    type:      EXECUTOR,
    endpoint:  'https://demo-c.orbit.xyz/agent-card',
    fee:       50,
    devWallet: process.env.DEMO_DEV_WALLET_C,
  },
];

const ERC20_ABI = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Orbit Protocol — Register Demo Agents (Fuji)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer/owner: ${deployer.address}`);
  console.log(`  AgentRegistry:  ${ADDRESSES.AgentRegistry}`);
  console.log('');

  const provider    = deployer.provider;
  const registryABI = (await ethers.getContractFactory('AgentRegistry')).interface;
  const yieldRegABI = (await ethers.getContractFactory('YieldRegistry')).interface;

  const registry = new ethers.Contract(ADDRESSES.AgentRegistry, registryABI, deployer);
  const yieldReg = new ethers.Contract(ADDRESSES.YieldRegistry, yieldRegABI, deployer);

  for (const agent of DEMO_AGENTS) {
    const typeName = agent.type === SCOUT ? 'Scout' : 'Executor';

    if (!agent.key) {
      console.log(`  ⚠ Skipping ${agent.name}: no private key in .env`);
      continue;
    }
    if (!agent.devWallet || !ethers.isAddress(agent.devWallet)) {
      console.log(`  ⚠ Skipping ${agent.name}: invalid dev wallet in .env`);
      continue;
    }

    console.log(`\n[${DEMO_AGENTS.indexOf(agent) + 1}/${DEMO_AGENTS.length}] ${agent.name} (${typeName})`);

    const agentWallet = new ethers.Wallet(agent.key, provider);
    const usdc        = new ethers.Contract(ADDRESSES.USDC, ERC20_ABI, agentWallet);
    const reg         = registry.connect(agentWallet);

    // Idempotency: skip if already registered & active.
    const existing = await registry.getAgent(agentWallet.address);
    if (existing.wallet !== ethers.ZeroAddress && Number(existing.status) === 0) {
      console.log(`  • Already registered (rep=${existing.reputationScore}). Skipping registration.`);
      if (agent.type === SCOUT) {
        await (await yieldReg.authorizeAgent(agentWallet.address)).wait();
        console.log(`  ✓ Re-confirmed YieldRegistry authorization`);
      }
      continue;
    }

    const balance = await usdc.balanceOf(agentWallet.address);
    if (balance < ethers.parseUnits('5', 6)) {
      throw new Error(
        `${agent.name} wallet (${agentWallet.address}) has ${Number(balance) / 1e6} USDC. Needs 5 USDC stake.\n` +
        '  USDC faucet: https://faucet.circle.com (Avalanche Fuji)\n' +
        '  AVAX faucet: https://core.app/tools/testnet-faucet/'
      );
    }

    // 1. Approve the 5 USDC stake to the registry.
    await (await usdc.approve(ADDRESSES.AgentRegistry, ethers.parseUnits('5', 6))).wait();
    console.log(`  ✓ Stake approved (5 USDC)`);

    // 2. Register on-chain (locks the stake).
    await (await reg.register(agent.type, agent.endpoint, agent.fee, agent.devWallet)).wait();
    console.log(`  ✓ Registered  wallet=${agentWallet.address}  fee=${agent.fee}bps  dev=${agent.devWallet}`);

    // 3. Scouts must be authorized in YieldRegistry to post results (owner-only).
    //    Executors do NOT post to YieldRegistry — the engine writes on their behalf.
    if (agent.type === SCOUT) {
      await (await yieldReg.authorizeAgent(agentWallet.address)).wait();
      console.log(`  ✓ Authorized in YieldRegistry (can post best-protocol results)`);
    }

    console.log(`  ✓ ${agent.name} ready — rep starts at 0, earned live`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✓ Demo agents registered. Reputation starts at 0 for all.');
  console.log('');
  console.log('NEXT STEPS (earn real reputation + run the yield demo):');
  console.log('  1. Seed the vault:     npm run seed');
  console.log('  2. Start the agents in separate terminals:');
  console.log('       AGENT_PRIVATE_KEY=$DEMO_AGENT_A_KEY AGENT_NAME=ReliableScout npm run scout');
  console.log('       AGENT_PRIVATE_KEY=$DEMO_AGENT_B_KEY AGENT_NAME=FastScout    npm run scout');
  console.log('       AGENT_PRIVATE_KEY=$DEMO_AGENT_C_KEY AGENT_NAME=PrimeExecutor npm run executor');
  console.log('  3. Drive live cycles:  npm run demo');
  console.log('  4. Watch reputation climb: orbit status --agent <name>  (after orbit import)');
}

main().catch(err => { console.error(err); process.exit(1); });
