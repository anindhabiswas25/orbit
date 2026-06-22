// Single source of truth for all contract instances.
// Import this in every agent file — never construct contracts elsewhere.

const { ethers } = require('ethers');
const ADDRESSES  = require('../../deployed-addresses.json');
require('dotenv').config();

function loadABI(contractName, subfolder = '') {
  const path = subfolder
    ? `../../artifacts/contracts/${subfolder}/${contractName}.sol/${contractName}.json`
    : `../../artifacts/contracts/${contractName}.sol/${contractName}.json`;
  return require(path).abi;
}

const ABIS = {
  AgentRegistry:        loadABI('AgentRegistry'),
  AgentSelectionEngine: loadABI('AgentSelectionEngine'),
  YieldRegistry:        loadABI('YieldRegistry'),
  YieldVault:           loadABI('YieldVault'),
  IYieldAdapter:        require('../../artifacts/contracts/interfaces/IYieldAdapter.sol/IYieldAdapter.json').abi,
};

// One provider per process — do not create multiple
let _provider = null;
function getProvider() {
  if (!_provider) {
    // cacheTimeout:-1 disables ethers' 250ms request-dedup cache. Agents send
    // back-to-back txs (e.g. scout: updateBestProtocol then completeScoutJob);
    // the cache otherwise serves a stale pending nonce on fast chains → NONCE_EXPIRED.
    _provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
    _provider.on('error', (err) => {
      console.error('[provider] error:', err.message, '— reconnecting');
      _provider = null;
    });
  }
  return _provider;
}

function getWallet(provider) {
  return new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
}

function getContracts(signerOrProvider) {
  return {
    engine:   new ethers.Contract(ADDRESSES.AgentSelectionEngine, ABIS.AgentSelectionEngine, signerOrProvider),
    registry: new ethers.Contract(ADDRESSES.AgentRegistry,        ABIS.AgentRegistry,        signerOrProvider),
    yieldReg: new ethers.Contract(ADDRESSES.YieldRegistry,        ABIS.YieldRegistry,        signerOrProvider),
    vault:    new ethers.Contract(ADDRESSES.YieldVault,           ABIS.YieldVault,            signerOrProvider),
    adapters: {
      AaveAdapter:  new ethers.Contract(ADDRESSES.AaveAdapter,  ABIS.IYieldAdapter, signerOrProvider),
      BenqiAdapter: new ethers.Contract(ADDRESSES.BenqiAdapter, ABIS.IYieldAdapter, signerOrProvider),
      MockPoolA:    new ethers.Contract(ADDRESSES.MockPoolA,    ABIS.IYieldAdapter, signerOrProvider),
      MockPoolB:    new ethers.Contract(ADDRESSES.MockPoolB,    ABIS.IYieldAdapter, signerOrProvider),
    },
  };
}

// Adapter name lookup by lowercase address
const ADAPTER_NAMES = {
  [ADDRESSES.AaveAdapter?.toLowerCase()]:  'AAVE V3',
  [ADDRESSES.BenqiAdapter?.toLowerCase()]: 'Benqi',
  [ADDRESSES.MockPoolA?.toLowerCase()]:    'MockPoolA',
  [ADDRESSES.MockPoolB?.toLowerCase()]:    'MockPoolB',
};

module.exports = { getProvider, getWallet, getContracts, ADDRESSES, ADAPTER_NAMES };
