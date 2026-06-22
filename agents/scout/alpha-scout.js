// Alpha Scout — advanced yield intelligence agent
//
// Advantages over existing scouts:
// 1. Parallel APY reads (Promise.allSettled) — fastest possible job completion
// 2. Sharpe-like volatility-adjusted scoring — penalizes unstable/spiking protocols
// 3. EMA-based trend tracking — recent readings weighted more than old ones
// 4. Switching-cost hysteresis — won't recommend a rebalance unless the spread is
//    large enough to justify the gas + slippage cost of moving the vault
// 5. Adaptive weight regime — in calm markets favors raw APY; in volatile markets
//    shifts weight toward stability and trust
// 6. Outlier dampening — clamps extreme APY spikes proportionally
//
// Start:
//   AGENT_PRIVATE_KEY=0x... AGENT_NAME=AlphaScout node agents/scout/alpha-scout.js

const { getProvider, getWallet, getContracts } = require('../shared/contracts');
const { createJobPoller } = require('../shared/poll-jobs');
const { sendX402Payment } = require('../shared/x402-client');
const { withRetry }       = require('../shared/retry');
const log                 = require('../shared/logger');

// ── Tuning Parameters ──────────────────────────────────────────────────────
const MIN_APY_BPS         = 5;       // 0.05% floor
const GAS_COST_BPS        = 5;       // Gas overhead per rebalance
const HYSTERESIS_BPS      = 150;     // 1.50% — don't switch unless gain > this
const EMA_ALPHA           = 0.3;     // EMA smoothing (higher = more weight to recent)
const MAX_HISTORY         = 60;      // Readings per protocol
const OUTLIER_CAP         = 2.5;     // Cap APY at 2.5x EMA to dampen spikes
const VOLATILITY_SHIFT    = 0.15;    // How much weights shift under high vol

// Protocol trust tiers (0-100, higher = more trusted)
const PROTOCOL_TRUST = {
  'AAVE V3':   95,
  'Benqi':     85,
  'MockPoolA': 55,
  'MockPoolB': 55,
};

// Base weights (calm market)
const BASE_WEIGHTS = {
  adjustedAPY: 0.45,
  sharpe:      0.20,
  trend:       0.15,
  trust:       0.20,
};

// ── Per-Protocol State ─────────────────────────────────────────────────────
const state = {}; // { name: { readings: [apy,...], ema: number, emaSq: number } }

function getState(name) {
  if (!state[name]) state[name] = { readings: [], ema: 0, emaSq: 0 };
  return state[name];
}

function record(name, apy) {
  const s = getState(name);
  s.readings.push(apy);
  if (s.readings.length > MAX_HISTORY) s.readings.shift();

  if (s.readings.length === 1) {
    s.ema = apy;
    s.emaSq = apy * apy;
  } else {
    s.ema   = EMA_ALPHA * apy + (1 - EMA_ALPHA) * s.ema;
    s.emaSq = EMA_ALPHA * (apy * apy) + (1 - EMA_ALPHA) * s.emaSq;
  }
}

function getEMA(name)    { return getState(name).ema; }
function getEMAVar(name) { const s = getState(name); return Math.max(0, s.emaSq - s.ema * s.ema); }
function getEMAStd(name) { return Math.sqrt(getEMAVar(name)); }

function getTrend(name) {
  const s = getState(name);
  const r = s.readings;
  if (r.length < 3) return 0;
  const recent = r.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const older  = r.slice(-6, -3);
  if (older.length === 0) return 0;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  if (olderAvg <= 0) return 0;
  return Math.max(-1, Math.min(1, (recent - olderAvg) / olderAvg));
}

// ── Scoring Engine ─────────────────────────────────────────────────────────
function computeMarketVolatility(protocols) {
  let totalVar = 0, count = 0;
  for (const p of protocols) {
    const std = getEMAStd(p.name);
    if (std > 0) { totalVar += std; count++; }
  }
  return count > 0 ? totalVar / count : 0;
}

function adaptWeights(marketVol) {
  // High volatility → shift weight from APY toward stability+trust
  const shift = Math.min(VOLATILITY_SHIFT, marketVol / 500);
  return {
    adjustedAPY: BASE_WEIGHTS.adjustedAPY - shift,
    sharpe:      BASE_WEIGHTS.sharpe + shift * 0.6,
    trend:       BASE_WEIGHTS.trend,
    trust:       BASE_WEIGHTS.trust + shift * 0.4,
  };
}

