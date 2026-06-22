import { ethers } from 'ethers'
import { ChainClient } from './ChainClient'
import { Logger } from '../logger/Logger'

const log = new Logger('event-watcher')

export interface JobCompletedEvent {
  jobId: number
  agentWallet: string
  devWallet: string
  amount: number
  agentType: number
  assignedAt: number
  completedAt: number
  txHash: string
  blockNumber: number
}

export interface JobAssignedEvent {
  jobId: number
  jobType: number
  agent: string
  deadline: number
}

type JobCompletedHandler = (event: JobCompletedEvent) => Promise<void>
type JobAssignedHandler = (event: JobAssignedEvent) => Promise<void>

export class EventWatcher {
  private static readonly MAX_LOOKBACK = 45
  private client: ChainClient
  private completedHandlers: JobCompletedHandler[] = []
  private assignedHandlers: JobAssignedHandler[] = []
  private running = false
  private lastBlock = 0
  private pollInterval: ReturnType<typeof setInterval> | null = null

  constructor(client: ChainClient) {
    this.client = client
  }

  onJobCompleted(handler: JobCompletedHandler): void {
    this.completedHandlers.push(handler)
  }

  onJobAssigned(handler: JobAssignedHandler): void {
    this.assignedHandlers.push(handler)
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.lastBlock = await this.client.provider.getBlockNumber()

    this.pollInterval = setInterval(() => this._poll(), 4000)
    log.info('EventWatcher started — polling every 4s for JobCompleted + JobAssigned')
  }

  stop(): void {
    this.running = false
    if (this.pollInterval) clearInterval(this.pollInterval)
    log.info('EventWatcher stopped')
  }

  private async _poll(): Promise<void> {
    try {
      const currentBlock = await this.client.provider.getBlockNumber()
      if (currentBlock <= this.lastBlock) return

      const { engine } = this.client.contracts

      // Public Fuji RPCs reject eth_getLogs windows beyond ~64 blocks. Advancing
      // lastBlock only on success means a transient failure lets the window grow
      // until it permanently exceeds that cap and the watcher wedges. Clamp the
      // window; if we fell behind, skip the gap rather than stall forever.
      let from = this.lastBlock + 1
      if (currentBlock - from > EventWatcher.MAX_LOOKBACK) {
        from = currentBlock - EventWatcher.MAX_LOOKBACK
      }

      const completedFilter = engine.filters.JobCompleted()
      const completedLogs = await engine.queryFilter(completedFilter, from, currentBlock)

      for (const logEntry of completedLogs) {
        await this._handleCompleted(logEntry as ethers.EventLog)
      }

      const assignedFilter = engine.filters.JobAssigned()
      const assignedLogs = await engine.queryFilter(assignedFilter, from, currentBlock)

      for (const logEntry of assignedLogs) {
        await this._handleAssigned(logEntry as ethers.EventLog)
      }

      this.lastBlock = currentBlock
    } catch (err: any) {
      log.warn('Poll error — will retry', { error: err.message })
    }
  }

  private async _handleCompleted(logEntry: ethers.EventLog): Promise<void> {
    try {
      const { engine } = this.client.contracts
      const [jobId, agentWallet, devWallet, payment, agentType] = logEntry.args!

      const job = await engine.jobs(jobId)

      const event: JobCompletedEvent = {
        jobId: Number(jobId),
        agentWallet,
        devWallet,
        amount: Number(payment),
        agentType: Number(agentType),
        assignedAt: Number(job.assignedAt) * 1000,
        completedAt: Date.now(),
        txHash: logEntry.transactionHash,
        blockNumber: logEntry.blockNumber,
      }

      log.info('JobCompleted event received', {
        jobId: event.jobId,
        type: event.agentType === 0 ? 'Scout' : 'Executor',
        agent: event.agentWallet.slice(0, 12) + '...',
        amount: Number(event.amount) / 1e6 + ' USDC',
      })

      for (const handler of this.completedHandlers) {
        await handler(event).catch(err =>
          log.error('JobCompleted handler error', { jobId: event.jobId, error: err.message })
        )
      }
    } catch (err: any) {
      log.error('Error processing JobCompleted event', { error: err.message })
    }
  }

  private async _handleAssigned(logEntry: ethers.EventLog): Promise<void> {
    try {
      const [jobId, jobType, agent, deadline] = logEntry.args!

      const event: JobAssignedEvent = {
        jobId: Number(jobId),
        jobType: Number(jobType),
        agent,
        deadline: Number(deadline),
      }

      log.debug('JobAssigned event', {
        jobId: event.jobId,
        type: event.jobType === 0 ? 'Scout' : 'Executor',
        agent: event.agent.slice(0, 12) + '...',
      })

      for (const handler of this.assignedHandlers) {
        await handler(event).catch(err =>
          log.error('JobAssigned handler error', { jobId: event.jobId, error: err.message })
        )
      }
    } catch (err: any) {
      log.error('Error processing JobAssigned event', { error: err.message })
    }
  }
}
