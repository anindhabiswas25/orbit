// Smart Scout Agent — Rule-based LLM-style reasoning engine
//
// Unlike the basic scout (index.js) that just picks max APY, this agent:
// 1. Reads APY from ALL registered adapters
// 2. Applies a multi-factor scoring model (gas cost, volatility, protocol risk)
// 3. Outputs structured reasoning for each decision (LLM-style chain-of-thought)
// 4. Tracks historical APY readings to detect anomalies and trends
// 5. Assigns confidence levels to its recommendations
//
// Start: AGENT_PRIVATE_KEY=0x... AGENT_NAME=SmartScout node agents/scout/smart-scout.js

const { getProvider, getWallet, getContracts } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

const PROCESSED_JOBS = new Set();

// ── Scoring Parameters ──────────────────────────────────────────────────────
const WEIGHTS = {
  effectiveAPY:    0.50,   // Net APY after gas deduction
  stability:       0.25,   // How stable the APY has been historically
  protocolTrust:   0.15,   // Known protocol risk tier
  recency:         0.10,   // Freshness of APY data
};

const GAS_COST_BPS = 5;          // 0.05% gas overhead per rebalance
const ANOMALY_THRESHOLD = 3.0;   // Flag if APY is 3x the historical average
const MIN_APY_BPS = 10;          // Ignore protocols below 0.10% APY
const MAX_HISTORY = 50;          // Keep last 50 readings per protocol

// Protocol risk tiers (lower = safer, score 0-100)
const PROTOCOL_RISK = {
  'AAVE V3':   90,   // Battle-tested, audited
  'Benqi':     80,   // Established Avalanche protocol
  'MockPoolA': 60,   // Test pool — moderate trust
  'MockPoolB': 60,   // Test pool — moderate trust
};

// ── Historical APY Tracker ──────────────────────────────────────────────────
const apyHistory = {};  // { protocolName: [{ apy, timestamp }] }

function recordAPY(name, apy) {
  if (!apyHistory[name]) apyHistory[name] = [];
  apyHistory[name].push({ apy, timestamp: Date.now() });
  if (apyHistory[name].length > MAX_HISTORY) apyHistory[name].shift();
}

function getHistoricalAvg(name) {
  const h = apyHistory[name];
  if (!h || h.length === 0) return 0;
  return h.reduce((s, r) => s + r.apy, 0) / h.length;
}

function getAPYStdDev(name) {
  const h = apyHistory[name];
  if (!h || h.length < 2) return 0;
  const avg = getHistoricalAvg(name);
  const variance = h.reduce((s, r) => s + Math.pow(r.apy - avg, 2), 0) / h.length;
  return Math.sqrt(variance);
}

// ── Reasoning Engine ────────────────────────────────────────────────────────
function analyzeProtocols(protocols) {
  const reasoning = {
    timestamp:    new Date().toISOString(),
    candidates:   [],
    eliminated:   [],
    winner:       null,
    confidence:   0,
    chain_of_thought: [],
  };

  reasoning.chain_of_thought.push(`Analyzing ${protocols.length} protocol(s) for yield optimization`);

  // Step 1: Filter out zero/negligible APY
  const viable = [];
  for (const p of protocols) {
    if (p.apy < MIN_APY_BPS) {
      reasoning.eliminated.push({
        name: p.name, apy: p.apy, reason: `APY ${(p.apy/100).toFixed(2)}% below minimum ${(MIN_APY_BPS/100).toFixed(2)}%`
      });
      reasoning.chain_of_thought.push(`SKIP ${p.name}: APY too low (${(p.apy/100).toFixed(2)}%)`);
    } else {
      viable.push(p);
    }
  }

  if (viable.length === 0) {
    reasoning.chain_of_thought.push('DECISION: No viable protocols found');
    return reasoning;
  }

  // Step 2: Score each candidate
  for (const p of viable) {
    recordAPY(p.name, p.apy);
    const historicalAvg = getHistoricalAvg(p.name);
    const stdDev        = getAPYStdDev(p.name);
    const effectiveAPY  = p.apy - GAS_COST_BPS;

    // Anomaly detection
    const isAnomaly = historicalAvg > 0 && p.apy > historicalAvg * ANOMALY_THRESHOLD;
    if (isAnomaly) {
      reasoning.chain_of_thought.push(
        `⚠ ANOMALY: ${p.name} APY ${(p.apy/100).toFixed(2)}% is ${(p.apy/historicalAvg).toFixed(1)}x historical avg (${(historicalAvg/100).toFixed(2)}%)`
      );
    }

    // Sub-scores (0-100 scale)
    const apyScore       = Math.min(100, (effectiveAPY / 20));  // Normalize: 20% APY = 100
    const stabilityScore = stdDev === 0 ? 70 : Math.max(0, 100 - (stdDev / 10));
    const trustScore     = PROTOCOL_RISK[p.name] || 50;
    const recencyScore   = 100;  // Live read = max freshness

    const compositeScore =
      apyScore       * WEIGHTS.effectiveAPY +
      stabilityScore * WEIGHTS.stability +
      trustScore     * WEIGHTS.protocolTrust +
      recencyScore   * WEIGHTS.recency;

    const candidate = {
      name:          p.name,
      address:       p.address,
      rawAPY:        p.apy,
      effectiveAPY,
      historicalAvg: Math.round(historicalAvg),
      stdDev:        Math.round(stdDev),
      isAnomaly,
      scores: { apyScore: Math.round(apyScore), stabilityScore: Math.round(stabilityScore), trustScore, recencyScore },
      compositeScore: Math.round(compositeScore * 100) / 100,
    };

    reasoning.candidates.push(candidate);
    reasoning.chain_of_thought.push(
      `SCORE ${p.name}: APY=${(effectiveAPY/100).toFixed(2)}% ` +
      `composite=${candidate.compositeScore.toFixed(1)} ` +
      `[apy=${Math.round(apyScore)} stab=${Math.round(stabilityScore)} trust=${trustScore} fresh=${recencyScore}]`
    );
  }

  // Step 3: Rank by composite score
  reasoning.candidates.sort((a, b) => b.compositeScore - a.compositeScore);
  const winner = reasoning.candidates[0];
  reasoning.winner = winner;

  // Step 4: Confidence calculation
  if (reasoning.candidates.length === 1) {
    reasoning.confidence = winner.isAnomaly ? 0.5 : 0.8;
  } else {
    const runnerUp = reasoning.candidates[1];
    const margin   = winner.compositeScore - runnerUp.compositeScore;
    const marginPct = margin / winner.compositeScore;
    reasoning.confidence = Math.min(0.99, 0.5 + marginPct * 2);
    if (winner.isAnomaly) reasoning.confidence *= 0.6;
  }
  reasoning.confidence = Math.round(reasoning.confidence * 100) / 100;

  reasoning.chain_of_thought.push(
    `DECISION: ${winner.name} wins with score ${winner.compositeScore.toFixed(1)} ` +
    `(APY ${(winner.effectiveAPY/100).toFixed(2)}%, confidence ${(reasoning.confidence*100).toFixed(0)}%)`
  );

  return reasoning;
}