function analyze(protocols, activeProtocolAddr) {
  const thoughts = [];
  thoughts.push(`Alpha analysis: ${protocols.length} protocols, active=${activeProtocolAddr?.slice(0,10) || 'unknown'}`);

  // Record all readings first
  for (const p of protocols) record(p.name, p.apy);

  // Market regime detection
  const marketVol = computeMarketVolatility(protocols);
  const weights = adaptWeights(marketVol);
  const regime = marketVol > 100 ? 'VOLATILE' : 'CALM';
  thoughts.push(`Market regime: ${regime} (vol=${marketVol.toFixed(1)}, weights: apy=${weights.adjustedAPY.toFixed(2)} sharpe=${weights.sharpe.toFixed(2)} trend=${weights.trend.toFixed(2)} trust=${weights.trust.toFixed(2)})`);

  // Score each protocol
  const scored = [];
  for (const p of protocols) {
    if (p.apy < MIN_APY_BPS) {
      thoughts.push(`SKIP ${p.name}: APY ${(p.apy/100).toFixed(2)}% below floor`);
      continue;
    }

    const ema = getEMA(p.name);
    const std = getEMAStd(p.name);

    // Outlier dampening: if current APY is an extreme spike, cap it
    let adjustedAPY = p.apy - GAS_COST_BPS;
    if (ema > 0 && p.apy > ema * OUTLIER_CAP) {
      adjustedAPY = (ema * OUTLIER_CAP) - GAS_COST_BPS;
      thoughts.push(`DAMPEN ${p.name}: raw ${(p.apy/100).toFixed(2)}% capped to ${(adjustedAPY/100).toFixed(2)}% (${OUTLIER_CAP}x EMA)`);
    }

    // Sub-scores (0-100 normalized)
    const apyScore = Math.min(100, adjustedAPY / 20);

    // Sharpe-like: return per unit of risk. If no variance, decent default.
    const sharpeRaw = std > 0 ? adjustedAPY / std : (adjustedAPY > 0 ? 8 : 0);
    const sharpeScore = Math.min(100, sharpeRaw * 12);

    // Trend: -1..+1 → 0..100
    const trend = getTrend(p.name);
    const trendScore = 50 + trend * 50;

    const trust = PROTOCOL_TRUST[p.name] || 50;

    const composite =
      apyScore    * weights.adjustedAPY +
      sharpeScore * weights.sharpe +
      trendScore  * weights.trend +
      trust       * weights.trust;

    // Is this the currently active protocol?
    const isActive = activeProtocolAddr && p.address.toLowerCase() === activeProtocolAddr.toLowerCase();

    scored.push({
      name: p.name, address: p.address,
      rawAPY: p.apy, adjustedAPY, ema: Math.round(ema), std: Math.round(std),
      scores: { apy: Math.round(apyScore), sharpe: Math.round(sharpeScore), trend: Math.round(trendScore), trust },
      composite: Math.round(composite * 100) / 100,
      isActive,
    });

    thoughts.push(
      `SCORE ${p.name}: adj=${(adjustedAPY/100).toFixed(2)}% ema=${(ema/100).toFixed(2)}% ` +
      `sharpe=${sharpeScore.toFixed(0)} trend=${(trend*100).toFixed(0)}% ` +
      `composite=${composite.toFixed(1)}${isActive ? ' [ACTIVE]' : ''}`
    );
  }

  if (scored.length === 0) return { winner: null, thoughts, hysteresisApplied: false };

  scored.sort((a, b) => b.composite - a.composite);
  const best = scored[0];

  // Hysteresis: if current active protocol is close to best, prefer staying
  const activeEntry = scored.find(s => s.isActive);
  let hysteresisApplied = false;

  if (activeEntry && activeEntry !== best) {
    const spreadBps = best.adjustedAPY - activeEntry.adjustedAPY;
    if (spreadBps < HYSTERESIS_BPS) {
      thoughts.push(
        `HYSTERESIS: ${best.name} beats active ${activeEntry.name} by only ` +
        `${(spreadBps/100).toFixed(2)}% < threshold ${(HYSTERESIS_BPS/100).toFixed(2)}% — staying on ${activeEntry.name}`
      );
      hysteresisApplied = true;
      return { winner: activeEntry, thoughts, hysteresisApplied: true };
    }
    thoughts.push(
      `SWITCH: ${best.name} beats active ${activeEntry.name} by ${(spreadBps/100).toFixed(2)}% > threshold — switching`
    );
  }

  // Confidence
  let confidence = 0.8;
  if (scored.length > 1) {
    const margin = (best.composite - scored[1].composite) / best.composite;
    confidence = Math.min(0.99, 0.5 + margin * 2.5);
  }

  thoughts.push(
    `DECISION: ${best.name} wins — composite=${best.composite.toFixed(1)}, ` +
    `APY=${(best.adjustedAPY/100).toFixed(2)}%, confidence=${(confidence*100).toFixed(0)}%`
  );

  return { winner: best, thoughts, hysteresisApplied, confidence };
}

