import { ethers } from 'ethers'
import { X402Receipt } from './types'
import { Logger } from '../logger/Logger'

const FUJI_EXPLORER = 'https://testnet.snowtrace.io'
const log = new Logger('receipt-builder')

export interface BuildReceiptParams {
  jobId: number
  agentType: number
  devWallet: string
  amount: number
  paymentTxHash: string
  ledgerTxHash: string
  reasoning: string
  orchestratorWallet: ethers.Wallet | ethers.HDNodeWallet
}

export class ReceiptBuilder {
  static async build(params: BuildReceiptParams): Promise<X402Receipt> {
    const { jobId, agentType, devWallet, amount, paymentTxHash, ledgerTxHash, reasoning, orchestratorWallet } = params

    const unsigned: Omit<X402Receipt, 'signature'> = {
      version: 'x402/1.0',
      jobId,
      agentType: agentType === 0 ? 'scout' : 'executor',
      recipient: devWallet,
      amount: (amount / 1e6).toFixed(6),
      amountRaw: amount,
      currency: 'USDC',
      chain: 'avalanche-fuji',
      chainId: 43113,
      settlementTx: paymentTxHash,
      ledgerTx: ledgerTxHash,
      explorerUrls: {
        settlement: `${FUJI_EXPLORER}/tx/${paymentTxHash}`,
        ledger: `${FUJI_EXPLORER}/tx/${ledgerTxHash}`,
      },
      timestamp: new Date().toISOString(),
      reasoning: reasoning.slice(0, 500),
      orchestratorWallet: orchestratorWallet.address,
    }

    const canonicalJSON = JSON.stringify(unsigned, Object.keys(unsigned).sort())
    const signature = await orchestratorWallet.signMessage(canonicalJSON)

    log.debug(`Receipt built and signed for job #${jobId}`)

    return { ...unsigned, signature }
  }

  static verify(receipt: X402Receipt): { valid: boolean; signer: string } {
    const { signature, ...unsigned } = receipt
    const canonicalJSON = JSON.stringify(unsigned, Object.keys(unsigned).sort())
    try {
      const signer = ethers.verifyMessage(canonicalJSON, signature)
      return { valid: true, signer }
    } catch {
      return { valid: false, signer: '' }
    }
  }
}
