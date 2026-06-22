// Standalone Agent HTTP Server + Runner
// Each agent runs its own server for x402 receipt delivery + agent-card discovery.
//
// Env vars:
//   AGENT_PRIVATE_KEY   — agent signing wallet key
//   AGENT_TYPE          — 'scout' or 'executor'
//   AGENT_NAME          — display name (e.g. Scout1-Alpha)
//   SERVER_PORT         — HTTP port (4001, 4002, etc.)
//   ORCHESTRATOR_WALLET — for x402 receipt signature verification
//   FUJI_RPC_URL        — chain RPC
//   DEV_WALLET          — payment recipient wallet

const http = require('http');
const { ethers } = require('ethers');
const { getProvider, getWallet, getContracts, ADDRESSES, ADAPTER_NAMES } = require('./shared/contracts');
const { createJobPoller } = require('./shared/poll-jobs');
const { withRetry } = require('./shared/retry');

const AGENT_NAME = process.env.AGENT_NAME || 'UnnamedAgent';
const AGENT_TYPE = process.env.AGENT_TYPE || 'scout';
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '4001');
const ORCHESTRATOR_WALLET = process.env.ORCHESTRATOR_WALLET || '';
const DEV_WALLET = process.env.DEV_WALLET || '';
const GAS_PENALTY_BPS = 5;
// Minimum yield improvement (in bps) before the executor will rebalance.
// Lower = more responsive to small edges, but more frequent (gas-costing) moves.
// Tune via REBALANCE_THRESHOLD_BPS in .env. 10 bps = 0.10%.
const DEFAULT_THRESHOLD_BPS = parseInt(process.env.REBALANCE_THRESHOLD_BPS || '10', 10);

const receipts = [];
let jobsCompleted = 0;
let jobsFailed = 0;
let lastJobTime = null;

function log(level, msg, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    agent: AGENT_NAME,
    port: SERVER_PORT,
    message: msg,
    ...data,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

// ── HTTP Server ───────────────────────────────────────────────────────────

function startServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Orbit-Version');

    if (req.method === 'OPTIONS') {
      res.writeHead(200); res.end(); return;
    }

    if (req.method === 'GET' && req.url === '/agent-card') {
      handleAgentCard(req, res); return;
    }

    if (req.method === 'POST' && req.url === '/x402/receipt') {
      handleReceipt(req, res); return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      handleHealth(req, res); return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(SERVER_PORT, () => {
    log('info', `HTTP server listening on port ${SERVER_PORT}`, {
      endpoints: ['/agent-card', '/x402/receipt', '/health'],
    });
  });

  return server;
}

function handleAgentCard(_req, res) {
  const wallet = getWallet(getProvider());
  const card = {
    name: AGENT_NAME,
    type: AGENT_TYPE,
    wallet: wallet.address,
    devWallet: DEV_WALLET || wallet.address,
    chain: 'avalanche-fuji',
    chainId: 43113,
    endpoints: {
      receipt: `http://localhost:${SERVER_PORT}/x402/receipt`,
      health: `http://localhost:${SERVER_PORT}/health`,
    },
    stats: {
      jobsCompleted,
      jobsFailed,
      receiptsReceived: receipts.length,
      lastJobTime,
    },
    protocol: 'orbit/1.0',
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(card, null, 2));
}

function handleReceipt(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      const receipt = JSON.parse(body);

      // Verify orchestrator signature
      if (ORCHESTRATOR_WALLET && receipt.signature) {
        const { signature, ...unsigned } = receipt;
        const canonicalJSON = JSON.stringify(unsigned, Object.keys(unsigned).sort());

        let signer;
        try {
          signer = ethers.verifyMessage(canonicalJSON, signature);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: false, error: 'invalid_signature' }));
          return;
        }

        if (signer.toLowerCase() !== ORCHESTRATOR_WALLET.toLowerCase()) {
          log('warn', 'Unauthorized signer for x402 receipt', {
            expected: ORCHESTRATOR_WALLET,
            got: signer,
          });
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: false, error: 'unauthorized_signer' }));
          return;
        }
      }

      receipts.push({
        jobId: receipt.jobId,
        amount: receipt.amount,
        settlementTx: receipt.settlementTx,
        reasoning: receipt.reasoning,
        receivedAt: new Date().toISOString(),
      });

      log('info', `x402 receipt received +${receipt.amount} USDC`, {
        jobId: receipt.jobId,
        tx: receipt.settlementTx?.slice(0, 16),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));

    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: false, error: 'parse_error' }));
    }
  });
}