// ── Job Execution ──────────────────────────────────────────────────────────
async function executeJob(jobId, wallet, { engine, yieldReg, vault, adapters }) {
  const startMs = Date.now();

  // Read current active protocol for hysteresis comparison
  let activeProtocolAddr = null;
  try {
    activeProtocolAddr = await vault.activeProtocol();
  } catch { /* ignore — hysteresis just won't apply */ }

  // PARALLEL APY reads — all 4 adapters at once instead of sequential
  const adapterEntries = Object.entries(adapters);
  const results = await Promise.allSettled(
    adapterEntries.map(async ([name, contract]) => {
      const rawAPY = await withRetry(
        () => contract.getAPY(),
        { label: `getAPY(${name})`, maxAttempts: 3, baseDelayMs: 300 }
      );
      const addr = await contract.getAddress();
      return { name, address: addr, apy: Number(rawAPY) };
    })
  );

  const protocols = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      protocols.push(r.value);
      log.info('APY read', { protocol: r.value.name, apy: r.value.apy, formatted: `${(r.value.apy/100).toFixed(2)}%` });
    } else {
      log.warn('APY read failed', { protocol: adapterEntries[i][0], error: r.reason?.message });
    }
  }

  if (protocols.filter(p => p.apy > 0).length === 0) {
    throw new Error('No protocols returned APY > 0');
  }

  const readMs = Date.now() - startMs;

  // Run analysis
  const { winner, thoughts, hysteresisApplied, confidence } = analyze(protocols, activeProtocolAddr);
  for (const t of thoughts) log.info('REASONING', { thought: t });

  if (!winner) throw new Error('No viable protocol after analysis');

  log.info('Winner selected (Alpha)', {
    protocol:    winner.name,
    rawAPY:      `${(winner.rawAPY/100).toFixed(2)}%`,
    adjustedAPY: `${(winner.adjustedAPY/100).toFixed(2)}%`,
    composite:   winner.composite,
    confidence:  confidence ? `${(confidence*100).toFixed(0)}%` : 'N/A',
    hysteresis:  hysteresisApplied,
    readMs,
  });

  // Post to YieldRegistry
  const regTx = await withRetry(
    () => yieldReg.updateBestProtocol(winner.address, winner.rawAPY),
    { label: 'updateBestProtocol', maxAttempts: 2 }
  );
  await regTx.wait();

  // Complete job
  const doneTx = await withRetry(
    () => engine.completeScoutJob(jobId),
    { label: 'completeScoutJob', maxAttempts: 2 }
  );
  const receipt = await doneTx.wait();

  const elapsedMs = Date.now() - startMs;
  log.info('Alpha scout job completed', {
    jobId, tx: receipt.hash, elapsedMs, hysteresis: hysteresisApplied,
  });

  await sendX402Payment({
    amount: '0.001',
    memo: `orbit-alpha-scout-${jobId}:${receipt.hash}`,
  }).catch(() => {});
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const wallet    = getWallet(getProvider());
  const contracts = getContracts(wallet);
  const { engine } = contracts;

  log.info('Alpha Scout started', {
    wallet:     wallet.address,
    model:      'alpha-v1',
    baseWeights: BASE_WEIGHTS,
    hysteresisBps: HYSTERESIS_BPS,
    outlierCap: OUTLIER_CAP,
  });

  const poller = createJobPoller(engine, wallet, {
    onJob: async (jobId, jobType, _agent, deadline) => {
      if (Number(jobType) !== 0) return; // Only scout jobs (type 0)
      const remaining = Number(deadline) * 1000 - Date.now();
      if (remaining < 10_000) {
        log.warn('Deadline too close, skipping', { jobId: Number(jobId), remainingMs: remaining });
        return;
      }
      try {
        await executeJob(Number(jobId), wallet, contracts);
      } catch (err) {
        log.error('Alpha scout job failed', { jobId: Number(jobId), error: err.message });
      }
    },
  });

  await poller.start();
  log.info('Listening for Scout jobs (Alpha)...');
  process.on('SIGINT', () => { poller.stop(); log.info('Alpha Scout shutdown'); process.exit(0); });
}

main().catch(err => {
  log.error('Fatal alpha scout error', { error: err.message, stack: err.stack });
  process.exit(1);
});
