import * as dotenv from 'dotenv'
dotenv.config()

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional(key: string, defaultVal: string): string {
  return process.env[key] ?? defaultVal
}

export const CONFIG = {
  FUJI_RPC_URL: optional('FUJI_RPC_URL', 'https://api.avax-test.network/ext/bc/C/rpc'),
  CHAIN_ID: 43113,

  ORCHESTRATOR_PRIVATE_KEY: required('ORCHESTRATOR_PRIVATE_KEY'),

  GROQ_API_KEY: required('GROQ_API_KEY'),
  GROQ_BASE_URL: optional('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
  LLM_MODEL: optional('LLM_MODEL', 'llama-3.1-8b-instant'),
  LLM_MAX_TOKENS: parseInt(optional('LLM_MAX_TOKENS', '1000')),

  ADDRESSES: {
    AgentSelectionEngine: required('CONTRACT_AGENT_SELECTION_ENGINE'),
    AgentRegistry: required('CONTRACT_AGENT_REGISTRY'),
    YieldRegistry: required('CONTRACT_YIELD_REGISTRY'),
    YieldVault: required('CONTRACT_YIELD_VAULT'),
    FeePool: required('CONTRACT_FEE_POOL'),
    PaymentLedger: required('CONTRACT_PAYMENT_LEDGER'),
    USDC: optional('CONTRACT_USDC', '0x3E937B4881CBd500d05EeDAB7BA203f2b7B3f74f'),
  },

  MIN_POOL_RESERVE: parseInt(optional('MIN_POOL_RESERVE', '10000000')),
  MAX_PAYMENT_USDC: parseInt(optional('MAX_PAYMENT_USDC', '100000')),
  PAYMENT_RETRY_MAX: parseInt(optional('PAYMENT_RETRY_MAX', '3')),

  ALERT_WEBHOOK_URL: optional('ALERT_WEBHOOK_URL', ''),

  // Dynamic payment scaling
  OPTIMAL_POOL_BALANCE: parseInt(optional('OPTIMAL_POOL_BALANCE', '100000000')),  // 100 USDC
  MIN_HEALTH_FACTOR: parseFloat(optional('MIN_HEALTH_FACTOR', '0.10')),
  MIN_PAYMENT_USDC: parseInt(optional('MIN_PAYMENT_USDC', '10000')),              // 0.01 USDC

  RECEIPT_VERSION: '1.0',
  RECEIPT_TIMEOUT_MS: parseInt(optional('RECEIPT_TIMEOUT_MS', '10000')),

  PORT: parseInt(optional('PORT', '5000')),

  // wallet→URL map overriding on-chain endpoints for local agent servers
  AGENT_ENDPOINT_OVERRIDES: parseEndpointOverrides(optional('AGENT_ENDPOINT_OVERRIDES', '')),
} as const

function parseEndpointOverrides(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    const result: Record<string, string> = {}
    for (const [wallet, url] of Object.entries(parsed)) {
      result[wallet.toLowerCase()] = url as string
    }
    return result
  } catch {
    return {}
  }
}