function handleHealth(_req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'running',
    agent: AGENT_NAME,
    type: AGENT_TYPE,
    port: SERVER_PORT,
    jobsCompleted,
    jobsFailed,
    receiptsReceived: receipts.length,
    lastJobTime,
    uptime: process.uptime(),
  }));
}

// ── Scout Logic ───────────────────────────────────────────────────────────

async function executeScoutJob(jobId, wallet, { engine, yieldReg, adapters }) {
  const startMs = Date.now();

  const apyResults = [];
  for (const [name, contract] of Object.entries(adapters)) {
    try {
      const rawAPY = await withRetry(
        () => contract.getAPY(),
        { label: `getAPY(${name})`, maxAttempts: 3, baseDelayMs: 500 }
      );
      const apy = Number(rawAPY);
      const addr = await contract.getAddress();
      log('info', 'APY read', { protocol: name, apy, formatted: `${(apy / 100).toFixed(2)}%` });
      apyResults.push({ name, address: addr, apy });
    } catch (err) {
      log('warn', 'APY read failed', { protocol: name, error: err.message });
    }
  }

  const active = apyResults.filter(p => p.apy > 0);
  if (active.length === 0) throw new Error('No protocols with APY > 0');

  const scored = active.map(p => ({ ...p, effectiveAPY: p.apy - GAS_PENALTY_BPS }));
  scored.sort((a, b) => b.effectiveAPY - a.effectiveAPY);
  const winner = scored[0];

  log('info', 'Winner selected', {
    protocol: winner.name,
    rawAPY: winner.apy,
    formatted: `${(winner.apy / 100).toFixed(2)}%`,
  });

  const registryTx = await withRetry(
    () => yieldReg.updateBestProtocol(winner.address, winner.apy),
    { label: 'updateBestProtocol', maxAttempts: 2 }
  );
  await registryTx.wait();
  log('info', 'YieldRegistry updated');

  const completeTx = await withRetry(
    () => engine.completeScoutJob(jobId),
    { label: 'completeScoutJob', maxAttempts: 2 }
  );
  const receipt = await completeTx.wait();
  log('info', 'Scout job completed', {
    jobId,
    tx: receipt.hash,
    elapsedMs: Date.now() - startMs,
  });
}

// ── Executor Logic ────────────────────────────────────────────────────────

