import { ChainClient } from '../chain/ChainClient'
import { AmountCalculator } from '../payment/AmountCalculator'
import { CONFIG } from '../config'
import { Logger } from '../logger/Logger'

const log = new Logger('pool-monitor')

export class PoolMonitor {
  private interval: ReturnType<typeof setInterval> | null = null
  private healthy = true
  private _lastHealthFactor = 1.0

  constructor(private client: ChainClient) {}

  start(): void {
    this.interval = setInterval(() => this._check(), 60_000)
    log.info('PoolMonitor started — checking every 60s')
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    log.info('PoolMonitor stopped')
  }

  isHealthy(): boolean {
    return this.healthy
  }

  getHealthFactor(): number {
    return this._lastHealthFactor
  }

  private async _check(): Promise<void> {
    try {
      const balance = Number(await this.client.contracts.feePool.getBalance())
      this._lastHealthFactor = AmountCalculator.getHealthFactor(balance)
      this.healthy = balance > CONFIG.MIN_POOL_RESERVE

      if (!this.healthy) {
        log.warn('FeePool depleted — executors working for free', {
          balance: (balance / 1e6).toFixed(2) + ' USDC',
        })
      } else {
        log.debug('FeePool status', {
          balance: (balance / 1e6).toFixed(2) + ' USDC',
          healthFactor: this._lastHealthFactor.toFixed(2),
          payRate: (this._lastHealthFactor * 100).toFixed(0) + '%',
        })
      }
    } catch (err: any) {
      log.warn('PoolMonitor check failed', { error: err.message })
    }
  }
}
