// Momentum Scout — intelligent yield scout that favors protocols whose APY is
// trending UP, not just whichever is highest right now. Rationale: a pool with a
// rising rate is likely to keep paying well, while a transient spike may revert.
//
// Strategy (rule-based, chain-of-thought logged):
//   score = apyScore(60%) + momentumScore(25%) + trustScore(15%)
//   - apyScore:      current net APY, normalized
//   - momentumScore: slope of recent APY readings (rising = higher)
//   - trustScore:    protocol risk tier
//
// Start: AGENT_PRIVATE_KEY=0x... AGENT_NAME=MomentumScout node agents/scout/momentum-scout.js

const { getProvider, getWallet, getContracts } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

const WEIGHTS       = { apy: 0.60, momentum: 0.25, trust: 0.15 };
const GAS_COST_BPS  = 5;
const MIN_APY_BPS   = 10;
const MAX_HISTORY   = 20;

const PROTOCOL_RISK = { 'AAVE V3': 90, 'Benqi': 80, 'MockPoolA': 60, 'MockPoolB': 60 };

const apyHistory = {}; // { name: [apy, ...] }

function record(name, apy) {
  (apyHistory[name] ||= []).push(apy);
  if (apyHistory[name].length > MAX_HISTORY) apyHistory[name].shift();
}

// Simple normalized trend: (last - first) / first over the kept window, clamped.
function momentum(name) {
  const h = apyHistory[name];
  if (!h || h.length < 2) return 0;
  const first = h[0], last = h[h.length - 1];
  if (first <= 0) return 0;
  return Math.max(-1, Math.min(1, (last - first) / first));
}

function analyze(protocols) {
  const thoughts = [];
  thoughts.push(`Momentum analysis over ${protocols.length} protocol(s)`);

  const viable = [];
  for (const p of protocols) {
    record(p.name, p.apy);
    if (p.apy < MIN_APY_BPS) {
      thoughts.push(`SKIP ${p.name}: APY ${(p.apy / 100).toFixed(2)}% below floor`);
      continue;
    }
    viable.push(p);
  }
  if (viable.length === 0) return { winner: null, thoughts };

  const scored = viable.map((p) => {
    const effective = p.apy - GAS_COST_BPS;
    const apyScore  = Math.min(100, effective / 20);
    const mom       = momentum(p.name);
    const momScore  = 50 + mom * 50; // -1..1 → 0..100
    const trust     = PROTOCOL_RISK[p.name] || 50;
    const composite = apyScore * WEIGHTS.apy + momScore * WEIGHTS.momentum + trust * WEIGHTS.trust;
    thoughts.push(
      `SCORE ${p.name}: apy=${(effective / 100).toFixed(2)}% mom=${(mom * 100).toFixed(0)}% ` +
      `composite=${composite.toFixed(1)}`
    );
    return { ...p, effective, composite };
  });

  scored.sort((a, b) => b.composite - a.composite);
  const winner = scored[0];
  thoughts.push(`DECISION: ${winner.name} (composite ${winner.composite.toFixed(1)}, APY ${(winner.apy / 100).toFixed(2)}%)`);
  return { winner, thoughts };
}

async function runJob(jobId, { engine, yieldReg, adapters }) {
  const protocols = [];
  for (const [name, contract] of Object.entries(adapters)) {
    try {
      const apy  = Number(await withRetry(() => contract.getAPY(), { label: `getAPY(${name})`, maxAttempts: 3 }));
      const addr = await contract.getAddress();
      protocols.push({ name, address: addr, apy });
    } catch (err) {
      log.warn('APY read failed', { protocol: name, error: err.message });
    }
  }

  const { winner, thoughts } = analyze(protocols);
  for (const t of thoughts) log.info('REASONING', { thought: t });
  if (!winner) throw new Error('No viable protocol found');

  log.info('Winner selected (momentum)', { protocol: winner.name, apy: `${(winner.apy / 100).toFixed(2)}%` });

  const regTx = await withRetry(() => yieldReg.updateBestProtocol(winner.address, winner.apy), { label: 'updateBestProtocol', maxAttempts: 2 });
  await regTx.wait();
  const doneTx = await withRetry(() => engine.completeScoutJob(jobId), { label: 'completeScoutJob', maxAttempts: 2 });
  const receipt = await doneTx.wait();
  log.info('Momentum scout job completed', { jobId, tx: receipt.hash });

  await sendX402Payment({ amount: '0.001', memo: `orbit-momentum-scout-${jobId}` }).catch(() => {});
}

async function main() {
  const wallet    = getWallet(getProvider());
  const contracts = getContracts(wallet);
  const { engine } = contracts;

  log.info('Momentum Scout started', { wallet: wallet.address, model: 'momentum-v1', weights: WEIGHTS });

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, _agent, deadline) => {
      if (Number(jobType) !== 0) return;
      const remaining = Number(deadline) * 1000 - Date.now();
      if (remaining < 10_000) { log.warn('Deadline too close, skipping', { jobId: Number(jobId) }); return; }
      try { await runJob(Number(jobId), contracts); }
      catch (err) { log.error('Momentum scout job failed', { jobId: Number(jobId), error: err.message }); }
    },
  });
  await poller.start();
  log.info('Listening for Scout jobs (Momentum)...');
  process.on('SIGINT', () => { poller.stop(); process.exit(0); });
}

main().catch((err) => { log.error('Fatal momentum scout error', { error: err.message }); process.exit(1); });
