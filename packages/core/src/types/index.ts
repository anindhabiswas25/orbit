// All shared TypeScript types.
// Both CLI and SDK import from here (via the @orbit/core barrel). Never duplicate
// these across packages.

export type AgentType = 'scout' | 'executor'
export type AgentStatus = 'active' | 'paused' | 'deregistered' | 'banned'
export type JobType = 'Scout' | 'Executor'
export type JobStatus = 'Pending' | 'Completed' | 'Failed' | 'Expired'

export interface AgentInfo {
  wallet: string
  developerWallet: string
  type: AgentType
  status: AgentStatus
  endpoint: string
  fee: number // basis points
  feeFormatted: string // "0.50% per job"
  stake: number // USDC (human)
  reputation: number
  jobsCompleted: number
  jobsFailed: number
  registeredAt: Date
}

export interface JobRecord {
  jobId: number
  type: JobType
  agent: string
  assignedAt: Date
  deadline: Date
  status: JobStatus
  elapsedMs?: number // set when Completed
  payment?: number // USDC earned (set when Completed)
}

export interface Protocol {
  name: string
  address: string
  apy: number // basis points
  apyFormatted: string // "6.20%"
  isActive: boolean
}

export interface RebalanceEvent {
  fromProtocol: string
  fromName: string
  toProtocol: string
  toName: string
  fromAPY: number
  toAPY: number
  gain: number
  gainFormatted: string // "+11.80%"
  amount: number // USDC
  timestamp: Date
  executorAgent: string
}

export interface VaultStatus {
  balance: number // USDC
  currentProtocol: string
  currentProtocolName: string
  currentAPY: number
  currentAPYFormatted: string
  bestProtocol: string
  bestProtocolName: string
  bestAPY: number
  bestAPYFormatted: string
  lastScoutAt: Date | null
}

export interface EarningsSummary {
  today: number // USDC
  week: number
  total: number
  perJob: number // average
  jobCount: number
}

// Events emitted by AgentRunner
export interface JobAssignedEvent {
  jobId: number
  type: JobType
  deadline: Date
}
export interface JobCompletedEvent {
  jobId: number
  type: JobType
  payment: number
  elapsedMs: number
}
export interface JobExpiredEvent {
  jobId: number
  type: JobType
}
export interface ReputationEvent {
  oldScore: number
  newScore: number
  reason: string
}
export interface AgentErrorEvent {
  error: Error
  jobId?: number
  fatal: boolean
}

export interface AgentRunCallbacks {
  onJobAssigned?: (ev: JobAssignedEvent) => void
  onJobCompleted?: (ev: JobCompletedEvent) => void
  onJobExpired?: (ev: JobExpiredEvent) => void
  onRebalance?: (ev: RebalanceEvent) => void
  onReputation?: (ev: ReputationEvent) => void
  onError?: (ev: AgentErrorEvent) => void
  onLog?: (msg: string) => void
}
