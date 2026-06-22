import { ethers } from 'ethers'
import { ChainClient } from '../chain/ChainClient'
import { Logger } from '../logger/Logger'
import { withRetry } from '../utils/retry'
import { CONFIG } from '../config'

const log = new Logger('payment-executor')

export interface PaymentParams {
  jobId: number
  devWallet: string
  agentWallet: string
  amount: number
  agentType: number
  reasoning: string
}

export interface PaymentResult {
  paymentTxHash: string
  ledgerTxHash: string
  amount: number
  devWallet: string
}

export class PaymentExecutor {
  constructor(private client: ChainClient) {}

  async execute(params: PaymentParams): Promise<PaymentResult> {
    const { feePool, ledger } = this.client.contracts
    const { jobId, devWallet, agentWallet, amount, agentType, reasoning } = params

    log.info(`Executing payment for job #${jobId}`, {
      devWallet: devWallet.slice(0, 12) + '...',
      amount: amount / 1e6 + ' USDC',
    })

    // Step 1: FeePool.payAgent()
    let paymentTxHash: string

    try {
      const payTx = await withRetry(
        () => feePool.payAgent(devWallet, amount, jobId),
        { maxAttempts: CONFIG.PAYMENT_RETRY_MAX, baseDelayMs: 2000, label: `FeePool.payAgent(job#${jobId})` }
      )
      const payReceipt = await payTx.wait()
      paymentTxHash = payReceipt.hash

      log.info('FeePool.payAgent() confirmed', {
        jobId,
        tx: paymentTxHash,
        amount: amount / 1e6 + ' USDC',
      })
    } catch (err: any) {
      log.error(`FeePool.payAgent() FAILED for job #${jobId}`, { error: err.message })
      throw new Error(`Payment transaction failed: ${err.message}`)
    }

    // Step 2: PaymentLedger.settle()
    let ledgerTxHash: string

    try {
      const paymentTxHashBytes = ethers.zeroPadValue(ethers.toBeHex(paymentTxHash), 32)

      const ledgerTx = await withRetry(
        () => ledger.settle(
          jobId,
          agentWallet,
          devWallet,
          amount,
          paymentTxHashBytes,
          reasoning.slice(0, 500),
          agentType
        ),
        { maxAttempts: CONFIG.PAYMENT_RETRY_MAX, baseDelayMs: 2000, label: `Ledger.settle(job#${jobId})` }
      )
      const ledgerReceipt = await ledgerTx.wait()
      ledgerTxHash = ledgerReceipt.hash

      log.info('PaymentLedger.settle() confirmed', { jobId, tx: ledgerTxHash })
    } catch (err: any) {
      log.error(`CRITICAL: FeePool paid but Ledger.settle() failed for job #${jobId}`, {
        error: err.message,
        paymentTxHash,
        jobId,
        devWallet,
        amount,
      })
      throw new Error(
        `CRITICAL INCONSISTENCY: Payment sent (${paymentTxHash}) but ledger record failed: ${err.message}`
      )
    }

    return { paymentTxHash, ledgerTxHash, amount, devWallet }
  }
}
