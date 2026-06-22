/* ════════════════════════════════════════════════════════════════════════════
 * Orbit Protocol — End-to-End Flow Test
 *
 * Exercises the OFF-CHAIN layers that the Hardhat unit/integration suite does
 * not cover: the user journey, the CLI, the SDK, the backend API, and the live
 * scout/executor agent processes — all against a local Hardhat node.
 *
 * Prerequisites (handled by e2e/run-e2e.sh):
 *   1. `npx hardhat node` is running on 127.0.0.1:8545
 *   2. `npx hardhat run scripts/deploy-local.js --network localhost` has run
 *      (writes deployed-addresses.json + mints USDC to the test accounts)
 *
 * Run directly:  node e2e/e2e-flow.js
 *
 * NOTE: standalone harness, NOT a Mocha/Hardhat test — it lives outside test/
 * so `npx hardhat test` does not try to load it.
 * ════════════════════════════════════════════════════════════════════════════ */

const { ethers }      = require('ethers');
const { execFile }    = require('child_process');
const { spawn }       = require('child_process');
const path            = require('path');
const fs              = require('fs');

const ROOT     = path.join(__dirname, '..');
const RPC      = 'http://127.0.0.1:8545';
const ADDR     = require(path.join(ROOT, 'deployed-addresses.json'));

// Well-known Hardhat node accounts (deterministic, NOT secret — local test only)
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  agentA:   '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // scout
  agentB:   '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // executor
  agentC:   '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // SDK agent
};

// cacheTimeout:-1 so the harness's own back-to-back deployer txs don't reuse a
// stale cached nonce on the fast local node (same reason the product code sets it).
const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
const deployer = new ethers.Wallet(KEYS.deployer, provider);
const wA = new ethers.Wallet(KEYS.agentA, provider);
const wB = new ethers.Wallet(KEYS.agentB, provider);
const wC = new ethers.Wallet(KEYS.agentC, provider);

function abi(name, sub = '') {
  const p = sub
    ? path.join(ROOT, `artifacts/contracts/${sub}/${name}.sol/${name}.json`)
    : path.join(ROOT, `artifacts/contracts/${name}.sol/${name}.json`);
  return require(p).abi;
}

const C = {
  registry: new ethers.Contract(ADDR.AgentRegistry,        abi('AgentRegistry'),        provider),
  engine:   new ethers.Contract(ADDR.AgentSelectionEngine, abi('AgentSelectionEngine'), provider),
  yieldReg: new ethers.Contract(ADDR.YieldRegistry,        abi('YieldRegistry'),        provider),
  vault:    new ethers.Contract(ADDR.YieldVault,           abi('YieldVault'),           provider),
  feePool:  new ethers.Contract(ADDR.FeePool,              abi('FeePool'),              provider),
  usdc:     new ethers.Contract(ADDR.USDC,                 abi('MockERC20', 'test'),    provider),
  mockA:    new ethers.Contract(ADDR.MockPoolA,            abi('IYieldAdapter', 'interfaces'), provider),
};

// ── tiny test framework ──────────────────────────────────────────────────────
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

