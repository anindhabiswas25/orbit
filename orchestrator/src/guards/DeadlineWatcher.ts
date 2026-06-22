import { ChainClient } from '../chain/ChainClient'
import { Logger } from '../logger/Logger'

const log = new Logger('deadline-watcher')

export class DeadlineWatcher {
  private interval: ReturnType<typeof setInterval> | null = null
  private trackedJobs: Map<number, number> = new Map()

  constructor(private client: ChainClient) {}

  trackJob(jobId: number, deadline: number): void {
    this.trackedJobs.set(jobId, deadline)
  }

  start(): void {
    this.interval = setInterval(() => this._check(), 30_000)
    log.info('DeadlineWatcher started — checking every 30s')
    // Self-heal: agents that were killed mid-job leave their on-chain
    // agentActiveJob slot locked on a Pending job past its deadline, which makes
    // them ineligible for all future assignments (engine._assignJob skips busy
    // agents) until someone calls expireJob. Jobs assigned before this process
    // started aren't in trackedJobs, so sweep them once on startup.
    this.sweepStuckJobs().catch((err) =>
      log.warn('Startup stuck-job sweep failed', { error: err.message }),
    )
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    log.info('DeadlineWatcher stopped')
  }

  /** Expire any Pending-but-past-deadline job currently locking a registered
   *  agent's active-job slot. Frees the agent for new assignments. */
  async sweepStuckJobs(): Promise<void> {
    const { engine, registry } = this.client.contracts
    let wallets: string[] = []
    try {
      const [scouts, executors] = await Promise.all([
        registry.getAllScouts(),
        registry.getAllExecutors(),
      ])
      wallets = [...scouts, ...executors]
    } catch (err: any) {
      log.warn('Could not enumerate agents for stuck-job sweep', { error: err.message })
      return
    }

    const now = Math.floor(Date.now() / 1000)
    let freed = 0
    for (const wallet of wallets) {
      try {
        const jobId = Number(await engine.agentActiveJob(wallet))
        if (jobId === 0) continue
        const job = await engine.jobs(jobId)
        if (Number(job.status) === 0 && now > Number(job.deadline)) {
          log.info(`Sweeping stuck job #${jobId}`, { agent: wallet.slice(0, 12) + '...' })
          const tx = await engine.expireJob(jobId)
          await tx.wait()
          freed++
        }
      } catch (err: any) {
        log.warn(`Stuck-job sweep failed for ${wallet.slice(0, 12)}...`, { error: err.message })
      }
    }
    log.info(`Stuck-job sweep complete — freed ${freed} agent slot(s)`)
  }

  private async _check(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)

    for (const [jobId, deadline] of this.trackedJobs) {
      if (now > deadline) {
        try {
          const job = await this.client.contracts.engine.jobs(jobId)
          if (Number(job.status) === 0) {
            log.info(`Job #${jobId} expired — calling expireJob()`)
            const tx = await this.client.contracts.engine.expireJob(jobId)
            await tx.wait()
            log.info(`Job #${jobId} expired successfully`)
          }
          this.trackedJobs.delete(jobId)
        } catch (err: any) {
          log.warn(`Failed to expire job #${jobId}`, { error: err.message })
          this.trackedJobs.delete(jobId)
        }
      }
    }
  }
}
