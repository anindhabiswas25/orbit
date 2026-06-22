import {
  AgentRunner,
  ChainClient,
  Registrar,
  CredentialManager,
  ADAPTER_NAMES,
  type AgentProfile,
  type AgentRunCallbacks,
  type AgentInfo,
  type AgentType,
  type VaultStatus,
  type JobRecord,
  type JobType,
  type JobStatus,
  type EarningsSummary,
  type Protocol,
} from '@orbit/core'
import { AgentHandle } from './AgentHandle'

const TYPE_MAP: Record<number, AgentType> = { 0: 'scout', 1: 'executor' }
const STATUS_MAP: Record<number, AgentInfo['status']> = {
  0: 'active',
  1: 'paused',
  2: 'deregistered',
  3: 'banned',
}
const JOB_STATUS: Record<number, JobStatus> = {
  0: 'Pending',
  1: 'Completed',
  2: 'Failed',
  3: 'Expired',
}
const JOB_TYPE: Record<number, JobType> = { 0: 'Scout', 1: 'Executor' }

/**
 * AgentClient — per-agent interface for SDK users. Obtained via OrbitSDK.setup()
 * or OrbitSDK.load().
 */
export class AgentClient {
  constructor(
    private profile: AgentProfile,
    private client: ChainClient
  ) {}

  get wallet(): string {
    return this.profile.wallet
  }
  get name(): string {
    return this.profile.name
  }
  get type(): AgentType {
    return this.profile.type
  }

  /**
   * Start the agent loop. Returns immediately with an AgentHandle. The loop runs
   * in the background via the job watcher; call handle.stop() to stop cleanly.
   */
  async run(callbacks: AgentRunCallbacks = {}): Promise<AgentHandle> {
    const runner = new AgentRunner(this.client, this.profile.type)
    await runner.start(callbacks)
    return new AgentHandle(runner, this.client, this.profile)
  }

  /**
   * For scouts: whether this agent is authorized in YieldRegistry to post APY
   * results. A scout that is registered but not authorized cannot scout. Always
   * true-by-convention for executors (they don't post APYs).
   */
  async isScoutAuthorized(): Promise<boolean> {
    if (this.profile.type !== 'scout') return true
    return Registrar.isScoutAuthorized(this.client, this.profile.wallet)
  }

  /** Current on-chain agent status (live read). */
  async getStatus(): Promise<AgentInfo> {
    const raw = await this.client.contracts.registry.getAgent(this.profile.wallet)
    if (!raw.wallet || raw.wallet === '0x0000000000000000000000000000000000000000') {
      throw new Error('Agent not found on-chain. Was it registered?')
    }
    const fee = Number(raw.fee)
    return {
      wallet: raw.wallet,
      developerWallet: raw.developerWallet,
      type: TYPE_MAP[Number(raw.agentType)]!,
      status: STATUS_MAP[Number(raw.status)]!,
      endpoint: raw.endpoint,
      fee,
      feeFormatted: `${(fee / 100).toFixed(2)}% per job`,
      stake: Number(raw.stake) / 1e6,
      reputation: Number(raw.reputationScore),
      jobsCompleted: Number(raw.jobsCompleted),
      jobsFailed: Number(raw.jobsFailed),
      registeredAt: new Date(Number(raw.registeredAt) * 1000),
    }
  }

  /** Current vault status (balance, active protocol, APYs). */
  async getVaultStatus(): Promise<VaultStatus> {
    const [balance, active, activeAPY, best, bestAPY] = await Promise.all([
      this.client.contracts.vault.getVaultBalance().catch(() => 0n),
      this.client.contracts.yieldReg.activeProtocol(),
      this.client.contracts.yieldReg.activeAPY(),
      this.client.contracts.yieldReg.bestProtocol(),
      this.client.contracts.yieldReg.bestAPY(),
    ])
    return {
      balance: Number(balance) / 1e6,
      currentProtocol: active,
      currentProtocolName: ADAPTER_NAMES[(active as string)?.toLowerCase()] ?? 'None',
      currentAPY: Number(activeAPY),
      currentAPYFormatted: `${(Number(activeAPY) / 100).toFixed(2)}%`,
      bestProtocol: best,
      bestProtocolName: ADAPTER_NAMES[(best as string)?.toLowerCase()] ?? 'None',
      bestAPY: Number(bestAPY),
      bestAPYFormatted: `${(Number(bestAPY) / 100).toFixed(2)}%`,
      lastScoutAt: null,
    }
  }

  /** Recent jobs for this agent wallet from on-chain data. */
  async getRecentJobs(limit = 20): Promise<JobRecord[]> {
    const nextId = Number(await this.client.contracts.engine.nextJobId())
    const jobs: JobRecord[] = []
    for (let id = nextId; id >= Math.max(1, nextId - limit + 1); id--) {
      try {
        const j = await this.client.contracts.engine.jobs(id)
        if ((j.assignedAgent as string).toLowerCase() === this.profile.wallet.toLowerCase()) {
          jobs.push({
            jobId: Number(j.jobId),
            type: JOB_TYPE[Number(j.jobType)]!,
            agent: j.assignedAgent,
            assignedAt: new Date(Number(j.assignedAt) * 1000),
            deadline: new Date(Number(j.deadline) * 1000),
            status: JOB_STATUS[Number(j.status)]!,
          })
        }
      } catch {
        /* skip */
      }
    }
    return jobs
  }

  /**
   * Earnings estimate based on on-chain job count and fee rate. For exact numbers,
   * query FeePool.AgentPaid events directly.
   */
  async getEarnings(): Promise<EarningsSummary> {
    const [agentRaw, vaultBal] = await Promise.all([
      this.client.contracts.registry.getAgent(this.profile.wallet),
      this.client.contracts.vault.getVaultBalance().catch(() => 0n),
    ])
    const jobsDone = Number(agentRaw.jobsCompleted)
    const fee = Number(agentRaw.fee)
    const perJob = (Number(vaultBal) / 1e6) * (fee / 10_000)
    return {
      today: 0,
      week: 0,
      total: perJob * jobsDone,
      perJob,
      jobCount: jobsDone,
    }
  }

  /** All protocol APYs (live reads from adapters), sorted high → low. */
  async getProtocols(): Promise<Protocol[]> {
    const { adapters, yieldReg } = this.client.contracts
    const active = ((await yieldReg.activeProtocol()) as string).toLowerCase()
    const entries = [
      { name: 'AAVE V3', contract: adapters.aave },
      { name: 'Benqi', contract: adapters.benqi },
      { name: 'MockPoolA', contract: adapters.mockA },
      { name: 'MockPoolB', contract: adapters.mockB },
    ]
    const results: Protocol[] = await Promise.all(
      entries.map(async (e) => {
        const apy = Number(await e.contract.getAPY().catch(() => 0))
        const address = await e.contract.getAddress()
        return {
          name: e.name,
          address,
          apy,
          apyFormatted: `${(apy / 100).toFixed(2)}%`,
          isActive: address.toLowerCase() === active,
        }
      })
    )
    results.sort((a, b) => b.apy - a.apy)
    return results
  }

  /**
   * Deregister the agent on-chain. Reclaims stake if reputation >= 0. Optionally
   * removes the profile from ~/.orbit/credentials.json.
   */
  async deregister(
    removeCredentials = true,
    onStep?: (step: 'deregistering' | 'done', txHash?: string) => void
  ): Promise<string> {
    const txHash = await Registrar.deregister(this.client, onStep)
    if (removeCredentials) CredentialManager.removeProfile(this.profile.name)
    return txHash
  }
}
