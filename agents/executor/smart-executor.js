// Smart Executor Agent — Rule-based LLM-style decision engine
//
// Unlike the basic executor (index.js), this agent:
// 1. Applies dynamic threshold based on vault size (larger vault = tighter threshold)
// 2. Calculates projected yield gain in USDC terms before rebalancing
// 3. Factors in gas costs and slippage estimates
// 4. Tracks rebalance history to avoid excessive churning
// 5. Outputs structured reasoning for every decision
//
// Start: AGENT_PRIVATE_KEY=0x... AGENT_NAME=SmartExecutor node agents/executor/smart-executor.js

const { ethers }          = require('ethers');
const { getProvider, getWallet, getContracts, ADDRESSES, ADAPTER_NAMES } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

const PROCESSED_JOBS = new Set();

// ── Decision Parameters ─────────────────────────────────────────────────────
const BASE_THRESHOLD_BPS     = 200;    // 2% minimum spread for small vaults
const LARGE_VAULT_USDC       = 10000;  // Above this, use tighter threshold
const LARGE_VAULT_THRESHOLD  = 50;     // 0.50% for large vaults
const MIN_GAIN_USDC          = 0.01;   // Don't rebalance for less than $0.01 projected gain
const CHURN_COOLDOWN_MS      = 120_000; // Don't rebalance within 2 minutes of last
const GAS_ESTIMATE_AVAX      = 0.005;  // Estimated gas cost per rebalance in AVAX
const AVAX_PRICE_USD         = 15;     // Rough AVAX price for cost calculation

// ── Rebalance History ───────────────────────────────────────────────────────
const rebalanceHistory = [];  // [{ timestamp, from, to, spread, vaultSize }]

function getTimeSinceLastRebalance() {
  if (rebalanceHistory.length === 0) return Infinity;
  return Date.now() - rebalanceHistory[rebalanceHistory.length - 1].timestamp;
}