async function executeExecutorJob(jobId, { engine, yieldReg }) {
  const startMs = Date.now();

  const [bestProtocol, bestAPYRaw, activeProtocol, activeAPYRaw] = await Promise.all([
    yieldReg.bestProtocol(),
    yieldReg.bestAPY(),
    yieldReg.activeProtocol(),
    yieldReg.activeAPY(),
  ]);

  const bestAPY = Number(bestAPYRaw);

  // currentAPY must be the LIVE rate of the protocol the vault is in — not the
  // snapshot stored at the last rebalance (yieldReg.activeAPY()), which goes
  // stale when that pool's rate changes without a rebalance. Using the stale
  // value makes the spread wrong and the executor wrongly holds (or moves).
  let currentAPY = Number(activeAPYRaw);
  if (activeProtocol && activeProtocol !== ethers.ZeroAddress) {
    try {
      const activeAdapter = new ethers.Contract(
        activeProtocol,
        ['function getAPY() view returns (uint256)'],
        yieldReg.runner
      );
      currentAPY = Number(await activeAdapter.getAPY());
    } catch { /* fall back to stored snapshot */ }
  }
  const spread = bestAPY - currentAPY;

  log('info', 'Executor state', {
    bestProtocol: ADAPTER_NAMES[bestProtocol?.toLowerCase()] || bestProtocol,
    bestAPY: `${(bestAPY / 100).toFixed(2)}%`,
    activeProtocol: ADAPTER_NAMES[activeProtocol?.toLowerCase()] || 'none',
    currentAPY: `${(currentAPY / 100).toFixed(2)}%`,
    spread: `${(spread / 100).toFixed(2)}%`,
  });

  const isFirstDeposit = activeProtocol === ethers.ZeroAddress;
  const alreadyOnBest = bestProtocol.toLowerCase() === activeProtocol.toLowerCase();

  if (alreadyOnBest) {
    log('info', 'Already on best protocol, no-op');
    const tx = await withRetry(() => engine.completeExecutorJobNoOp(jobId), { label: 'noOp', maxAttempts: 2 });
    await tx.wait();
    log('info', 'Executor job completed (no-op)', { jobId });
    return;
  }

  if (!isFirstDeposit && spread < DEFAULT_THRESHOLD_BPS) {
    log('info', 'Spread below threshold, no-op', { spread, threshold: DEFAULT_THRESHOLD_BPS });
    const tx = await withRetry(() => engine.completeExecutorJobNoOp(jobId), { label: 'noOp', maxAttempts: 2 });
    await tx.wait();
    log('info', 'Executor job completed (no-op — threshold)', { jobId });
    return;
  }

  log('info', 'Executing rebalance', {
    from: ADAPTER_NAMES[activeProtocol?.toLowerCase()] || 'none',
    to: ADAPTER_NAMES[bestProtocol?.toLowerCase()] || bestProtocol,
    spread: `${(spread / 100).toFixed(2)}%`,
  });

  const completeTx = await withRetry(
    () => engine.completeExecutorJob(jobId, bestProtocol),
    { label: 'completeExecutorJob', maxAttempts: 2 }
  );
  const receipt = await completeTx.wait();

  log('info', 'Executor job completed with rebalance', {
    jobId,
    tx: receipt.hash,
    elapsedMs: Date.now() - startMs,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  log('info', `Starting ${AGENT_NAME} (${AGENT_TYPE}) on port ${SERVER_PORT}`);

  const provider = getProvider();
  const wallet = getWallet(provider);
  const contracts = getContracts(wallet);
  const { engine, yieldReg, adapters } = contracts;

  log('info', 'Agent connected', {
    wallet: wallet.address,
    type: AGENT_TYPE,
    network: 'avalanche-fuji',
  });

  // Start HTTP server
  const server = startServer();

  // Start job poller
  const isScout = AGENT_TYPE === 'scout';

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, assignedAgent, deadline) => {
      const jobIdNum = Number(jobId);
      const jobTypeNum = Number(jobType);
      const expectedType = isScout ? 0 : 1;

      if (jobTypeNum !== expectedType) return;

      const remaining = (Number(deadline) * 1000) - Date.now();
      log('info', `${AGENT_TYPE} job received`, {
        jobId: jobIdNum,
        remainingSeconds: Math.floor(remaining / 1000),
      });

      if (remaining < (isScout ? 10000 : 15000)) {
        log('warn', 'Deadline too close, skipping', { jobId: jobIdNum });
        jobsFailed++;
        return;
      }

      try {
        if (isScout) {
          await executeScoutJob(jobIdNum, wallet, { engine, yieldReg, adapters });
        } else {
          await executeExecutorJob(jobIdNum, { engine, yieldReg });
        }
        jobsCompleted++;
        lastJobTime = new Date().toISOString();
      } catch (err) {
        jobsFailed++;
        log('error', `${AGENT_TYPE} job failed`, { jobId: jobIdNum, error: err.message });
      }
    },
  });

  await poller.start();
  log('info', `Polling for ${AGENT_TYPE} jobs...`);

  process.on('SIGINT', () => {
    log('info', 'Shutting down...');
    poller.stop();
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  log('error', 'Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
