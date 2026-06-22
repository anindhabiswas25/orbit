// Backend feed wrapper — mirrors frontend/lib/api.ts.
// Personal positions are read on-chain via wagmi; these routes power the
// agent / job / event feeds on the Tracking page.

export interface VaultStatus {
  vaultBalance: number
  currentProtocol: string
  currentProtocolName: string
  currentAPY: number
  currentAPYFormatted: string
  bestProtocol: string
  bestProtocolName: string
  bestAPY: number
  bestAPYFormatted: string
  lastScoutAt: number
}

export interface Protocol {
  name: string
  address: string
  apy: number
  apyFormatted: string
  isActive: boolean
  error: boolean
}

export interface Agent {
  wallet: string
  developerWallet: string
  type: 'Scout' | 'Executor'
  status: 'Active' | 'Paused' | 'Deregistered' | 'Banned'
  endpoint: string
  fee: number
  feeFormatted: string
  stake: number
  reputation: number
  jobsCompleted: number
  jobsFailed: number
  registeredAt: number
}

export interface Job {
  jobId: number
  type: 'Scout' | 'Executor'
  agent: string
  assignedAt: number
  deadline: number
  status: 'Pending' | 'Completed' | 'Failed' | 'Expired'
  assignedTx: string | null
  resultTx: string | null
}

export interface RebalanceEvent {
  fromProtocol?: string
  toProtocol?: string
  fromName: string
  toName: string
  fromAPY: number
  toAPY: number
  fromFormatted: string
  toFormatted: string
  amount: number
  timestamp: number
  executorAgent: string
  gain: number
  gainFormatted: string
  txHash: string | null
}

export interface Meta {
  chainId: number
  network: string
  explorerBase: string
  contracts: Record<string, string>
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export const api = {
  status: () => get<VaultStatus>('/api/status'),
  protocols: () => get<Protocol[]>('/api/protocols'),
  agents: (type?: string) =>
    get<Agent[]>(`/api/agents${type ? `?type=${type}` : ''}`),
  jobs: (limit = 20) => get<Job[]>(`/api/jobs?limit=${limit}`),
  events: (limit = 20) => get<RebalanceEvent[]>(`/api/events?limit=${limit}`),
  meta: () => get<Meta>('/api/meta'),
}
