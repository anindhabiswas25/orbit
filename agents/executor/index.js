// Executor Agent entry point.
// Start with: AGENT_NAME=MyExecutor node agents/executor/index.js
//
// Flow:
// 1. Listen for Executor JobAssigned events
// 2. Read bestProtocol/currentProtocol from YieldRegistry
// 3. If rebalance needed: engine.completeExecutorJob(jobId, bestProtocol)
//    Engine atomically calls vault.rebalance() + yieldRegistry.logRebalance()
// 4. If no rebalance: engine.completeExecutorJobNoOp(jobId)
//
// NOTE: Agent does NOT call vault.rebalance() directly — that is onlyEngine.
//       Agent does NOT call yieldReg.logRebalance() — engine does it internally.

const { ethers }          = require('ethers');
const { getProvider, getWallet, getContracts, ADDRESSES, ADAPTER_NAMES } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

const DEFAULT_THRESHOLD_BPS = 200; // 2% minimum spread if no user policy

async function runExecutor() {
  const provider  = getProvider();
  const wallet    = getWallet(provider);
  const contracts = getContracts(wallet);
  const { engine } = contracts;

  log.info('Executor agent started', { wallet: wallet.address });

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
        await executeRebalanceJob(jobIdNum, contracts);
      } catch (err) {
        log.error('Executor job failed', { jobId: jobIdNum, error: err.message });
      }
    },
  });

  await poller.start();
  log.info('Listening for Executor JobAssigned events...');

  process.on('SIGINT', () => {
    poller.stop();
    log.info('Executor shutdown');
    process.exit(0);
  });
}

async function executeRebalanceJob(jobId, { engine, yieldReg }) {
  const startMs = Date.now();

  // ── Step 1: Read current state ──────────────────────────────────────────────
  const [bestProtocol, bestAPYRaw, activeProtocol, activeAPYRaw, vaultBalance] =
    await Promise.all([
      yieldReg.bestProtocol(),
      yieldReg.bestAPY(),
      yieldReg.activeProtocol(),
      yieldReg.activeAPY(),
      (async () => {
        try {
          const contracts = getContracts(engine.runner);
          return await contracts.vault.getVaultBalance();
        } catch { return 0n; }
      })(),
    ]);

  const bestAPY    = Number(bestAPYRaw);
  const currentAPY = Number(activeAPYRaw);
  const spread     = bestAPY - currentAPY;
  const balanceUSDC = Number(vaultBalance) / 1e6;

  log.info('Executor state', {
    bestProtocol,
    bestProtocolName:   ADAPTER_NAMES[bestProtocol?.toLowerCase()] || bestProtocol,
    bestAPY:            `${(bestAPY / 100).toFixed(2)}%`,
    activeProtocol,
    activeProtocolName: ADAPTER_NAMES[activeProtocol?.toLowerCase()] || 'none',
    currentAPY:         `${(currentAPY / 100).toFixed(2)}%`,
    spread:             `${(spread / 100).toFixed(2)}%`,
    vaultBalance:       `${balanceUSDC.toFixed(2)} USDC`,
  });

  // ── Step 2: Decision logic ──────────────────────────────────────────────────

  const isFirstDeposit = activeProtocol === ethers.ZeroAddress;
  const alreadyOnBest  = bestProtocol.toLowerCase() === activeProtocol.toLowerCase();

  if (alreadyOnBest) {
    log.info('Already on best protocol, completing as no-op');
    const tx = await withRetry(
      () => engine.completeExecutorJobNoOp(jobId),
      { label: 'completeExecutorJobNoOp', maxAttempts: 2 }
    );
    await tx.wait();
    log.info('Executor job completed (no-op — already on best)', { jobId });
    return;
  }

  if (!isFirstDeposit && spread < DEFAULT_THRESHOLD_BPS) {
    log.info('Spread below threshold, completing as no-op', {
      spread:    `${(spread / 100).toFixed(2)}%`,
      threshold: `${(DEFAULT_THRESHOLD_BPS / 100).toFixed(2)}%`,
    });
    const tx = await withRetry(
      () => engine.completeExecutorJobNoOp(jobId),
      { label: 'completeExecutorJobNoOp', maxAttempts: 2 }
    );
    await tx.wait();
    log.info('Executor job completed (no-op — threshold not met)', { jobId });
    return;
  }

  // ── Step 3: Execute rebalance via engine ────────────────────────────────────
  // Engine atomically: vault.rebalance(bestProtocol) + yieldReg.logRebalance() + reward
  log.info('Executing rebalance', {
    from:   ADAPTER_NAMES[activeProtocol?.toLowerCase()] || 'none',
    to:     ADAPTER_NAMES[bestProtocol?.toLowerCase()]   || bestProtocol,
    spread: `${(spread / 100).toFixed(2)}%`,
    amount: `${balanceUSDC.toFixed(2)} USDC`,
  });

  const completeTx = await withRetry(
    () => engine.completeExecutorJob(jobId, bestProtocol),
    { label: 'completeExecutorJob', maxAttempts: 2 }
  );
  const completeReceipt = await completeTx.wait();

  log.info('Executor job completed with rebalance', {
    jobId,
    tx:            completeReceipt.hash,
    elapsedMs:     Date.now() - startMs,
    gainFormatted: `+${(spread / 100).toFixed(2)}%`,
  });

  // ── Step 4: x402 settlement receipt (non-blocking) ──────────────────────────
  await sendX402Payment({
    amount: '0.001',
    memo:   `orbit-executor-job-${jobId}:${completeReceipt.hash}`,
  }).catch(err => log.warn('x402 non-fatal', { error: err.message }));
}

runExecutor().catch(err => {
  log.error('Fatal executor error', { error: err.message });
  process.exit(1);
});
