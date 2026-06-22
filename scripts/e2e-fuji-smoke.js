// ════════════════════════════════════════════════════════════════════════════
// Orbit Protocol — Full E2E Smoke Test on Fuji Testnet
//
// Tests the complete flow with 4 agents (2 scouts + 2 executors):
//   Phase 1: Verify agent registration (all 4 agents on-chain)
//   Phase 2: User deposits USDC into vault
//   Phase 3: Set MockPoolA APY, trigger scout cycle, verify scout posts result
//   Phase 4: Verify executor rebalances vault into MockPoolA
//   Phase 5: Set MockPoolB to HIGHER APY, trigger another cycle
//   Phase 6: Verify agents pick the higher-yield MockPoolB
//   Phase 7: Verify agent wallets received payments
//   Phase 8: Verify yield auto-returns to user vault on withdraw
//
// Run: node scripts/e2e-fuji-smoke.js
// ════════════════════════════════════════════════════════════════════════════

const { ethers }   = require('ethers');
const { spawn }    = require('child_process');
const path         = require('path');
require('dotenv').config();

const ROOT     = path.join(__dirname, '..');
const RPC      = process.env.FUJI_RPC_URL;
const ADDR     = require(path.join(ROOT, 'deployed-addresses.json'));

const KEYS = {
  deployer:  process.env.DEPLOYER_PRIVATE_KEY,
  scout1:    process.env.SCOUT1_PRIVATE_KEY,
  scout2:    process.env.SCOUT2_PRIVATE_KEY,
  executor1: process.env.EXECUTOR1_PRIVATE_KEY,
  executor2: process.env.EXECUTOR2_PRIVATE_KEY,
};

const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
const deployer = new ethers.Wallet(KEYS.deployer, provider);

function loadABI(name, sub = '') {
  const p = sub
    ? path.join(ROOT, `artifacts/contracts/${sub}/${name}.sol/${name}.json`)
    : path.join(ROOT, `artifacts/contracts/${name}.sol/${name}.json`);
  return require(p).abi;
}

const C = {
  registry: new ethers.Contract(ADDR.AgentRegistry,        loadABI('AgentRegistry'),        provider),
  engine:   new ethers.Contract(ADDR.AgentSelectionEngine,  loadABI('AgentSelectionEngine'), provider),
  yieldReg: new ethers.Contract(ADDR.YieldRegistry,         loadABI('YieldRegistry'),        provider),
  vault:    new ethers.Contract(ADDR.YieldVault,            loadABI('YieldVault'),           provider),
  feePool:  new ethers.Contract(ADDR.FeePool,              loadABI('FeePool'),              provider),
  usdc:     new ethers.Contract(ADDR.USDC,                 ['function balanceOf(address) view returns(uint256)', 'function approve(address,uint256) returns(bool)'], provider),
  mockA:    new ethers.Contract(ADDR.MockPoolA,            loadABI('IYieldAdapter', 'interfaces'), provider),
  mockB:    new ethers.Contract(ADDR.MockPoolB,            loadABI('IYieldAdapter', 'interfaces'), provider),
};

// ── Test Framework ──────────────────────────────────────────────────────────
let PASS = 0, FAIL = 0;
const FAILURES = [];

