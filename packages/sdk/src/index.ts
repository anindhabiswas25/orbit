// The only module SDK users import from. Never export internal implementation.

export { OrbitSDK } from './OrbitSDK'
export type { SetupOptions, SetupStep, ImportOptions } from './OrbitSDK'
export { AgentClient } from './AgentClient'
export { AgentHandle } from './AgentHandle'

// Public types re-exported from core.
export type {
  AgentType,
  AgentStatus,
  AgentInfo,
  JobRecord,
  JobType,
  JobStatus,
  Protocol,
  RebalanceEvent,
  VaultStatus,
  EarningsSummary,
  AgentRunCallbacks,
  JobAssignedEvent,
  JobCompletedEvent,
  JobExpiredEvent,
  ReputationEvent,
  AgentErrorEvent,
} from '@orbit/core'

export { UserError, ChainError, FatalError } from '@orbit/core'
