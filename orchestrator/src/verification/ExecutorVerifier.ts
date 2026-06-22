import { ethers } from 'ethers'
import { ChainClient } from '../chain/ChainClient'
import { JobCompletedEvent } from '../chain/EventWatcher'
import { CheckResult } from './VerificationEngine'

export class ExecutorVerifier {
  constructor(private client: ChainClient) {}

  async verify(event: JobCompletedEvent): Promise<Record<string, CheckResult>> {
    const checks: Record<string, CheckResult> = {}
    const { yieldReg, vault, engine } = this.client.contracts

    try {
      const [currentAdapter, bestProtocol] = await Promise.all([
        vault.getCurrentAdapter(),
        yieldReg.bestProtocol(),
      ])
      const match = currentAdapter.toLowerCase() === bestProtocol.toLowerCase()
      checks['executor_vault_on_best'] = {
        passed: match,
        detail: `current=${currentAdapter.slice(0, 10)} best=${bestProtocol.slice(0, 10)}`,
      }
    } catch (err: any) {
      checks['executor_vault_on_best'] = { passed: false, detail: err.message }
    }

    try {
      const [activeProtocol, job] = await Promise.all([
        yieldReg.activeProtocol(),
        engine.jobs(event.jobId),
      ])
      const activeIsNotZero = activeProtocol !== ethers.ZeroAddress
      checks['executor_registry_active_updated'] = {
        passed: activeIsNotZero,
        detail: `activeProtocol=${activeProtocol.slice(0, 10)}`,
      }
    } catch (err: any) {
      checks['executor_registry_active_updated'] = { passed: false, detail: err.message }
    }

    try {
      const count = Number(await yieldReg.getRebalanceLogsCount())
      if (count === 0) {
        checks['executor_yield_improved'] = {
          passed: true,
          detail: 'First deposit — no prior protocol to compare against',
        }
      } else {
        const [lastLog] = await yieldReg.getRebalanceLogs(count - 1, 1)
        const improved = lastLog
          ? Number(lastLog.toAPY) >= Number(lastLog.fromAPY)
          : true
        checks['executor_yield_improved'] = {
          passed: improved,
          detail: lastLog
            ? `from=${Number(lastLog.fromAPY)}bps to=${Number(lastLog.toAPY)}bps`
            : 'no log found',
        }
      }
    } catch (err: any) {
      checks['executor_yield_improved'] = { passed: false, detail: err.message }
    }

    return checks
  }
}
