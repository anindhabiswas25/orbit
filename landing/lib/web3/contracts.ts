// Deployed Orbit Protocol contract addresses on Avalanche Fuji (chainId 43113).
// Mirrors /deployed-addresses.json — kept inline so the landing app stays
// self-contained (the JSON lives outside this Next project's tsconfig root).

export const ADDRESSES = {
  FeePool: '0xF9Dd4c012a5115d4338F7CEe541b20C584c95Fbe',
  AgentRegistry: '0xd9F743a8b21565Aa3fD9832B04f3819F8e49E657',
  YieldRegistry: '0x495fD47b66c11aD6196755B5b771e78861Dc6E1E',
  AgentSelectionEngine: '0x249b300B0DcbfcA286A396AADAC4D6718d6e56e7',
  YieldVault: '0x9E2F531AAD7664cf71de4F39D44A9Ac6F59B7583',
  AaveAdapter: '0x7D9F7C5AE1a824B7c0947C2Ce30DFF8D5c28D034',
  BenqiAdapter: '0x5862D15D15d9BBf6ACb16DEE58a1a52cf023A941',
  MockPoolA: '0x3C771A690fE6026f3b3367c73964dc0642D387F0',
  MockPoolB: '0x1874Af2bF8BE0A327753EAd477B91e1F37CD1c45',
  PaymentLedger: '0x1f297319D2B91BEd549Eef7a069f22fD5b364D5A',
  USDC: '0x5425890298aed601595a70AB815c96711a31Bc65',
} as const

export const USDC_DECIMALS = 6

export const VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getUserShares',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getUserBalance',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getVaultBalance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const USDC_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'activeProtocol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'activeAPY',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bestProtocol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'bestAPY',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// PaymentLedger — permanent on-chain record of every agent payout settlement.
// Used by the developer Earnings page to show real payouts + their tx hashes.
export const PAYMENT_LEDGER_ABI = [
  {
    type: 'function',
    name: 'getTotalEarnedBy',
    stateMutability: 'view',
    inputs: [{ name: 'devWallet', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTotalSettled',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getSettledJobIds',
    stateMutability: 'view',
    inputs: [
      { name: 'from', type: 'uint256' },
      { name: 'count', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getSettlement',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'jobId', type: 'uint256' },
          { name: 'agentWallet', type: 'address' },
          { name: 'devWallet', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'paymentTxHash', type: 'bytes32' },
          { name: 'settledAt', type: 'uint256' },
          { name: 'llmReasoning', type: 'string' },
          { name: 'agentType', type: 'uint8' },
        ],
      },
    ],
  },
] as const

// AgentRegistry — open on-chain registry. Used by the Build page to register
// an agent in-browser (Executors approve MIN_STAKE USDC first).
export const AGENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentType', type: 'uint8' }, // 0 = Scout, 1 = Executor
      { name: 'endpoint', type: 'string' },
      { name: 'fee', type: 'uint256' }, // basis points, <= 500
      { name: 'developerWallet', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deregister',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'MIN_STAKE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getAgent',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'wallet', type: 'address' },
          { name: 'developerWallet', type: 'address' },
          { name: 'agentType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'endpoint', type: 'string' },
          { name: 'fee', type: 'uint256' },
          { name: 'stake', type: 'uint256' },
          { name: 'reputationScore', type: 'int256' },
          { name: 'jobsCompleted', type: 'uint256' },
          { name: 'jobsFailed', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'registeredBlock', type: 'uint256' },
        ],
      },
    ],
  },
] as const
