// Minimal human-readable ABIs bundled with the package. ethers v6 parses these
// directly — no JSON artifact copy step required. Only the fragments the CLI/SDK
// actually use are included. These match the live Orbit Fuji contracts.

export const AGENT_REGISTRY_ABI = [
  'function register(uint8 agentType, string endpoint, uint256 fee, address developerWallet)',
  'function deregister()',
  'function getAgent(address wallet) view returns (tuple(address wallet, address developerWallet, uint8 agentType, uint8 status, string endpoint, uint256 fee, uint256 stake, int256 reputationScore, uint256 jobsCompleted, uint256 jobsFailed, uint256 registeredAt, uint256 registeredBlock))',
  'function isEligible(address wallet) view returns (bool)',
  'function MIN_STAKE() view returns (uint256)',
  'event AgentRegistered(address indexed wallet, uint8 agentType, uint256 fee, uint256 stake)',
  'event AgentDeregistered(address indexed wallet, uint256 stakeReturned)',
  'event ReputationChanged(address indexed wallet, int256 oldScore, int256 newScore, string reason)',
]

export const AGENT_SELECTION_ENGINE_ABI = [
  'function nextJobId() view returns (uint256)',
  'function jobs(uint256) view returns (uint256 jobId, uint8 jobType, address assignedAgent, uint256 assignedAt, uint256 deadline, uint8 status)',
  'function getJob(uint256 jobId) view returns (tuple(uint256 jobId, uint8 jobType, address assignedAgent, uint256 assignedAt, uint256 deadline, uint8 status))',
  'function getAgentActiveJob(address wallet) view returns (uint256)',
  'function completeScoutJob(uint256 jobId)',
  'function completeExecutorJob(uint256 jobId, address newAdapter)',
  'function completeExecutorJobNoOp(uint256 jobId)',
  'event JobAssigned(uint256 indexed jobId, uint8 jobType, address indexed agent, uint256 deadline)',
  'event JobCompleted(uint256 indexed jobId, address indexed agentWallet, address indexed devWallet, uint256 payment, uint8 agentType)',
  'event JobExpired(uint256 indexed jobId, address indexed timedOutAgent)',
  'event JobFailed(uint256 indexed jobId, address indexed agent, string reason)',
]

export const YIELD_REGISTRY_ABI = [
  'function bestProtocol() view returns (address)',
  'function bestAPY() view returns (uint256)',
  'function activeProtocol() view returns (address)',
  'function activeAPY() view returns (uint256)',
  'function lastUpdated() view returns (uint256)',
  'function authorizedAgents(address) view returns (bool)',
  'function owner() view returns (address)',
  'function authorizeAgent(address agent)',
  'function isAdapter(address) view returns (bool)',
  'function updateBestProtocol(address protocol, uint256 apy)',
  'function logRebalance(address fromProtocol, address toProtocol, uint256 fromAPY, uint256 toAPY, uint256 amount)',
  'event BestYieldUpdated(address protocol, uint256 apy, uint256 timestamp, address scout)',
]

export const YIELD_VAULT_ABI = [
  'function getVaultBalance() view returns (uint256)',
  'function getCurrentAdapter() view returns (address)',
  'function rebalance(address newAdapter)',
  'event Rebalanced(address fromAdapter, address toAdapter, uint256 amount)',
]

export const YIELD_ADAPTER_ABI = [
  'function getAPY() view returns (uint256)',
  'function getBalance() view returns (uint256)',
  'function protocolName() view returns (string)',
]

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]
