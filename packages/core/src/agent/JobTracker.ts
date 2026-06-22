import { ethers } from 'ethers'
import { ChainClient } from '../chain/ChainClient'

const POLL_INTERVAL_MS = 4000

export type JobHandler = (
  jobId: bigint,
  jobType: bigint,
  assignedAgent: string,
  deadline: bigint
) => void

/**
 * JobTracker — poll-based watcher for JobAssigned events.
 *
 * Fuji's public RPC drops event filters frequently, so we poll eth_getLogs for
 * JobAssigned rather than relying on engine.on('JobAssigned', ...). Jobs are
 * deduped so a reconnect / overlapping window never double-processes a job.
 */
export class JobTracker {
  private processed = new Set<number>()
  private polling = false
  private fromBlock: number | 'latest' = 'latest'

  constructor(private client: ChainClient) {}

  hasProcessed(jobId: number): boolean {
    return this.processed.has(jobId)
  }

  markProcessed(jobId: number): void {
    this.processed.add(jobId)
  }

  /** Start polling. Returns immediately; polling runs in the background. */
  async start(onJob: JobHandler, onError?: (err: Error) => void): Promise<void> {
    const engine = this.client.contracts.engine
    const provider = this.client.provider
    const myAddress = this.client.wallet.address.toLowerCase()
    const topic = engine.interface.getEvent('JobAssigned')!.topicHash
    const engineAddress = await engine.getAddress()

    try {
      const bn = await provider.getBlockNumber()
      this.fromBlock = Math.max(0, bn - 5)
    } catch {
      this.fromBlock = 'latest'
    }

    this.polling = true
    void this.loop(provider, engine, engineAddress, topic, myAddress, onJob, onError)
  }

  private async loop(
    provider: ethers.JsonRpcProvider,
    engine: ethers.Contract,
    engineAddress: string,
    topic: string,
    myAddress: string,
    onJob: JobHandler,
    onError?: (err: Error) => void
  ): Promise<void> {
    while (this.polling) {
      try {
        const currentBlock = await provider.getBlockNumber()
        const logs = await provider.getLogs({
          address: engineAddress,
          topics: [topic],
          fromBlock: this.fromBlock,
          toBlock: currentBlock,
        })

        for (const log of logs) {
          const parsed = engine.interface.parseLog(log)
          if (!parsed) continue

          const jobId = parsed.args[0] as bigint
          const jobType = parsed.args[1] as bigint
          const assignedAgent = parsed.args[2] as string
          const deadline = parsed.args[3] as bigint
          const jobIdNum = Number(jobId)

          if (this.processed.has(jobIdNum)) continue
          if (assignedAgent.toLowerCase() !== myAddress) continue

          this.processed.add(jobIdNum)
          onJob(jobId, jobType, assignedAgent, deadline)
        }

        this.fromBlock = currentBlock + 1
      } catch (err: any) {
        // Non-fatal — surface for logging but keep polling on the next tick.
        onError?.(err instanceof Error ? err : new Error(String(err)))
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
  }

  stop(): void {
    this.polling = false
  }
}
