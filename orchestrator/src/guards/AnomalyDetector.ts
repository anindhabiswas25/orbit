import { JobCompletedEvent } from '../chain/EventWatcher'

interface DetectInput {
  event: JobCompletedEvent
  agentReputation: number
  agentJobsCompleted: number
  bestAPY: number
  feePoolBalance: number
}

export class AnomalyDetector {
  private recentCompletions: Map<string, number[]> = new Map()

  detect(input: DetectInput): string[] {
    const signals: string[] = []
    const { event, bestAPY, feePoolBalance } = input

    // Track completion speed per wallet
    const wallet = event.agentWallet.toLowerCase()
    const times = this.recentCompletions.get(wallet) ?? []
    times.push(event.completedAt)
    if (times.length > 20) times.shift()
    this.recentCompletions.set(wallet, times)

    // Check for inhuman speed (< 2s consistently)
    if (times.length >= 3) {
      const gaps = []
      for (let i = 1; i < times.length; i++) {
        gaps.push(times[i] - times[i - 1])
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
      if (avgGap < 2000) {
        signals.push(`inhuman_speed: avg ${avgGap}ms between completions for ${wallet.slice(0, 10)}`)
      }
    }

    // Check for implausibly high APY
    if (bestAPY > 5000) {
      signals.push(`implausible_apy: ${bestAPY} bps (> 50% APY)`)
    }

    // Check for rapid pool drain
    if (feePoolBalance < 5_000_000) {
      signals.push(`low_pool: ${feePoolBalance / 1e6} USDC — rapid drain possible`)
    }

    return signals
  }
}