// ── Main Agent Loop ─────────────────────────────────────────────────────────
async function runSmartScout() {
  const provider  = getProvider();
  const wallet    = getWallet(provider);
  const contracts = getContracts(wallet);
  const { engine, yieldReg, adapters } = contracts;

  log.info('Smart Scout agent started', {
    wallet:     wallet.address,
    model:      'rule-based-v1',
    weights:    WEIGHTS,
    gasCostBps: GAS_COST_BPS,
  });

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, assignedAgent, deadline) => {
      const jobIdNum   = Number(jobId);
      const jobTypeNum = Number(jobType);

      if (jobTypeNum !== 0) return;

      const remaining = (Number(deadline) * 1000) - Date.now();
      log.info('Scout job received', { jobId: jobIdNum, remainingSeconds: Math.floor(remaining / 1000) });

      if (remaining < 10_000) {
        log.warn('Deadline too close, skipping', { jobId: jobIdNum });
        return;
      }

      try {
        await executeSmartScoutJob(jobIdNum, wallet, { engine, yieldReg, adapters });
      } catch (err) {
        log.error('Smart scout job failed', { jobId: jobIdNum, error: err.message });
      }
    },
  });

  await poller.start();
  log.info('Listening for JobAssigned events (Smart Scout)...');

  process.on('SIGINT', () => {
    poller.stop();
    log.info('Smart Scout shutdown');
    process.exit(0);
  });
}

async function executeSmartScoutJob(jobId, wallet, { engine, yieldReg, adapters }) {
  const startMs = Date.now();

  // Step 1: Read APY from all adapters
  log.info('Reading APY from all protocols...');
  const protocols = [];

  for (const [name, contract] of Object.entries(adapters)) {
    try {
      const rawAPY = await withRetry(
        () => contract.getAPY(),
        { label: `getAPY(${name})`, maxAttempts: 3, baseDelayMs: 500 }
      );
      const apy  = Number(rawAPY);
      const addr = await contract.getAddress();
      protocols.push({ name, address: addr, apy });
    } catch (err) {
      log.warn('APY read failed', { protocol: name, error: err.message });
    }
  }

  // Step 2: Run reasoning engine
  const reasoning = analyzeProtocols(protocols);

  // Log the full chain of thought
  for (const thought of reasoning.chain_of_thought) {
    log.info('REASONING', { thought });
  }

  if (!reasoning.winner) {
    throw new Error('No viable protocol found after analysis');
  }

  const winner = reasoning.winner;
  log.info('Winner selected by Smart Scout', {
    protocol:     winner.name,
    rawAPY:       `${(winner.rawAPY / 100).toFixed(2)}%`,
    effectiveAPY: `${(winner.effectiveAPY / 100).toFixed(2)}%`,
    composite:    winner.compositeScore,
    confidence:   `${(reasoning.confidence * 100).toFixed(0)}%`,
    isAnomaly:    winner.isAnomaly,
    candidates:   reasoning.candidates.length,
    eliminated:   reasoning.eliminated.length,
  });

  // Step 3: Post result to YieldRegistry
  const registryTx = await withRetry(
    () => yieldReg.updateBestProtocol(winner.address, winner.rawAPY),
    { label: 'updateBestProtocol', maxAttempts: 2 }
  );
  const registryReceipt = await registryTx.wait();
  log.info('YieldRegistry updated', { tx: registryReceipt.hash });

  // Step 4: Complete job
  const completeTx = await withRetry(
    () => engine.completeScoutJob(jobId),
    { label: 'completeScoutJob', maxAttempts: 2 }
  );
  const completeReceipt = await completeTx.wait();
  log.info('Smart scout job completed', {
    jobId,
    tx:         completeReceipt.hash,
    elapsedMs:  Date.now() - startMs,
    confidence: reasoning.confidence,
  });

  // Step 5: x402 receipt
  await sendX402Payment({
    amount: '0.001',
    memo:   `orbit-smart-scout-job-${jobId}:${completeReceipt.hash}`,
  }).catch(err => log.warn('x402 non-fatal', { error: err.message }));
}

runSmartScout().catch(err => {
  log.error('Fatal smart scout error', { error: err.message, stack: err.stack });
  process.exit(1);
});
