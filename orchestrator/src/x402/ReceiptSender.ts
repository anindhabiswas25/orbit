import { ChainClient } from '../chain/ChainClient'
import { ReceiptBuilder } from './ReceiptBuilder'
import { X402Receipt } from './types'
import { Logger } from '../logger/Logger'
import { CONFIG } from '../config'
import { withRetry } from '../utils/retry'

const log = new Logger('receipt-sender')

export interface SendReceiptParams {
  jobId: number
  agentEndpoint: string
  devWallet: string
  amount: number
  agentType: number
  paymentTxHash: string
  ledgerTxHash: string
  reasoning: string
}

export class ReceiptSender {
  constructor(private client: ChainClient) {}

  async send(params: SendReceiptParams): Promise<void> {
    const receipt = await ReceiptBuilder.build({
      jobId: params.jobId,
      agentType: params.agentType,
      devWallet: params.devWallet,
      amount: params.amount,
      paymentTxHash: params.paymentTxHash,
      ledgerTxHash: params.ledgerTxHash,
      reasoning: params.reasoning,
      orchestratorWallet: this.client.wallet,
    })

    const endpointBase = params.agentEndpoint.replace(/\/+$/, '')
    const receiptUrl = endpointBase.includes('/agent-card')
      ? endpointBase.replace('/agent-card', '/x402/receipt')
      : `${endpointBase}/x402/receipt`

    log.info(`Sending x402 receipt to ${receiptUrl}`, { jobId: params.jobId })

    try {
      await withRetry(
        () => this._post(receiptUrl, receipt),
        { maxAttempts: 3, baseDelayMs: 2000, label: `x402 receipt job#${params.jobId}` }
      )
      log.info(`x402 receipt delivered for job #${params.jobId}`)
    } catch (err: any) {
      log.warn(`x402 receipt delivery failed (non-fatal) for job #${params.jobId}`, {
        error: err.message,
        url: receiptUrl,
      })
    }
  }

  private async _post(url: string, receipt: X402Receipt): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CONFIG.RECEIPT_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Orbit-Version': '1.0',
        },
        body: JSON.stringify(receipt),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      }

      const body = await res.json() as any
      if (body.received !== true) {
        throw new Error(`Agent rejected receipt: ${JSON.stringify(body)}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