// ── Decision Engine ─────────────────────────────────────────────────────────
function makeRebalanceDecision({ bestProtocol, bestAPY, activeProtocol, activeAPY, vaultBalance, isFirstDeposit }) {
  const decision = {
    timestamp:        new Date().toISOString(),
    action:           'no-op',     // 'rebalance' or 'no-op'
    reason:           '',
    chain_of_thought: [],
    metrics:          {},
    confidence:       0,
  };

  const spread = bestAPY - activeAPY;
  const balanceUSDC = Number(vaultBalance) / 1e6;

  // Dynamic threshold based on vault size
  const threshold = balanceUSDC >= LARGE_VAULT_USDC ? LARGE_VAULT_THRESHOLD : BASE_THRESHOLD_BPS;

  // Projected annual gain from the spread
  const annualGainUSDC  = (balanceUSDC * spread) / 10_000;
  const dailyGainUSDC   = annualGainUSDC / 365;
  const gasCostUSDC     = GAS_ESTIMATE_AVAX * AVAX_PRICE_USD;
  const daysToBreakEven = gasCostUSDC / (dailyGainUSDC || 0.0001);
  const timeSinceLast   = getTimeSinceLastRebalance();

  decision.metrics = {
    bestProtocolName:  ADAPTER_NAMES[bestProtocol?.toLowerCase()] || bestProtocol,
    activeProtocolName: ADAPTER_NAMES[activeProtocol?.toLowerCase()] || 'none',
    bestAPY:           `${(bestAPY / 100).toFixed(2)}%`,
    activeAPY:         `${(activeAPY / 100).toFixed(2)}%`,
    spread:            `${(spread / 100).toFixed(2)}%`,
    threshold:         `${(threshold / 100).toFixed(2)}%`,
    vaultBalance:      `${balanceUSDC.toFixed(2)} USDC`,
    annualGainUSDC:    `$${annualGainUSDC.toFixed(4)}`,
    dailyGainUSDC:     `$${dailyGainUSDC.toFixed(6)}`,
    gasCostUSDC:       `$${gasCostUSDC.toFixed(4)}`,
    breakEvenDays:     `${daysToBreakEven.toFixed(1)} days`,
    timeSinceLast:     timeSinceLast === Infinity ? 'never' : `${Math.round(timeSinceLast/1000)}s ago`,
  };

  decision.chain_of_thought.push(
    `Evaluating rebalance: ${decision.metrics.activeProtocolName} (${decision.metrics.activeAPY}) → ` +
    `${decision.metrics.bestProtocolName} (${decision.metrics.bestAPY})`
  );

  // Decision tree
  if (isFirstDeposit) {
    decision.chain_of_thought.push('First deposit detected — vault has no active protocol yet');
    decision.action     = 'rebalance';
    decision.reason     = 'first_deposit';
    decision.confidence = 0.95;
    decision.chain_of_thought.push(`DECISION: REBALANCE (first deposit, deploy to ${decision.metrics.bestProtocolName})`);
    return decision;
  }

  const alreadyOnBest = bestProtocol.toLowerCase() === activeProtocol.toLowerCase();
  if (alreadyOnBest) {
    decision.chain_of_thought.push('Already on the best protocol — no action needed');
    decision.action     = 'no-op';
    decision.reason     = 'already_on_best';
    decision.confidence = 0.99;
    decision.chain_of_thought.push('DECISION: NO-OP (already optimal)');
    return decision;
  }

  if (spread <= 0) {
    decision.chain_of_thought.push(`Negative or zero spread (${(spread/100).toFixed(2)}%) — current is better or equal`);
    decision.action     = 'no-op';
    decision.reason     = 'negative_spread';
    decision.confidence = 0.95;
    decision.chain_of_thought.push('DECISION: NO-OP (current protocol has equal or better APY)');
    return decision;
  }

  if (spread < threshold) {
    decision.chain_of_thought.push(
      `Spread ${(spread/100).toFixed(2)}% below threshold ${(threshold/100).toFixed(2)}% — not worth gas`
    );
    decision.action     = 'no-op';
    decision.reason     = 'below_threshold';
    decision.confidence = 0.85;
    decision.chain_of_thought.push('DECISION: NO-OP (spread below dynamic threshold)');
    return decision;
  }

  if (annualGainUSDC < MIN_GAIN_USDC) {
    decision.chain_of_thought.push(
      `Projected annual gain $${annualGainUSDC.toFixed(4)} below minimum $${MIN_GAIN_USDC} — not economical`
    );
    decision.action     = 'no-op';
    decision.reason     = 'gain_too_small';
    decision.confidence = 0.80;
    decision.chain_of_thought.push('DECISION: NO-OP (gain too small in USDC terms)');
    return decision;
  }

  if (timeSinceLast < CHURN_COOLDOWN_MS) {
    decision.chain_of_thought.push(
      `Last rebalance was ${Math.round(timeSinceLast/1000)}s ago — cooldown ${CHURN_COOLDOWN_MS/1000}s not met`
    );
    decision.action     = 'no-op';
    decision.reason     = 'churn_protection';
    decision.confidence = 0.75;
    decision.chain_of_thought.push('DECISION: NO-OP (anti-churn cooldown active)');
    return decision;
  }

  // All checks passed — recommend rebalance
  decision.action     = 'rebalance';
  decision.reason     = 'profitable_rebalance';
  decision.confidence = Math.min(0.99, 0.5 + (spread / threshold) * 0.25);
  decision.chain_of_thought.push(
    `Spread ${(spread/100).toFixed(2)}% > threshold ${(threshold/100).toFixed(2)}%, ` +
    `gain $${annualGainUSDC.toFixed(4)}/yr, break-even ${daysToBreakEven.toFixed(1)} days`
  );
  decision.chain_of_thought.push(
    `DECISION: REBALANCE → ${decision.metrics.bestProtocolName} ` +
    `(confidence ${(decision.confidence*100).toFixed(0)}%)`
  );

  return decision;
}

