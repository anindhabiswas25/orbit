// Adaptive Executor — intelligent rebalancer with a self-tuning threshold.
//
// Unlike the smart executor's fixed bands, this agent ADAPTS its spread threshold
// to recent market behavior: if it has rebalanced often lately (choppy market) it
// raises the bar to avoid churn; if the vault has been static it lowers the bar to
// capture opportunities. Always rebalances on first deposit. Logs its reasoning.
//
// Start: AGENT_PRIVATE_KEY=0x... AGENT_NAME=AdaptiveExecutor node agents/executor/adaptive-executor.js

const { ethers }          = require('ethers');
const { getProvider, getWallet, getContracts, ADAPTER_NAMES } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

const BASE_THRESHOLD_BPS = 150;     // 1.50% baseline spread
const MIN_THRESHOLD_BPS  = 50;      // floor 0.50%
const MAX_THRESHOLD_BPS  = 400;     // ceiling 4.00%
const CHURN_WINDOW_MS     = 300_000; // look back 5 min for recent rebalances
const MIN_GAIN_USDC       = 0.01;

const recentRebalances = []; // timestamps

function adaptiveThreshold() {
  const now = Date.now();
  while (recentRebalances.length && now - recentRebalances[0] > CHURN_WINDOW_MS) recentRebalances.shift();
  const n = recentRebalances.length;
  // Each recent rebalance raises the threshold by 75 bps; none lowers it toward the floor.
  const t = n === 0 ? MIN_THRESHOLD_BPS + 25 : BASE_THRESHOLD_BPS + n * 75;
  return Math.max(MIN_THRESHOLD_BPS, Math.min(MAX_THRESHOLD_BPS, t));
}

async function runJob(jobId, { engine, yieldReg, vault }) {
  const [best, bestAPYRaw, active, activeAPYRaw, vaultBal] = await Promise.all([
    yieldReg.bestProtocol(), yieldReg.bestAPY(),
    yieldReg.activeProtocol(), yieldReg.activeAPY(),
    vault.getVaultBalance(),
  ]);

  const bestAPY = Number(bestAPYRaw), activeAPY = Number(activeAPYRaw);
  const spread  = bestAPY - activeAPY;
  const balUSDC = Number(vaultBal) / 1e6;
  const isFirst = active === ethers.ZeroAddress;
  const onBest  = best.toLowerCase() === active.toLowerCase();
  const threshold = adaptiveThreshold();
  const annualGain = (balUSDC * spread) / 10_000;

  log.info('Adaptive state', {
    best: ADAPTER_NAMES[best?.toLowerCase()] || best,
    active: ADAPTER_NAMES[active?.toLowerCase()] || 'none',
    spread: `${(spread / 100).toFixed(2)}%`,
    threshold: `${(threshold / 100).toFixed(2)}%`,
    recentRebalances: recentRebalances.length,
    projectedGain: `$${annualGain.toFixed(4)}/yr`,
  });

  let doRebalance = false, reason = '';
  if (isFirst)                     { doRebalance = true;  reason = 'first_deposit'; }
  else if (onBest)                 { doRebalance = false; reason = 'already_on_best'; }
  else if (spread <= 0)            { doRebalance = false; reason = 'no_positive_spread'; }
  else if (spread < threshold)     { doRebalance = false; reason = 'below_adaptive_threshold'; }
  else if (annualGain < MIN_GAIN_USDC) { doRebalance = false; reason = 'gain_too_small'; }
  else                             { doRebalance = true;  reason = 'profitable'; }

  log.info('REASONING', { thought: `decision=${doRebalance ? 'REBALANCE' : 'NO-OP'} reason=${reason}` });

  if (doRebalance) {
    const tx = await withRetry(() => engine.completeExecutorJob(jobId, best), { label: 'completeExecutorJob', maxAttempts: 2 });
    const receipt = await tx.wait();
    recentRebalances.push(Date.now());
    log.info('Adaptive rebalance completed', { jobId, to: ADAPTER_NAMES[best?.toLowerCase()] || best, tx: receipt.hash });
  } else {
    const tx = await withRetry(() => engine.completeExecutorJobNoOp(jobId), { label: 'completeExecutorJobNoOp', maxAttempts: 2 });
    await tx.wait();
    log.info('Adaptive no-op completed', { jobId, reason });
  }

  await sendX402Payment({ amount: '0.001', memo: `orbit-adaptive-executor-${jobId}` }).catch(() => {});
}

async function main() {
  const wallet    = getWallet(getProvider());
  const contracts = getContracts(wallet);
  const { engine } = contracts;

  log.info('Adaptive Executor started', { wallet: wallet.address, model: 'adaptive-v1', baseThreshold: `${(BASE_THRESHOLD_BPS / 100).toFixed(2)}%` });

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, _agent, deadline) => {
      if (Number(jobType) !== 1) return;
      const remaining = Number(deadline) * 1000 - Date.now();
      if (remaining < 15_000) { log.warn('Deadline too close, skipping', { jobId: Number(jobId) }); return; }
      try { await runJob(Number(jobId), contracts); }
      catch (err) { log.error('Adaptive executor job failed', { jobId: Number(jobId), error: err.message }); }
    },
  });
  await poller.start();
  log.info('Listening for Executor jobs (Adaptive)...');
  process.on('SIGINT', () => { poller.stop(); process.exit(0); });
}

main().catch((err) => { log.error('Fatal adaptive executor error', { error: err.message }); process.exit(1); });
