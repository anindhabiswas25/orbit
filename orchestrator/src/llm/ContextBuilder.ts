import { ChainClient } from '../chain/ChainClient'
import { JobCompletedEvent } from '../chain/EventWatcher'
import { VerificationResult } from '../verification/VerificationEngine'
import { DecisionContext } from './RuleSystem'
import { AmountCalculator } from '../payment/AmountCalculator'
import { AnomalyDetector } from '../guards/AnomalyDetector'

export class ContextBuilder {
  private client: ChainClient
  private anomaly: AnomalyDetector

  constructor(client: ChainClient) {
    this.client = client
    this.anomaly = new AnomalyDetector()
  }

  async build(
    event: JobCompletedEvent,
    verResult: VerificationResult
  ): Promise<DecisionContext> {
    const { contracts } = this.client

    const [
      agentRaw,
      vaultBalance,
      bestProtocol,
      bestAPY,
      activeProtocol,
      activeAPY,
      poolBalance,
      isPaid,
      allAdapterAPYs,
    ] = await Promise.all([
      contracts.registry.getAgent(event.agentWallet),
      contracts.vault.getVaultBalance(),
      contracts.yieldReg.bestProtocol(),
      contracts.yieldReg.bestAPY(),
      contracts.yieldReg.activeProtocol(),
      contracts.yieldReg.activeAPY(),
      contracts.feePool.getBalance(),
      contracts.ledger.isPaid(event.jobId),
      this.client.getAllAdapterAPYs(),
    ])

    const baseAmount = AmountCalculator.calculate(
      Number(vaultBalance),
      Number(agentRaw.fee)
    )
    const scaledAmount = AmountCalculator.calculateScaled(baseAmount, Number(poolBalance))
    const poolHealthFactor = AmountCalculator.getHealthFactor(Number(poolBalance))

    const anomalySignals = this.anomaly.detect({
      event,
      agentReputation: Number(agentRaw.reputationScore),
      agentJobsCompleted: Number(agentRaw.jobsCompleted),
      bestAPY: Number(bestAPY),
      feePoolBalance: Number(poolBalance),
    })

    return {
      event: {
        jobId: event.jobId,
        type: event.agentType === 0 ? 'Scout' : 'Executor',
        agentWallet: event.agentWallet,
        devWallet: event.devWallet,
        claimedAmount: event.amount,
        jobAssignedAt: event.assignedAt,
        jobCompletedAt: event.completedAt,
        elapsedMs: event.completedAt - event.assignedAt,
      },
      verificationResult: verResult.passed ? 'ALL_PASS' :
        `FAILED: ${verResult.failures.join(', ')}`,
      checks: verResult.checks,
      agentContext: {
        reputation: Number(agentRaw.reputationScore),
        jobsCompleted: Number(agentRaw.jobsCompleted),
        jobsFailed: Number(agentRaw.jobsFailed),
        stake: Number(agentRaw.stake) / 1e6,
        registeredAt: new Date(Number(agentRaw.registeredAt) * 1000).toISOString(),
        endpoint: agentRaw.endpoint,
      },
      marketContext: {
        allAdapterAPYs,
        bestProtocol: bestProtocol,
        bestAPY: Number(bestAPY),
        activeProtocol: activeProtocol,
        activeAPY: Number(activeAPY),
        vaultBalance: Number(vaultBalance) / 1e6,
        feePoolBalance: Number(poolBalance) / 1e6,
        feePoolAboveReserve: Number(poolBalance) > 10_000_000,
      },
      paymentContext: {
        isPaid,
        calculatedAmount: scaledAmount,
        claimedAmount: event.amount,
        amountMatch: true,
        poolHealthFactor,
        scaledAmount,
      },
      anomalySignals,
    }
  }
}
