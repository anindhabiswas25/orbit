// @orbit/core — shared logic for the Orbit CLI and SDK.
// Both packages import from this barrel. Never duplicate logic across packages.

// Types
export * from './types'
export type { AgentProfile, CredentialFile } from './credentials/types'

// Errors
export { UserError, ChainError, FatalError } from './errors'

// Credentials
export { Encryptor } from './credentials/Encryptor'
export { CredentialManager } from './credentials/CredentialManager'

// Chain
export { ChainClient } from './chain/ChainClient'
export { ContractLoader } from './chain/ContractLoader'
export type { OrbitContracts } from './chain/ContractLoader'
export {
  FUJI_ADDRESSES,
  FUJI_RPC_URL,
  FUJI_CHAIN_ID,
  FUJI_EXPLORER,
  FUJI_FAUCET_AVAX,
  FUJI_FAUCET_USDC,
  ADAPTER_NAMES,
} from './chain/FujiAddresses'

// Registration
export { PreflightCheck } from './registration/PreflightCheck'
export type { PreflightResult } from './registration/PreflightCheck'
export { Registrar } from './registration/Registrar'
export type { RegisterParams, RegisterResult, ImportResult } from './registration/Registrar'

// Agent runtime
export { AgentRunner } from './agent/AgentRunner'
export type { RunnerState } from './agent/AgentRunner'
export { ScoutLoop } from './agent/ScoutLoop'
export { ExecutorLoop } from './agent/ExecutorLoop'
export { JobTracker } from './agent/JobTracker'

// Utils
export { withRetry } from './utils/retry'
export type { RetryOptions } from './utils/retry'

// Env (.env writer — keeps run-4-agents.js in sync with registrations)
export { syncAgentToEnv, resolveEnvPath, readEnvValue } from './env/EnvWriter'
export type { EnvAgentSlot, EnvWriteResult } from './env/EnvWriter'
