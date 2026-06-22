import { ChainClient } from '../chain/ChainClient'
import { JobCompletedEvent } from '../chain/EventWatcher'
import { ScoutVerifier } from './ScoutVerifier'
import { ExecutorVerifier } from './ExecutorVerifier'
import { AmountCalculator } from '../payment/AmountCalculator'
import { Logger } from '../logger/Logger'
import { CONFIG } from '../config'

const log = new Logger('verification')

export interface CheckResult {
  passed: boolean
  detail: string
}

export interface VerificationResult {
  passed: boolean
  suspicious: boolean
  failures: string[]
  checks: Record<string, CheckResult>
}

export class VerificationEngine {
  private client: ChainClient
  private scout: ScoutVerifier
  private executor: ExecutorVerifier

  constructor(client: ChainClient) {
    this.client = client
    this.scout = new ScoutVerifier(client)
    this.executor = new ExecutorVerifier(client)
  }

  async verify(event: JobCompletedEvent): Promise<VerificationResult> {
    log.debug(`Verifying job #${event.jobId} (type: ${event.agentType === 0 ? 'Scout' : 'Executor'})`)

    const checks: Record<string, CheckResult> = {}
    const failures: string[] = []

    // CHECK 1: Job status on-chain
    try {
      const job = await this.client.contracts.engine.jobs(event.jobId)
      const status = Number(job.status)
      checks['job_status_completed'] = {
        passed: status === 1,
        detail: `job.status = ${['Pending', 'Completed', 'Failed', 'Expired'][status] ?? status}`,
      }
    } catch (err: any) {
      checks['job_status_completed'] = { passed: false, detail: `chain read failed: ${err.message}` }
    }

    // CHECK 2: Job assigned to claimed agent
    try {
      const job = await this.client.contracts.engine.jobs(event.jobId)
      const match = job.assignedAgent.toLowerCase() === event.agentWallet.toLowerCase()
      checks['agent_wallet_match'] = {
        passed: match,
        detail: `assignedAgent=${job.assignedAgent.slice(0, 10)} claimed=${event.agentWallet.slice(0, 10)}`,
      }
    } catch (err: any) {
      checks['agent_wallet_match'] = { passed: false, detail: `chain read failed: ${err.message}` }
    }

    // CHECK 3: Not already paid
    try {
      const isPaid = await this.client.contracts.ledger.isPaid(event.jobId)
      checks['not_already_paid'] = {
        passed: !isPaid,
        detail: isPaid ? 'ALREADY PAID — double payment attempt' : 'not paid yet',
      }
    } catch (err: any) {
      checks['not_already_paid'] = { passed: false, detail: `chain read failed: ${err.message}` }
    }

    // CHECK 4: FeePool balance (informational — dynamic scaling handles the amount)
    try {
      const balance = Number(await this.client.contracts.feePool.getBalance())
      const healthFactor = AmountCalculator.getHealthFactor(balance)
      checks['pool_sufficient'] = {
        passed: true,
        detail: `pool=${(balance / 1e6).toFixed(2)} USDC health=${healthFactor.toFixed(2)}`,
      }
    } catch (err: any) {
      checks['pool_sufficient'] = { passed: true, detail: `chain read failed (non-blocking): ${err.message}` }
    }

    // CHECK 5: Agent is active
    try {
      const agent = await this.client.contracts.registry.getAgent(event.agentWallet)
      const status = Number(agent.status)
      checks['agent_active'] = {
        passed: status === 0,
        detail: `agent.status = ${['Active', 'Paused', 'Deregistered', 'Banned'][status] ?? status}`,
      }
    } catch (err: any) {
      checks['agent_active'] = { passed: false, detail: `chain read failed: ${err.message}` }
    }

    // CHECK 6: devWallet matches registry
    try {
      const agent = await this.client.contracts.registry.getAgent(event.agentWallet)
      const match = agent.developerWallet.toLowerCase() === event.devWallet.toLowerCase()
      checks['devwallet_match'] = {
        passed: match,
        detail: `registry=${agent.developerWallet.slice(0, 10)} event=${event.devWallet.slice(0, 10)}`,
      }
    } catch (err: any) {
      checks['devwallet_match'] = { passed: false, detail: `chain read failed: ${err.message}` }
    }

    // CHECK 7: Amount within allowed range
    const amountOk = event.amount >= 0 && event.amount <= CONFIG.MAX_PAYMENT_USDC
    checks['amount_in_range'] = {
      passed: amountOk,
      detail: `amount=${event.amount / 1e6} USDC max=${CONFIG.MAX_PAYMENT_USDC / 1e6} USDC`,
    }

    // Type-specific checks
    const typeChecks = event.agentType === 0
      ? await this.scout.verify(event)
      : await this.executor.verify(event)

    Object.assign(checks, typeChecks)

    // Aggregate results
    for (const [name, result] of Object.entries(checks)) {
      if (!result.passed) failures.push(`${name}: ${result.detail}`)
    }

    const passed = failures.length === 0
    const suspicious = checks['not_already_paid']?.passed === false
      || (checks['agent_active']?.passed === false && !passed)

    if (!passed) {
      log.warn(`Verification FAILED for job #${event.jobId}`, { failures })
    } else {
      log.info(`Verification PASSED for job #${event.jobId} (${Object.keys(checks).length} checks)`)
    }

    return { passed, suspicious, failures, checks }
  }
}
