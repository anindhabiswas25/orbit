import { ChainClient } from '../chain/ChainClient'
import { JobCompletedEvent } from '../chain/EventWatcher'
import { CheckResult } from './VerificationEngine'

const APY_TOLERANCE_BPS = 50

export class ScoutVerifier {
  constructor(private client: ChainClient) {}

  async verify(event: JobCompletedEvent): Promise<Record<string, CheckResult>> {
    const checks: Record<string, CheckResult> = {}
    const { yieldReg, engine } = this.client.contracts

    try {
      const [lastUpdated, job] = await Promise.all([
        yieldReg.lastUpdated(),
        engine.jobs(event.jobId),
      ])
      const updatedAfterAssign = Number(lastUpdated) >= Number(job.assignedAt)
      checks['scout_registry_updated_after_assign'] = {
        passed: updatedAfterAssign,
        detail: `lastUpdated=${Number(lastUpdated)} assignedAt=${Number(job.assignedAt)}`,
      }
    } catch (err: any) {
      checks['scout_registry_updated_after_assign'] = { passed: false, detail: err.message }
    }

    try {
      const bestProtocol = await yieldReg.bestProtocol()
      const isRegistered = await yieldReg.isAdapter(bestProtocol)
      checks['scout_posted_registered_adapter'] = {
        passed: isRegistered,
        detail: `bestProtocol=${bestProtocol} isRegistered=${isRegistered}`,
      }
    } catch (err: any) {
      checks['scout_posted_registered_adapter'] = { passed: false, detail: err.message }
    }

    try {
      const bestAPY = Number(await yieldReg.bestAPY())
      checks['scout_posted_nonzero_apy'] = {
        passed: bestAPY > 0,
        detail: `bestAPY=${bestAPY} bps`,
      }
    } catch (err: any) {
      checks['scout_posted_nonzero_apy'] = { passed: false, detail: err.message }
    }

    try {
      const postedAPY = Number(await yieldReg.bestAPY())
      const adapterAPYs = await this.client.getAllAdapterAPYs()
      const actualBest = Math.max(...Object.values(adapterAPYs), 0)
      const withinTolerance = postedAPY >= actualBest - APY_TOLERANCE_BPS
      checks['scout_apy_within_tolerance'] = {
        passed: withinTolerance,
        detail: `posted=${postedAPY}bps actualBest=${actualBest}bps tolerance=${APY_TOLERANCE_BPS}bps adapters=${JSON.stringify(adapterAPYs)}`,
      }
    } catch (err: any) {
      checks['scout_apy_within_tolerance'] = { passed: false, detail: err.message }
    }

    return checks
  }
}
