// All on-chain reads. Single provider per request. 5-second result cache via cache.js.
// Route files: import getChainData() and call its methods.
// Never construct ethers contracts in route files.

const { ethers }  = require('ethers');
const cache       = require('./cache');
const ADDRESSES   = require('../../deployed-addresses.json');
require('dotenv').config();

function loadABI(name) {
  return require(`../../artifacts/contracts/${name}.sol/${name}.json`).abi;
}

function loadAdapterABI() {
  return require('../../artifacts/contracts/interfaces/IYieldAdapter.sol/IYieldAdapter.json').abi;
}

const ABIS = {
  AgentRegistry:        loadABI('AgentRegistry'),
  AgentSelectionEngine: loadABI('AgentSelectionEngine'),
  YieldRegistry:        loadABI('YieldRegistry'),
  YieldVault:           loadABI('YieldVault'),
  IYieldAdapter:        loadAdapterABI(),
};

const ADAPTER_NAMES = {
  [ADDRESSES.AaveAdapter?.toLowerCase()]:  'AAVE V3',
  [ADDRESSES.BenqiAdapter?.toLowerCase()]: 'Benqi',
  [ADDRESSES.MockPoolA?.toLowerCase()]:    'MockPoolA',
  [ADDRESSES.MockPoolB?.toLowerCase()]:    'MockPoolB',
};

const ADAPTER_ADDRS = [
  ADDRESSES.AaveAdapter,
  ADDRESSES.BenqiAdapter,
  ADDRESSES.MockPoolA,
  ADDRESSES.MockPoolB,
].filter(Boolean);

const AGENT_TYPE_LABEL   = { 0: 'Scout',   1: 'Executor' };
const AGENT_STATUS_LABEL = { 0: 'Active',  1: 'Paused', 2: 'Deregistered', 3: 'Banned' };
const JOB_STATUS_LABEL   = { 0: 'Pending', 1: 'Completed', 2: 'Failed', 3: 'Expired' };
const JOB_TYPE_LABEL     = { 0: 'Scout',   1: 'Executor' };

function getProvider() {
  return new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL);
}