// ── Main Agent Loop ─────────────────────────────────────────────────────────
async function runSmartExecutor() {
  const provider  = getProvider();
  const wallet    = getWallet(provider);
  const contracts = getContracts(wallet);
  const { engine } = contracts;

  log.info('Smart Executor agent started', {
    wallet:     wallet.address,
    model:      'rule-based-v1',
    baseThreshold: `${(BASE_THRESHOLD_BPS/100).toFixed(2)}%`,
    churnCooldown: `${CHURN_COOLDOWN_MS/1000}s`,
  });

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, assignedAgent, deadline) => {
      const jobIdNum   = Number(jobId);
      const jobTypeNum = Number(jobType);

      if (jobTypeNum !== 1) return;

      const remaining = (Number(deadline) * 1000) - Date.now();
      log.info('Executor job received', { jobId: jobIdNum, remainingSeconds: Math.floor(remaining / 1000) });

      if (remaining < 15_000) {
        log.warn('Deadline too close, skipping', { jobId: jobIdNum });
        return;
      }

      try {
        await executeSmartRebalanceJob(jobIdNum, contracts);
      } catch (err) {
        log.error('Smart executor job failed', { jobId: jobIdNum, error: err.message });
      }
    },
  });

  await poller.start();
  log.info('Listening for Executor JobAssigned events (Smart Executor)...');

  process.on('SIGINT', () => {
    poller.stop();
    log.info('Smart Executor shutdown');
    process.exit(0);
  });
}

async function executeSmartRebalanceJob(jobId, { engine, yieldReg, vault }) {
  const startMs = Date.now();

  // Step 1: Read all on-chain state
  const [bestProtocol, bestAPYRaw, activeProtocol, activeAPYRaw, vaultBalance] =
    await Promise.all([
      yieldReg.bestProtocol(),
      yieldReg.bestAPY(),
      yieldReg.activeProtocol(),
      yieldReg.activeAPY(),
      vault.getVaultBalance(),
    ]);

  const isFirstDeposit = activeProtocol === ethers.ZeroAddress;

  // Step 2: Run decision engine
  const decision = makeRebalanceDecision({
    bestProtocol,
    bestAPY:       Number(bestAPYRaw),
    activeProtocol,
    activeAPY:     Number(activeAPYRaw),
    vaultBalance,
    isFirstDeposit,
  });

  // Log full reasoning chain
  for (const thought of decision.chain_of_thought) {
    log.info('REASONING', { thought });
  }

  log.info('Decision result', {
    action:     decision.action,
    reason:     decision.reason,
    confidence: `${(decision.confidence*100).toFixed(0)}%`,
    metrics:    decision.metrics,
  });

  // Step 3: Execute decision
  if (decision.action === 'rebalance') {
    log.info('Executing rebalance via engine', {
      to:     decision.metrics.bestProtocolName,
      spread: decision.metrics.spread,
    });

    const completeTx = await withRetry(
      () => engine.completeExecutorJob(jobId, bestProtocol),
      { label: 'completeExecutorJob', maxAttempts: 2 }
    );
    const completeReceipt = await completeTx.wait();

    rebalanceHistory.push({
      timestamp: Date.now(),
      from:      decision.metrics.activeProtocolName,
      to:        decision.metrics.bestProtocolName,
      spread:    decision.metrics.spread,
      vaultSize: decision.metrics.vaultBalance,
    });

    log.info('Smart executor rebalance completed', {
      jobId,
      tx:         completeReceipt.hash,
      elapsedMs:  Date.now() - startMs,
      confidence: decision.confidence,
      gain:       decision.metrics.annualGainUSDC,
    });
  } else {
    log.info('Completing as no-op', { reason: decision.reason });

    const noOpTx = await withRetry(
      () => engine.completeExecutorJobNoOp(jobId),
      { label: 'completeExecutorJobNoOp', maxAttempts: 2 }
    );
    await noOpTx.wait();

    log.info('Smart executor no-op completed', {
      jobId,
      reason:    decision.reason,
      elapsedMs: Date.now() - startMs,
    });
  }

  // Step 4: x402 receipt
  await sendX402Payment({
    amount: '0.001',
    memo:   `orbit-smart-executor-job-${jobId}`,
  }).catch(err => log.warn('x402 non-fatal', { error: err.message }));
}

runSmartExecutor().catch(err => {
  log.error('Fatal smart executor error', { error: err.message, stack: err.stack });
  process.exit(1);
});
