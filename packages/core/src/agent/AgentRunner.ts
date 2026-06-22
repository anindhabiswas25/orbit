import { EventEmitter } from 'events'
import { ChainClient } from '../chain/ChainClient'
import { ScoutLoop } from './ScoutLoop'
import { ExecutorLoop } from './ExecutorLoop'
import { JobTracker } from './JobTracker'
import { AgentRunCallbacks, AgentType } from '../types'

export type RunnerState = 'idle' | 'running' | 'paused' | 'stopped'

function ts(): string {
  return new Date().toLocaleTimeString()
}

/**
 * AgentRunner — the core agent loop engine.
 *
 * Single implementation of agent behaviour shared by the CLI (which wraps it in a
 * dashboard) and the SDK (which exposes it via callbacks). It contains NO terminal
 * UI logic.
 *
 * Lifecycle: new AgentRunner(client, type) → start(callbacks) → stop()
 *
 * Flow:
 *   1. JobTracker polls engine.JobAssigned (poll-based — Fuji RPC drops filters)
 *   2. Events are filtered to this wallet + this agent type
 *   3. Dispatches to ScoutLoop or ExecutorLoop
 *   4. Emits typed events via callbacks
 */
export class AgentRunner extends EventEmitter {
  private client: ChainClient
  private agentType: AgentType
  private state: RunnerState = 'idle'
  private tracker: JobTracker

  constructor(client: ChainClient, agentType: AgentType) {
    super()
    this.client = client
    this.agentType = agentType
    this.tracker = new JobTracker(client)
  }

  get currentState(): RunnerState {
    return this.state
  }

  get walletAddress(): string {
    return this.client.wallet.address
  }

  /**
   * Start the agent loop. Returns once the poller is attached; jobs are processed
   * asynchronously as they arrive.
   */
  async start(callbacks: AgentRunCallbacks): Promise<void> {
    if (this.state === 'running') throw new Error('Agent is already running')

    await this.client.verifyNetwork()
    this.state = 'running'

    const onJob = async (
      jobId: bigint,
      jobType: bigint,
      _assignedAgent: string,
      deadline: bigint
    ) => {
      if (this.state !== 'running') return

      const id = Number(jobId)
      const type = Number(jobType) === 0 ? 'Scout' : 'Executor'
      const deadlineDate = new Date(Number(deadline) * 1000)
      const remainingMs = deadlineDate.getTime() - Date.now()

      // Only process jobs matching our agent type.
      const isMyType =
        (this.agentType === 'scout' && type === 'Scout') ||
        (this.agentType === 'executor' && type === 'Executor')
      if (!isMyType) return

      callbacks.onJobAssigned?.({ jobId: id, type, deadline: deadlineDate })
      callbacks.onLog?.(
        `[${ts()}] Job #${id} assigned — ${Math.floor(remainingMs / 1000)}s remaining`
      )

      if (remainingMs < 15_000) {
        callbacks.onLog?.(`[${ts()}] Job #${id} deadline too close, skipping`)
        callbacks.onJobExpired?.({ jobId: id, type })
        return
      }

      try {
        if (type === 'Scout') {
          await ScoutLoop.execute(id, this.client, callbacks)
        } else {
          await ExecutorLoop.execute(id, this.client, callbacks)
        }
      } catch (err: any) {
        callbacks.onError?.({ error: err, jobId: id, fatal: false })
        callbacks.onLog?.(`[${ts()}] Job #${id} failed: ${err.message}`)
      }
    }

    await this.tracker.start(onJob, (err) => {
      callbacks.onLog?.(`[${ts()}] Watcher error (retrying): ${err.message}`)
    })
  }

  pause(): void {
    if (this.state === 'running') this.state = 'paused'
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'running'
  }

  stop(): void {
    this.state = 'stopped'
    this.tracker.stop()
    this.emit('stopped')
  }
}