function getChainData() {
  const provider = getProvider();
  const registry = new ethers.Contract(ADDRESSES.AgentRegistry,        ABIS.AgentRegistry,        provider);
  const engine   = new ethers.Contract(ADDRESSES.AgentSelectionEngine,  ABIS.AgentSelectionEngine,  provider);
  const yieldReg = new ethers.Contract(ADDRESSES.YieldRegistry,         ABIS.YieldRegistry,         provider);
  const vault    = new ethers.Contract(ADDRESSES.YieldVault,            ABIS.YieldVault,            provider);

  // The default publicnode RPC caps eth_getLogs to a few hundred blocks, so use
  // a dedicated logs provider (the official Avalanche RPC allows ~2048) for the
  // event queries that attach explorer tx hashes. Older items fall back to null.
  const LOG_LOOKBACK_BLOCKS = 2000;
  const LOGS_RPC = process.env.LOGS_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
  const logsProvider = new ethers.JsonRpcProvider(LOGS_RPC);
  const engineLogs   = new ethers.Contract(ADDRESSES.AgentSelectionEngine, ABIS.AgentSelectionEngine, logsProvider);
  const yieldRegLogs = new ethers.Contract(ADDRESSES.YieldRegistry,        ABIS.YieldRegistry,        logsProvider);

  async function recentLogWindow() {
    const latest = await logsProvider.getBlockNumber();
    return { from: Math.max(0, latest - LOG_LOOKBACK_BLOCKS), to: latest };
  }

  // jobId -> { assignedTx, resultTx } from engine events (indexed jobId).
  const jobTxMaps = cache.wrap('jobTxMaps', async function () {
    const out = { assigned: {}, result: {} };
    try {
      const { from, to } = await recentLogWindow();
      const [assigned, completed, noop, expired, failed] = await Promise.all([
        engineLogs.queryFilter(engineLogs.filters.JobAssigned(),  from, to),
        engineLogs.queryFilter(engineLogs.filters.JobCompleted(), from, to),
        engineLogs.queryFilter(engineLogs.filters.JobNoOp(),      from, to),
        engineLogs.queryFilter(engineLogs.filters.JobExpired(),   from, to),
        engineLogs.queryFilter(engineLogs.filters.JobFailed(),    from, to),
      ]);
      for (const ev of assigned) out.assigned[Number(ev.args.jobId)] = ev.transactionHash;
      for (const ev of [...completed, ...noop, ...expired, ...failed]) {
        out.result[Number(ev.args.jobId)] = ev.transactionHash;
      }
    } catch { /* RPC range/limit issue — leave maps empty, links fall back */ }
    return out;
  });

  // RebalanceLogged events keyed by from|to|amount so we can attach the tx hash
  // to each stored rebalance log.
  const rebalanceTxMap = cache.wrap('rebalanceTxMap', async function () {
    const out = {};
    try {
      const { from, to } = await recentLogWindow();
      const evs = await yieldRegLogs.queryFilter(yieldRegLogs.filters.RebalanceLogged(), from, to);
      for (const ev of evs) {
        const key = [
          ev.args.from?.toLowerCase(),
          ev.args.to?.toLowerCase(),
          ev.args.amount?.toString(),
        ].join('|');
        out[key] = ev.transactionHash;
      }
    } catch { /* leave empty */ }
    return out;
  });

  return {

    // GET /api/meta — deployed addresses + explorer base for the dashboard
    getMeta: cache.wrap('meta', async function () {
      return {
        chainId:      ADDRESSES.chainId || 43113,
        network:      ADDRESSES.network || 'fuji',
        explorerBase: 'https://testnet.snowtrace.io',
        contracts: {
          AgentRegistry:        ADDRESSES.AgentRegistry,
          AgentSelectionEngine: ADDRESSES.AgentSelectionEngine,
          YieldRegistry:        ADDRESSES.YieldRegistry,
          YieldVault:           ADDRESSES.YieldVault,
          FeePool:              ADDRESSES.FeePool,
          PaymentLedger:        ADDRESSES.PaymentLedger,
          USDC:                 ADDRESSES.USDC,
        },
      };
    }),

    // GET /api/status
    getVaultStatus: cache.wrap('vaultStatus', async function () {
      const [balance, active, activeAPY, best, bestAPY, lastUpdated] = await Promise.all([
        vault.getVaultBalance(),
        yieldReg.activeProtocol(),
        yieldReg.activeAPY(),
        yieldReg.bestProtocol(),
        yieldReg.bestAPY(),
        yieldReg.lastUpdated(),
      ]);

      // activeAPY in the registry is a snapshot taken at the last rebalance, so
      // it goes stale if the active pool's rate changes without a rebalance
      // (e.g. you set it manually while the vault is already on that pool).
      // Read the live rate from the active adapter so the dashboard reflects
      // the real current yield. Fall back to the stored snapshot on any issue.
      let currentAPY = Number(activeAPY);
      if (active && active !== ethers.ZeroAddress) {
        try {
          const adapter = new ethers.Contract(active, ABIS.IYieldAdapter, provider);
          currentAPY = Number(await adapter.getAPY());
        } catch { /* keep stored snapshot */ }
      }

      return {
        vaultBalanceRaw:     balance.toString(),
        vaultBalance:        Number(balance) / 1e6,
        currentProtocol:     active,
        currentProtocolName: ADAPTER_NAMES[active?.toLowerCase()] || 'None',
        currentAPY:          currentAPY,
        currentAPYFormatted: `${(currentAPY / 100).toFixed(2)}%`,
        bestProtocol:        best,
        bestProtocolName:    ADAPTER_NAMES[best?.toLowerCase()] || 'None',
        bestAPY:             Number(bestAPY),
        bestAPYFormatted:    `${(Number(bestAPY) / 100).toFixed(2)}%`,
        lastScoutAt:         Number(lastUpdated) * 1000,
      };
    }),

    // GET /api/protocols
    getAllProtocols: cache.wrap('protocols', async function () {
      const activeAdapter = (await yieldReg.activeProtocol()).toLowerCase();
      const results = await Promise.all(
        ADAPTER_ADDRS.map(async addr => {
          const contract = new ethers.Contract(addr, ABIS.IYieldAdapter, provider);
          try {
            const apy = Number(await contract.getAPY());
            return {
              name:         ADAPTER_NAMES[addr.toLowerCase()],
              address:      addr,
              apy,
              apyFormatted: `${(apy / 100).toFixed(2)}%`,
              isActive:     addr.toLowerCase() === activeAdapter,
              error:        false,
            };
          } catch {
            return {
              name:         ADAPTER_NAMES[addr.toLowerCase()],
              address:      addr,
              apy:          0,
              apyFormatted: '0.00%',
              isActive:     false,
              error:        true,
            };
          }
        })
      );
      return results.sort((a, b) => b.apy - a.apy);
    }),

    // GET /api/agents
    getAllAgents: cache.wrap('agents', async function (type = null) {
      const [scouts, executors] = await Promise.all([
        registry.getAllScouts(),
        registry.getAllExecutors(),
      ]);
      let wallets = [...new Set([...scouts, ...executors])];
      if (type === 'scout')    wallets = scouts;
      if (type === 'executor') wallets = executors;

      const agentData = await Promise.all(wallets.map(async w => {
        const a = await registry.getAgent(w);
        return {
          wallet:          a.wallet,
          developerWallet: a.developerWallet,
          type:            AGENT_TYPE_LABEL[Number(a.agentType)],
          status:          AGENT_STATUS_LABEL[Number(a.status)],
          endpoint:        a.endpoint,
          fee:             Number(a.fee),
          feeFormatted:    `${(Number(a.fee) / 100).toFixed(2)}% per job`,
          stake:           Number(a.stake) / 1e6,
          reputation:      Number(a.reputationScore),
          jobsCompleted:   Number(a.jobsCompleted),
          jobsFailed:      Number(a.jobsFailed),
          registeredAt:    Number(a.registeredAt) * 1000,
        };
      }));

      return agentData
        .filter(a => a.status === 'Active' || a.status === 'Paused')
        .sort((a, b) => b.reputation - a.reputation);
    }),

    // GET /api/jobs
    getRecentJobs: cache.wrap('jobs', async function (limit = 20) {
      const nextJobId = Number(await engine.nextJobId());
      if (nextJobId === 0) return [];
      const from    = Math.max(1, nextJobId - limit + 1);
      const txMaps  = await jobTxMaps();
      const results = [];
      for (let id = nextJobId; id >= from; id--) {
        try {
          const j = await engine.getJob(id);
          if (Number(j.jobId) === 0) continue; // job doesn't exist
          const jid = Number(j.jobId);
          results.push({
            jobId:      jid,
            type:       JOB_TYPE_LABEL[Number(j.jobType)],
            agent:      j.assignedAgent,
            assignedAt: Number(j.assignedAt) * 1000,
            deadline:   Number(j.deadline) * 1000,
            status:     JOB_STATUS_LABEL[Number(j.status)],
            assignedTx: txMaps.assigned[jid] || null,
            resultTx:   txMaps.result[jid]   || null,
          });
        } catch { /* job slot empty */ }
      }
      return results;
    }),

    // GET /api/events
    getRebalanceLogs: cache.wrap('events', async function (limit = 20) {
      const count = Number(await yieldReg.getRebalanceLogsCount());
      if (count === 0) return [];
      const n    = Math.min(limit, count);
      const from = Math.max(0, count - n);
      const logs   = await yieldReg.getRebalanceLogs(from, n);
      const txMap  = await rebalanceTxMap();
      return logs.map(l => {
        const key = [
          l.fromProtocol?.toLowerCase(),
          l.toProtocol?.toLowerCase(),
          l.amount?.toString(),
        ].join('|');
        return {
          fromProtocol:  l.fromProtocol,
          fromName:      ADAPTER_NAMES[l.fromProtocol?.toLowerCase()] || l.fromProtocol,
          toProtocol:    l.toProtocol,
          toName:        ADAPTER_NAMES[l.toProtocol?.toLowerCase()] || l.toProtocol,
          fromAPY:       Number(l.fromAPY),
          toAPY:         Number(l.toAPY),
          fromFormatted: `${(Number(l.fromAPY) / 100).toFixed(2)}%`,
          toFormatted:   `${(Number(l.toAPY)   / 100).toFixed(2)}%`,
          amount:        Number(l.amount) / 1e6,
          timestamp:     Number(l.timestamp) * 1000,
          executorAgent: l.executorAgent,
          gain:          Number(l.toAPY) - Number(l.fromAPY),
          gainFormatted: `+${((Number(l.toAPY) - Number(l.fromAPY)) / 100).toFixed(2)}%`,
          txHash:        txMap[key] || null,
        };
      }).reverse();
    }),

  };
}

module.exports = { getChainData, ADDRESSES };
