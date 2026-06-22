// Poll-based job watcher for Fuji testnet.
// Fuji's public RPC drops event filters frequently, so we poll eth_getLogs
// for JobAssigned events instead of relying on engine.on('JobAssigned', ...).

const { ethers } = require('ethers');

const POLL_INTERVAL_MS = 4000;
// Public Fuji RPCs reject eth_getLogs windows beyond ~64 blocks ("archive
// requires token"). Advancing fromBlock only on success means one transient
// failure freezes it and the window grows until it permanently exceeds that
// cap, wedging the poller. Stay safely under the cap and skip any gap so the
// poller can never wedge — re-scanned logs are deduped via processedJobs.
const MAX_LOOKBACK = 45;

function createJobPoller(engine, wallet, { onJob }) {
  const processedJobs = new Set();
  const iface = engine.interface;
  const topic  = iface.getEvent('JobAssigned').topicHash;
  let fromBlock = 0;
  let polling = true;

  async function init() {
    try {
      const bn = await engine.runner.provider.getBlockNumber();
      fromBlock = Math.max(0, bn - 5);
    } catch {
      fromBlock = 0;
    }
  }

  async function poll() {
    while (polling) {
      try {
        const currentBlock = await engine.runner.provider.getBlockNumber();
        // Clamp the window: never request more than MAX_LOOKBACK blocks. If we
        // fell behind (transient failures), skip the gap rather than wedge.
        let start = fromBlock;
        if (currentBlock - start > MAX_LOOKBACK) start = currentBlock - MAX_LOOKBACK;
        if (start > currentBlock) { await new Promise(r => setTimeout(r, POLL_INTERVAL_MS)); continue; }

        const logs = await engine.runner.provider.getLogs({
          address:   await engine.getAddress(),
          topics:    [topic],
          fromBlock: start,
          toBlock:   currentBlock,
        });

        for (const log of logs) {
          const parsed = iface.parseLog(log);
          if (!parsed) continue;

          const jobId        = parsed.args[0];
          const jobType      = parsed.args[1];
          const assignedAgent = parsed.args[2];
          const deadline     = parsed.args[3];
          const jobIdNum     = Number(jobId);

          if (processedJobs.has(jobIdNum)) continue;
          if (assignedAgent.toLowerCase() !== wallet.address.toLowerCase()) continue;

          processedJobs.add(jobIdNum);
          onJob(jobId, jobType, assignedAgent, deadline);
        }

        fromBlock = currentBlock + 1;
      } catch (err) {
        // Non-fatal — will retry next poll
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  return {
    start: async () => { await init(); poll(); },
    stop:  () => { polling = false; },
  };
}

module.exports = { createJobPoller };
