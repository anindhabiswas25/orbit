// Scout Agent entry point.
// Start with: AGENT_NAME=MyScout node agents/scout/index.js
//
// Flow:
// 1. Connect to Fuji via ethers.js
// 2. Listen for JobAssigned events from AgentSelectionEngine
// 3. When assigned a Scout job: reads APYs → posts winner → confirms completion
// 4. Receives payment on-chain via FeePool to dev wallet

const { getProvider, getWallet, getContracts } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

const GAS_PENALTY_BPS = 5; // Subtract 0.05% from raw APY to account for gas cost

async function runScout() {
  const provider  = getProvider();
  const wallet    = getWallet(provider);
  const contracts = getContracts(wallet);
  const { engine, yieldReg, adapters } = contracts;

  log.info('Scout agent started', {
    wallet:  wallet.address,
    network: 'avalanche-fuji',
    chainId: 43113,
  });

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, assignedAgent, deadline) => {
      const jobIdNum   = Number(jobId);
      const jobTypeNum = Number(jobType);

      if (jobTypeNum !== 0) return;

      const deadlineMs = Number(deadline) * 1000;
      const remaining  = deadlineMs - Date.now();

      log.info('Scout job received', {
        jobId:            jobIdNum,
        deadline:         new Date(deadlineMs).toISOString(),
        remainingSeconds: Math.floor(remaining / 1000),
      });

      if (remaining < 10_000) {
        log.warn('Job deadline too close, skipping', { jobId: jobIdNum, remainingMs: remaining });
        return;
      }

      try {
        await executeScoutJob(jobIdNum, wallet, { engine, yieldReg, adapters });
      } catch (err) {
        log.error('Scout job execution failed', {
          jobId: jobIdNum,
          error: err.message,
        });
      }
    },
  });

  await poller.start();
  log.info('Listening for JobAssigned events on AgentSelectionEngine...');
  log.info('Press Ctrl+C to stop');

  process.on('SIGINT', () => {
    poller.stop();
    log.info('Shutdown signal received');
    process.exit(0);
  });
}

async function executeScoutJob(jobId, wallet, { engine, yieldReg, adapters }) {
  const startMs = Date.now();

  // ── Step 1: Read APY from all adapters ─────────────────────────────────────
  const apyResults = [];

  for (const [name, contract] of Object.entries(adapters)) {
    try {
      const rawAPY = await withRetry(
        () => contract.getAPY(),
        { label: `getAPY(${name})`, maxAttempts: 3, baseDelayMs: 500 }
      );
      const apy  = Number(rawAPY);
      const addr = await contract.getAddress();
      log.info('APY read', { protocol: name, apy, formatted: `${(apy / 100).toFixed(2)}%` });
      apyResults.push({ name, address: addr, apy });
    } catch (err) {
      log.warn('APY read failed — skipping protocol', { protocol: name, error: err.message });
    }
  }

  // ── Step 2: Filter and rank ─────────────────────────────────────────────────
  const active = apyResults.filter(p => p.apy > 0);
  if (active.length === 0) {
    throw new Error('No active protocols returned APY > 0. Cannot complete scout job.');
  }

  const scored = active.map(p => ({ ...p, effectiveAPY: p.apy - GAS_PENALTY_BPS }));
  scored.sort((a, b) => b.effectiveAPY - a.effectiveAPY);
  const winner = scored[0];

  log.info('Winner selected', {
    protocol:     winner.name,
    address:      winner.address,
    rawAPY:       winner.apy,
    effectiveAPY: winner.effectiveAPY,
    formatted:    `${(winner.apy / 100).toFixed(2)}%`,
  });

  // ── Step 3: Post result to YieldRegistry ────────────────────────────────────
  const registryTx = await withRetry(
    () => yieldReg.updateBestProtocol(winner.address, winner.apy),
    { label: 'updateBestProtocol', maxAttempts: 2 }
  );
  const registryReceipt = await registryTx.wait();
  log.info('YieldRegistry updated', {
    tx:      registryReceipt.hash,
    gasUsed: registryReceipt.gasUsed.toString(),
  });

  // ── Step 4: Confirm job completion to engine ────────────────────────────────
  const completeTx = await withRetry(
    () => engine.completeScoutJob(jobId),
    { label: 'completeScoutJob', maxAttempts: 2 }
  );
  const completeReceipt = await completeTx.wait();
  log.info('Scout job completed', {
    jobId,
    tx:        completeReceipt.hash,
    elapsedMs: Date.now() - startMs,
  });

  // ── Step 5: x402 settlement receipt (non-blocking) ──────────────────────────
  await sendX402Payment({
    amount: '0.001',
    memo:   `orbit-scout-job-${jobId}:${completeReceipt.hash}`,
  }).catch(err => log.warn('x402 payment failed (non-fatal)', { error: err.message }));
}

runScout().catch(err => {
  log.error('Fatal error in scout agent', { error: err.message, stack: err.stack });
  process.exit(1);
});
