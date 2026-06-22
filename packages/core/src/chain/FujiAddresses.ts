// Bundled contract addresses — updated at publish time by the Orbit team.
// CLI/SDK developers never hardcode addresses elsewhere. Always import from here.
// If addresses change (contract upgrade), only this file and the ABIs change.
//
// Values mirror the live Fuji deployment in /deployed-addresses.json. Each can be
// overridden via environment variable for custom / local deployments.

export const FUJI_ADDRESSES = {
  // Orbit Protocol Contracts (live Fuji deployment — 2026-06-20)
  FeePool: process.env.ORBIT_FEE_POOL || '0xF9Dd4c012a5115d4338F7CEe541b20C584c95Fbe',
  AgentRegistry: process.env.ORBIT_AGENT_REGISTRY || '0xd9F743a8b21565Aa3fD9832B04f3819F8e49E657',
  AgentSelectionEngine:
    process.env.ORBIT_SELECTION_ENGINE || '0x249b300B0DcbfcA286A396AADAC4D6718d6e56e7',
  YieldRegistry: process.env.ORBIT_YIELD_REGISTRY || '0x495fD47b66c11aD6196755B5b771e78861Dc6E1E',
  YieldVault: process.env.ORBIT_YIELD_VAULT || '0x9E2F531AAD7664cf71de4F39D44A9Ac6F59B7583',
  AaveAdapter: process.env.ORBIT_AAVE_ADAPTER || '0x7D9F7C5AE1a824B7c0947C2Ce30DFF8D5c28D034',
  BenqiAdapter: process.env.ORBIT_BENQI_ADAPTER || '0x5862D15D15d9BBf6ACb16DEE58a1a52cf023A941',
  MockPoolA: process.env.ORBIT_MOCK_POOL_A || '0x3C771A690fE6026f3b3367c73964dc0642D387F0',
  MockPoolB: process.env.ORBIT_MOCK_POOL_B || '0x1874Af2bF8BE0A327753EAd477B91e1F37CD1c45',
  PaymentLedger: process.env.ORBIT_PAYMENT_LEDGER || '0x1f297319D2B91BEd549Eef7a069f22fD5b364D5A',

  // External Fuji token (Circle USDC on Fuji)
  USDC: process.env.ORBIT_USDC || '0x5425890298aed601595a70AB815c96711a31Bc65',
} as const

// publicnode is reliable; the default api.avax-test.network endpoint is heavily
// rate-limited (HTTP 429 / Cloudflare 1015), which made balance reads fail.
export const FUJI_RPC_URL =
  process.env.FUJI_RPC_URL || 'https://avalanche-fuji-c-chain-rpc.publicnode.com'
export const FUJI_CHAIN_ID = 43113
export const FUJI_EXPLORER = 'https://testnet.snowtrace.io'
export const FUJI_FAUCET_AVAX = 'https://faucet.avax.network/'
export const FUJI_FAUCET_USDC = 'https://faucet.circle.com/'

export const ADAPTER_NAMES: Record<string, string> = {
  [FUJI_ADDRESSES.AaveAdapter.toLowerCase()]: 'AAVE V3',
  [FUJI_ADDRESSES.BenqiAdapter.toLowerCase()]: 'Benqi',
  [FUJI_ADDRESSES.MockPoolA.toLowerCase()]: 'MockPoolA',
  [FUJI_ADDRESSES.MockPoolB.toLowerCase()]: 'MockPoolB',
}
