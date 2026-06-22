import {
  AgentRunner,
  ChainClient,
  type AgentProfile,
  type AgentInfo,
  type AgentType,
} from '@orbit/core'

const TYPE_MAP: Record<number, AgentType> = { 0: 'scout', 1: 'executor' }
const STATUS_MAP: Record<number, AgentInfo['status']> = {
  0: 'active',
  1: 'paused',
  2: 'deregistered',
  3: 'banned',
}

/**
 * AgentHandle — returned by AgentClient.run(). Represents a running agent
 * instance: stop / pause / resume it, or read live on-chain status while running.
 *
 * @example
 *   const handle = await agent.run({ onJobCompleted: (e) => console.log(e.payment) })
 *   const status = await handle.getStatus()
 *   await handle.stop()
 */
export class AgentHandle {
  constructor(
    private runner: AgentRunner,
    private client: ChainClient,
    private profile: AgentProfile
  ) {}

  /** True if the agent loop is currently processing jobs. */
  get isRunning(): boolean {
    return this.runner.currentState === 'running'
  }

  /** Pause the agent (stops accepting new jobs without tearing down the watcher). */
  pause(): void {
    this.runner.pause()
  }

  /** Resume a paused agent. */
  resume(): void {
    this.runner.resume()
  }

  /** Stop the agent completely. Detaches the job watcher. */
  stop(): void {
    this.runner.stop()
  }

  /** Get current on-chain agent status. */
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
}
