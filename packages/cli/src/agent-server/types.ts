export interface X402Receipt {
  version: 'x402/1.0'
  jobId: number
  agentType: 'scout' | 'executor'
  recipient: string
  amount: string
  amountRaw: number
  currency: 'USDC'
  chain: 'avalanche-fuji'
  chainId: 43113
  settlementTx: string
  ledgerTx: string
  explorerUrls: {
    settlement: string
    ledger: string
  }
  timestamp: string
  reasoning: string
  signature: string
  orchestratorWallet: string
}

export interface ReceiptReceivedEvent {
  jobId: number
  amount: string
  settlementTx: string
  explorerUrl: string
  reasoning: string
  timestamp: Date
}