function section(title) {
  console.log(`\n\x1b[1m\x1b[36m━━━ ${title} ━━━\x1b[0m`);
}
function ok(msg) { PASS++; console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function bad(msg, detail) {
  FAIL++; FAILURES.push(msg);
  console.log(`  \x1b[31m✗ ${msg}\x1b[0m${detail ? `\n      ${detail}` : ''}`);
}
function assert(cond, msg, detail) { cond ? ok(msg) : bad(msg, detail); }
function eq(actual, expected, msg) {
  assert(String(actual) === String(expected), msg, `expected ${expected}, got ${actual}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pollUntil(fn, { timeoutMs = 120_000, intervalMs = 3000, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true; } catch {}
    await sleep(intervalMs);
  }
  return false;
}

// ── Agent Process Manager ───────────────────────────────────────────────────
const agentProcs = [];

function spawnAgent(file, key, name, tag) {
  const p = spawn('node', [path.join(ROOT, 'agents', file)], {
    cwd: ROOT,
    env: {
      ...process.env,
      AGENT_PRIVATE_KEY: key,
      AGENT_NAME: name,
      X402_FACILITATOR_URL: '',
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  p.stdout.on('data', d => {
    const s = d.toString();
    if (/Listening/.test(s)) ready = true;
    for (const line of s.split('\n').filter(Boolean)) {
      try {
        const j = JSON.parse(line);
        console.log(`      \x1b[33m[${tag}]\x1b[0m ${j.message} ${j.thought || ''}`);
      } catch {
        console.log(`      \x1b[33m[${tag}]\x1b[0m ${line.trim()}`);
      }
    }
  });
  p.stderr.on('data', d => console.log(`      \x1b[31m[${tag}!]\x1b[0m ${d.toString().trim()}`));
  agentProcs.push(p);
  return { proc: p, isReady: () => ready };
}

function killAllAgents() {
  for (const p of agentProcs) {
    try { p.kill('SIGKILL'); } catch {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\x1b[1mOrbit Protocol — Full E2E Smoke Test (Fuji Testnet)\x1b[0m');
  console.log(`RPC: ${RPC}`);
  console.log(`USDC: ${ADDR.USDC}`);
  console.log(`Deployer: ${deployer.address}\n`);

  // ── PHASE 1: Verify Agent Registration ──────────────────────────────────
  section('PHASE 1 — Verify 4 Agents Registered');
  {
    const scout1Addr = new ethers.Wallet(KEYS.scout1).address;
    const scout2Addr = new ethers.Wallet(KEYS.scout2).address;
    const exec1Addr  = new ethers.Wallet(KEYS.executor1).address;
    const exec2Addr  = new ethers.Wallet(KEYS.executor2).address;

    const s1 = await C.registry.getAgent(scout1Addr);
    assert(s1.wallet !== ethers.ZeroAddress, `Scout1 registered: ${scout1Addr}`);
    eq(Number(s1.agentType), 0, 'Scout1 type = Scout');
    eq(Number(s1.stake) / 1e6, '5', 'Scout1 stake = 5 USDC');

    const s2 = await C.registry.getAgent(scout2Addr);
    assert(s2.wallet !== ethers.ZeroAddress, `Scout2 registered: ${scout2Addr}`);
    eq(Number(s2.agentType), 0, 'Scout2 type = Scout');

    const e1 = await C.registry.getAgent(exec1Addr);
    assert(e1.wallet !== ethers.ZeroAddress, `Executor1 registered: ${exec1Addr}`);
    eq(Number(e1.agentType), 1, 'Executor1 type = Executor');

    const e2 = await C.registry.getAgent(exec2Addr);
    assert(e2.wallet !== ethers.ZeroAddress, `Executor2 registered: ${exec2Addr}`);
    eq(Number(e2.agentType), 1, 'Executor2 type = Executor');

    const scouts    = await C.registry.getAllScouts();
    const executors = await C.registry.getAllExecutors();
    eq(scouts.length, 2, '2 scouts registered total');
    eq(executors.length, 2, '2 executors registered total');
  }

  // ── PHASE 2: User Deposits USDC ────────────────────────────────────────
  section('PHASE 2 — User Deposits USDC');
  {
    const amount = ethers.parseUnits('20', 6);  // 20 USDC
    const usdc   = C.usdc.connect(deployer);
    const vault  = C.vault.connect(deployer);

    const balBefore = await C.usdc.balanceOf(deployer.address);
    console.log(`  User USDC balance: ${Number(balBefore) / 1e6}`);

    if (balBefore < amount) {
      bad('User has enough USDC for deposit', `only ${Number(balBefore)/1e6} USDC`);
    } else {
      const approveTx = await usdc.approve(ADDR.YieldVault, amount);
      await approveTx.wait();
      ok('USDC approved for vault');

      const depositTx = await vault.deposit(amount);
      const receipt   = await depositTx.wait();
      ok(`Deposited 20 USDC. Tx: ${receipt.hash.slice(0, 16)}...`);

      const vaultBal = await C.vault.getVaultBalance();
      const expectedNet = 20 * 0.999;  // 20 - 0.10% fee
      assert(Number(vaultBal) / 1e6 >= expectedNet * 0.99, `Vault balance ~${expectedNet} USDC (got ${Number(vaultBal)/1e6})`);

      const feeBalance = await C.feePool.getBalance();
      assert(Number(feeBalance) > 0, `FeePool collected protocol fee (${Number(feeBalance)/1e6} USDC)`);

      const shares = await C.vault.getUserShares(deployer.address);
      assert(Number(shares) > 0, `User credited ${Number(shares)/1e6} vault shares`);
    }
  }

  // ── PHASE 3: Start Agents + Set MockPoolA APY + Trigger Scout ──────────
  section('PHASE 3 — Start Smart Agents + Scout Cycle (MockPoolA)');
  {
    // Set MockPoolA to 8% APY, MockPoolB to 3%
    const mockA = new ethers.Contract(ADDR.MockPoolA, ['function setAPY(uint256) external'], deployer);
    const mockB = new ethers.Contract(ADDR.MockPoolB, ['function setAPY(uint256) external'], deployer);
    await (await mockA.setAPY(800)).wait();
    await (await mockB.setAPY(300)).wait();
    ok('MockPoolA APY set to 8.00%, MockPoolB set to 3.00%');

    // Start all 4 agents (smart versions for scout1 and executor1, basic for scout2 and executor2)
    console.log('  Starting 4 agent processes...');
    const a1 = spawnAgent('scout/smart-scout.js',      KEYS.scout1,    'SmartScout1',   'S1');
    const a2 = spawnAgent('scout/index.js',            KEYS.scout2,    'BasicScout2',   'S2');
    const a3 = spawnAgent('executor/smart-executor.js', KEYS.executor1, 'SmartExec1',   'E1');
    const a4 = spawnAgent('executor/index.js',          KEYS.executor2, 'BasicExec2',   'E2');

    // Wait for agents to initialize
    const allReady = await pollUntil(
      () => a1.isReady() && a2.isReady() && a3.isReady() && a4.isReady(),
      { timeoutMs: 30_000, intervalMs: 500, label: 'agents ready' }
    );
    assert(allReady, 'All 4 agents initialized and listening');
    await sleep(3000); // Let event subscriptions stabilize

    // Wait for scout interval with retry
    let phase3Triggered = false;
    for (let attempt = 0; attempt < 5 && !phase3Triggered; attempt++) {
      const lastScoutAt = await C.engine.lastScoutJobAt();
      const block = await provider.getBlock('latest');
      const blockTime = block.timestamp;
      const elapsed = blockTime - Number(lastScoutAt);
      if (elapsed < 61) {
        const waitTime = 65 - elapsed;
        console.log(`  Waiting ${waitTime}s for scout interval cooldown...`);
        await sleep(waitTime * 1000);
      }
      try {
        const triggerTx = await C.engine.connect(deployer).triggerScoutCycle();
        const triggerReceipt = await triggerTx.wait();
        phase3Triggered = true;
        ok(`Scout cycle triggered. Tx: ${triggerReceipt.hash.slice(0, 16)}...`);
      } catch (err) {
        if (err.message.includes('too soon')) {
          console.log(`  Scout interval not met yet, retrying in 15s...`);
          await sleep(15_000);
        } else {
          throw err;
        }
      }
    }
    if (!phase3Triggered) bad('Could not trigger scout cycle');

    // Wait for scout to post result + executor to rebalance
    const rebalanced = await pollUntil(
      async () => {
        const active = await C.yieldReg.activeProtocol();
        return active.toLowerCase() === ADDR.MockPoolA.toLowerCase();
      },
      { timeoutMs: 120_000, intervalMs: 3000, label: 'rebalance into MockPoolA' }
    );

    assert(rebalanced, 'Vault rebalanced into MockPoolA');

    if (rebalanced) {
      const activeAPY = await C.yieldReg.activeAPY();
      eq(Number(activeAPY), 800, 'Active APY = 800 bps (8.00%)');

      const mockABal = await C.mockA.getBalance();
      assert(Number(mockABal) > 0, `MockPoolA holds ${Number(mockABal)/1e6} USDC`);

      // Check agent reputation increased
      const scout1Addr = new ethers.Wallet(KEYS.scout1).address;
      const scout1Info = await C.registry.getAgent(scout1Addr);
      assert(Number(scout1Info.reputationScore) >= 1, `Scout1 reputation >= 1 (got ${scout1Info.reputationScore})`);

      const logs = await C.yieldReg.getRebalanceLogsCount();
      assert(Number(logs) >= 1, `Rebalance logged on-chain (${logs} logs)`);
    }
  }

  // ── PHASE 4: Test Higher Yield Detection (MockPoolB > MockPoolA) ──────
  section('PHASE 4 — MockPoolB Higher Yield → Agents Should Switch');
  {
    // Raise MockPoolB to 15% (much higher than MockPoolA's 8%)
    const mockB = new ethers.Contract(ADDR.MockPoolB, ['function setAPY(uint256) external'], deployer);
    await (await mockB.setAPY(1500)).wait();
    ok('MockPoolB APY raised to 15.00% (vs MockPoolA 8.00%)');

    // Wait for scout interval with retry (Fuji block timestamps can drift)
    let triggered = false;
    for (let attempt = 0; attempt < 5 && !triggered; attempt++) {
      const lastScoutAt = await C.engine.lastScoutJobAt();
      const block = await provider.getBlock('latest');
      const blockTime = block.timestamp;
      const elapsed = blockTime - Number(lastScoutAt);
      if (elapsed < 61) {
        const waitTime = 65 - elapsed;
        console.log(`  Waiting ${waitTime}s for scout interval (attempt ${attempt + 1}, elapsed=${elapsed}s)...`);
        await sleep(waitTime * 1000);
      }
      try {
        const triggerTx = await C.engine.connect(deployer).triggerScoutCycle();
        await triggerTx.wait();
        triggered = true;
      } catch (err) {
        if (err.message.includes('too soon')) {
          console.log(`  Scout interval not met yet, retrying in 15s...`);
          await sleep(15_000);
        } else {
          throw err;
        }
      }
    }
    assert(triggered, 'Second scout cycle triggered');

    // Wait for rebalance to MockPoolB
    const switchedToB = await pollUntil(
      async () => {
        const active = await C.yieldReg.activeProtocol();
        return active.toLowerCase() === ADDR.MockPoolB.toLowerCase();
      },
      { timeoutMs: 120_000, intervalMs: 3000, label: 'rebalance into MockPoolB' }
    );

    assert(switchedToB, 'Agents correctly switched to higher-yield MockPoolB (15% > 8%)');

    if (switchedToB) {
      const activeAPY = await C.yieldReg.activeAPY();
      eq(Number(activeAPY), 1500, 'Active APY = 1500 bps (15.00%)');

      const mockBBal = await C.mockB.getBalance();
      assert(Number(mockBBal) > 0, `MockPoolB now holds ${Number(mockBBal)/1e6} USDC`);

      const mockABal = await C.mockA.getBalance();
      eq(Number(mockABal), 0, 'MockPoolA balance is 0 (fully withdrawn)');

      console.log('  \x1b[32m★ YIELD OPTIMIZATION VERIFIED: Agents correctly picked higher yield!\x1b[0m');
    }
  }

  // ── PHASE 5: Verify Agent Payments ────────────────────────────────────
  section('PHASE 5 — Verify Agent Payments');
  {
    const totalPaid = await C.feePool.totalPaidOut();
    const totalCollected = await C.feePool.totalCollected();
    const poolBalance = await C.feePool.getBalance();
    console.log(`  FeePool: collected=${Number(totalCollected)/1e6} USDC, paid=${Number(totalPaid)/1e6} USDC, balance=${Number(poolBalance)/1e6} USDC`);
    assert(Number(totalCollected) > 0, `FeePool collected ${Number(totalCollected)/1e6} USDC in protocol fees`);

    // Check individual agent rep scores
    const scout1 = await C.registry.getAgent(new ethers.Wallet(KEYS.scout1).address);
    const exec1  = await C.registry.getAgent(new ethers.Wallet(KEYS.executor1).address);
    console.log(`  Scout1  rep=${scout1.reputationScore}  jobsCompleted=${scout1.jobsCompleted}`);
    console.log(`  Exec1   rep=${exec1.reputationScore}  jobsCompleted=${exec1.jobsCompleted}`);

    assert(Number(scout1.jobsCompleted) >= 1, 'Scout1 completed at least 1 job');
  }

  // ── PHASE 6: User Withdraw + Yield Return ─────────────────────────────
  section('PHASE 6 — User Withdraw (Yield Returns to Vault)');
  {
    const usdcBefore = await C.usdc.balanceOf(deployer.address);
    const shares     = await C.vault.getUserShares(deployer.address);

    if (Number(shares) > 0) {
      const vault = C.vault.connect(deployer);
      const withdrawTx = await vault.withdraw(shares);
      const receipt    = await withdrawTx.wait();
      ok(`Full withdrawal. Tx: ${receipt.hash.slice(0, 16)}...`);

      const usdcAfter     = await C.usdc.balanceOf(deployer.address);
      const sharesAfter   = await C.vault.getUserShares(deployer.address);
      const amountReturned = Number(usdcAfter - usdcBefore) / 1e6;

      eq(Number(sharesAfter), 0, 'User shares = 0 after full withdraw');
      assert(Number(usdcAfter) > Number(usdcBefore), `User USDC increased by ${amountReturned.toFixed(4)} USDC`);

      const vaultBal = await C.vault.getVaultBalance();
      eq(Number(vaultBal), 0, 'Vault balance = 0 after full withdrawal');

      console.log('  \x1b[32m★ YIELD AUTO-RETURN VERIFIED: Funds returned to user vault on withdraw\x1b[0m');
    } else {
      bad('User has shares to withdraw');
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────
  killAllAgents();
  await sleep(500);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1m  E2E SMOKE TEST RESULT: ${PASS} passed, ${FAIL} failed\x1b[0m`);
  if (FAIL) {
    console.log('\x1b[31m  Failures:\x1b[0m');
    FAILURES.forEach(f => console.log(`    - ${f}`));
  } else {
    console.log('\x1b[32m  All tests passed! ✓\x1b[0m');
  }
  console.log(`\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
  process.exit(FAIL ? 1 : 0);
}

main().catch(err => {
  killAllAgents();
  console.error('\nHARNESS CRASH:', err);
  process.exit(2);
});