// Run the CLI as a child process. Returns { code, stdout, stderr }.
function cli(args, extraEnv = {}) {
  return new Promise(resolve => {
    execFile('node', [path.join(ROOT, 'cli', 'index.js'), ...args], {
      cwd: ROOT,
      env: { ...process.env, FUJI_RPC_URL: RPC, ...extraEnv },
      timeout: 60_000,
    }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// hardhat node time control
async function mineForward(seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

async function pollUntil(fn, { timeoutMs = 60_000, intervalMs = 1500, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\x1b[1mOrbit Protocol — End-to-End Flow Test\x1b[0m');
  console.log(`RPC: ${RPC}   chainId: ${ADDR.chainId}   USDC: ${ADDR.USDC}`);

  const baseEnv = {
    FUJI_RPC_URL: RPC,
    DEPLOYER_PRIVATE_KEY: KEYS.deployer,
    X402_FACILITATOR_URL: '',
  };

  // ── PHASE 1: USER DEPOSIT (via CLI) ────────────────────────────────────────
  section('PHASE 1 — User deposits USDC via CLI');
  {
    const r = await cli(['deposit', '--amount', '100'], baseEnv);
    assert(r.code === 0, 'CLI `deposit --amount 100` exits 0', r.stderr || r.stdout);
    const bal = await C.vault.getVaultBalance();
    eq(ethers.formatUnits(bal, 6), '99.9', 'Vault balance is 99.9 USDC (100 − 0.10% fee)');
    const feeBal = await C.feePool.getBalance();
    eq(feeBal.toString(), '100000', 'FeePool collected 0.10 USDC fee');
    const shares = await C.vault.getUserShares(deployer.address);
    eq(shares.toString(), '99900000', 'User credited 99.9M shares');
  }

  // ── PHASE 2: AGENT REGISTRATION (via CLI) ──────────────────────────────────
  section('PHASE 2 — Agents register via CLI');
  {
    const rs = await cli(
      ['register-agent', '--type', 'scout', '--endpoint', 'https://scout.example/card',
       '--fee', '50', '--dev-wallet', wA.address],
      { ...baseEnv, AGENT_PRIVATE_KEY: KEYS.agentA });
    assert(rs.code === 0, 'CLI register-agent (scout) exits 0', rs.stderr || rs.stdout);

    const re = await cli(
      ['register-agent', '--type', 'executor', '--endpoint', 'https://exec.example/card',
       '--fee', '50', '--dev-wallet', wB.address],
      { ...baseEnv, AGENT_PRIVATE_KEY: KEYS.agentB });
    assert(re.code === 0, 'CLI register-agent (executor) exits 0', re.stderr || re.stdout);

    const scout = await C.registry.getAgent(wA.address);
    eq(scout.wallet, wA.address, 'Scout on-chain wallet matches');
    eq(scout.agentType, 0, 'Scout agentType == 0 (Scout)');
    eq(scout.stake.toString(), '5000000', 'Scout stake locked = 5 USDC');
    const exec = await C.registry.getAgent(wB.address);
    eq(exec.agentType, 1, 'Executor agentType == 1 (Executor)');

    // Validation: registering with a bad fee should fail fast.
    const badFee = await cli(
      ['register-agent', '--type', 'scout', '--endpoint', 'https://x.example/card',
       '--fee', '999', '--dev-wallet', wC.address],
      { ...baseEnv, AGENT_PRIVATE_KEY: KEYS.agentC });
    assert(badFee.code !== 0, 'CLI register-agent rejects fee > 500');
  }

  // ── PHASE 3: READ-ONLY CLI COMMANDS ────────────────────────────────────────
  section('PHASE 3 — CLI status / agent-status / set-apy');
  {
    const st = await cli(['status'], baseEnv);
    assert(st.code === 0 && /Vault Balance/.test(st.stdout), 'CLI `status` prints vault summary', st.stderr);
    assert(/Scout Agents     : 1/.test(st.stdout), 'CLI status shows 1 scout registered');

    const as = await cli(['agent-status', '--wallet', wA.address], baseEnv);
    assert(as.code === 0 && /Type:         Scout/.test(as.stdout), 'CLI agent-status shows Scout', as.stdout);

    const sa = await cli(['set-apy', '--pool', 'MockPoolA', '--apy', '1800'], baseEnv);
    assert(sa.code === 0, 'CLI `set-apy MockPoolA 1800` exits 0', sa.stderr || sa.stdout);
    eq((await C.mockA.getAPY()).toString(), '1800', 'MockPoolA APY now 1800 bps on-chain');
  }

  // ── PHASE 4: LIVE AGENT CYCLE (real scout + executor processes) ────────────
  section('PHASE 4 — Live scout + executor rebalance cycle');
  let scoutProc, execProc;
  {
    const ready = { scout: false, exec: false };
    const spawnAgent = (file, key, name, flag) => {
      const p = spawn('node', [path.join(ROOT, 'agents', file)], {
        cwd: ROOT,
        env: { ...process.env, FUJI_RPC_URL: RPC, AGENT_PRIVATE_KEY: key, AGENT_NAME: name,
               X402_FACILITATOR_URL: '', LOG_LEVEL: 'info' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      p.stdout.on('data', d => {
        const s = d.toString();
        process.stdout.write(`      [${flag}] ${s}`);
        if (/Listening/.test(s)) ready[flag] = true;       // agent has attached its listener
      });
      p.stderr.on('data', d => process.stdout.write(`      [${flag}!] ${d}`));
      return p;
    };
    scoutProc = spawnAgent('scout/index.js',    KEYS.agentA, 'Scout',    'scout');
    execProc  = spawnAgent('executor/index.js', KEYS.agentB, 'Executor', 'exec');

    // Wait until BOTH agents log that they're listening, then give ethers a beat
    // to establish each event filter's start block — otherwise the triggering
    // block can predate the subscription and the event is missed.
    await pollUntil(async () => ready.scout && ready.exec,
      { timeoutMs: 25_000, intervalMs: 300, label: 'agents listening' });
    await sleep(5000);

    // Keeper triggers a scout cycle. Scout posts MockPoolA(1800); engine then
    // auto-assigns the executor, which rebalances the vault into MockPoolA.
    await (await C.engine.connect(deployer).triggerScoutCycle()).wait();
    ok('Keeper triggered scout cycle');

    const rebalanced = await pollUntil(
      async () => (await C.yieldReg.activeProtocol()).toLowerCase() === ADDR.MockPoolA.toLowerCase(),
      { timeoutMs: 90_000, label: 'rebalance into MockPoolA' });

    assert(rebalanced, 'Vault rebalanced into MockPoolA within 60s');
    if (rebalanced) {
      eq((await C.yieldReg.activeAPY()).toString(), '1800', 'Active APY recorded as 1800 bps');
      const poolBal = await C.mockA.getBalance();
      eq(ethers.formatUnits(poolBal, 6), '99.9', 'MockPoolA holds the 99.9 USDC');
      const scout = await C.registry.getAgent(wA.address);
      const exec  = await C.registry.getAgent(wB.address);
      assert(scout.reputationScore >= 1n, 'Scout reputation incremented (>=1)', `got ${scout.reputationScore}`);
      assert(exec.reputationScore  >= 1n, 'Executor reputation incremented (>=1)', `got ${exec.reputationScore}`);
      assert((await C.feePool.totalPaidOut()) > 0n, 'FeePool paid an agent (totalPaidOut > 0)');
      const logs = await C.yieldReg.getRebalanceLogsCount();
      assert(logs >= 1n, 'Rebalance logged on-chain');
    }
  }

  // ── PHASE 5: SDK ───────────────────────────────────────────────────────────
  section('PHASE 5 — SDK (OrbitAgent)');
  {
    const distPath = path.join(ROOT, 'sdk', 'dist', 'index.js');
    if (!fs.existsSync(distPath)) {
      bad('SDK build present (sdk/dist/index.js)', 'run `npm --prefix sdk install && npm --prefix sdk run build`');
    } else {
      const { OrbitAgent } = require(distPath);
      const abis = { AgentRegistry: abi('AgentRegistry'), AgentSelectionEngine: abi('AgentSelectionEngine') };
      const addresses = {
        AgentRegistry: ADDR.AgentRegistry,
        AgentSelectionEngine: ADDR.AgentSelectionEngine,
        USDC: ADDR.USDC,
      };
      const agent = new OrbitAgent(RPC, KEYS.agentC, addresses, abis);
      eq(agent.walletAddress, wC.address, 'SDK exposes correct wallet address');

      const txHash = await agent.register({
        type: 'executor', endpoint: 'https://sdk.example/card', fee: 40, developerWallet: wC.address });
      assert(typeof txHash === 'string' && txHash.startsWith('0x'), 'SDK register() returns tx hash', txHash);

      const info = await agent.getStatus();
      eq(info.type, 'executor', 'SDK getStatus() type == executor');
      eq(info.stake, 5, 'SDK getStatus() stake == 5');
      eq(info.fee, 40, 'SDK getStatus() fee == 40');

      const board = await agent.getLeaderboard('executor');
      assert(Array.isArray(board) && board.map(a => a.toLowerCase()).includes(wC.address.toLowerCase()),
        'SDK getLeaderboard(executor) includes new agent');

      // onJobAssigned — make agentC the top scout so a triggered cycle lands on it.
      // (Re-register path is taken via a fresh scout wallet would need stake; instead
      //  we verify subscription wiring fires for the executor job that follows a cycle.)
      let fired = false;
      const unsub = agent.onJobAssigned(() => { fired = true; });
      // Boost agentC executor reputation above agentB so the next executor job is its.
      await (await C.registry.connect(deployer).adminSetReputation(wC.address, 5)).wait();
      await mineForward(61);
      await (await C.engine.connect(deployer).triggerScoutCycle()).wait();
      const got = await pollUntil(async () => fired, { timeoutMs: 35_000, label: 'onJobAssigned callback' });
      assert(got, 'SDK onJobAssigned() callback fired for assigned job');
      unsub();
    }
  }

  // ── PHASE 6: BACKEND API ───────────────────────────────────────────────────
  section('PHASE 6 — Backend API endpoints');
  let backendProc;
  {
    backendProc = spawn('node', [path.join(ROOT, 'backend', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, FUJI_RPC_URL: RPC, DEPLOYER_PRIVATE_KEY: KEYS.deployer, PORT: '4055' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stderr.on('data', d => process.stdout.write(`      [backend!] ${d}`));
    const API = 'http://127.0.0.1:4055';
    const up = await pollUntil(async () => {
      try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
    }, { timeoutMs: 15_000, intervalMs: 500, label: 'backend up' });
    assert(up, 'Backend /health responds');

    if (up) {
      const status = await (await fetch(`${API}/api/status`)).json();
      eq(status.currentProtocolName, 'MockPoolA', 'GET /api/status currentProtocolName == MockPoolA');
      eq(status.vaultBalance, 99.9, 'GET /api/status vaultBalance == 99.9');

      const protos = await (await fetch(`${API}/api/protocols`)).json();
      assert(Array.isArray(protos) && protos[0].name === 'MockPoolA',
        'GET /api/protocols sorted with MockPoolA on top', JSON.stringify(protos[0]));

      const agents = await (await fetch(`${API}/api/agents`)).json();
      assert(Array.isArray(agents) && agents.length >= 2, 'GET /api/agents returns registered agents');

      const jobs = await (await fetch(`${API}/api/jobs`)).json();
      assert(Array.isArray(jobs) && jobs.length >= 1, 'GET /api/jobs returns job history');

      const events = await (await fetch(`${API}/api/events`)).json();
      assert(Array.isArray(events) && events.length >= 1, 'GET /api/events returns rebalance log');

      const demo = await (await fetch(`${API}/api/demo/set-apy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool: 'MockPoolB', apy: 1234 }),
      })).json();
      assert(demo.success === true, 'POST /api/demo/set-apy succeeds', JSON.stringify(demo));
      const mockB = new ethers.Contract(ADDR.MockPoolB, abi('IYieldAdapter', 'interfaces'), provider);
      eq((await mockB.getAPY()).toString(), '1234', 'MockPoolB APY set via backend == 1234');
    }
  }

  // ── PHASE 7: USER WITHDRAW (via CLI) ───────────────────────────────────────
  section('PHASE 7 — User withdraws via CLI');
  {
    const usdcBefore = await C.usdc.balanceOf(deployer.address);
    const r = await cli(['withdraw', '--all'], baseEnv);
    assert(r.code === 0, 'CLI `withdraw --all` exits 0', r.stderr || r.stdout);
    const shares = await C.vault.getUserShares(deployer.address);
    eq(shares.toString(), '0', 'User shares are 0 after full withdraw');
    const usdcAfter = await C.usdc.balanceOf(deployer.address);
    assert(usdcAfter > usdcBefore, 'User USDC balance increased after withdraw',
      `before ${usdcBefore}, after ${usdcAfter}`);
  }

  // ── cleanup ────────────────────────────────────────────────────────────────
  for (const p of [scoutProc, execProc, backendProc]) { try { p && p.kill('SIGKILL'); } catch {} }
  await sleep(500);

  // ── summary ──────────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1m  RESULT: ${PASS} passed, ${FAIL} failed\x1b[0m`);
  if (FAIL) {
    console.log('\x1b[31m  Failures:\x1b[0m');
    FAILURES.forEach(f => console.log(`    - ${f}`));
  }
  console.log(`\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
  process.exit(FAIL ? 1 : 0);
}

main().catch(err => { console.error('\nHARNESS CRASH:', err); process.exit(2); });
