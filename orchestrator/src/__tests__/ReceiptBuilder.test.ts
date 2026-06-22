import { ethers } from 'ethers'
import { ReceiptBuilder } from '../x402/ReceiptBuilder'

describe('ReceiptBuilder', () => {
  it('builds a signed receipt and verifies signature', async () => {
    const wallet = ethers.Wallet.createRandom()

    const receipt = await ReceiptBuilder.build({
      jobId: 15,
      agentType: 0,
      devWallet: '0x1234567890123456789012345678901234567890',
      amount: 100000,
      paymentTxHash: '0x' + '4a'.repeat(32),
      ledgerTxHash: '0x' + '9f'.repeat(32),
      reasoning: 'Test payment for unit test.',
      orchestratorWallet: wallet,
    })

    expect(receipt.version).toBe('x402/1.0')
    expect(receipt.amount).toBe('0.100000')
    expect(receipt.amountRaw).toBe(100000)
    expect(receipt.agentType).toBe('scout')
    expect(receipt.chain).toBe('avalanche-fuji')
    expect(receipt.chainId).toBe(43113)
    expect(receipt.signature).toBeTruthy()
    expect(receipt.orchestratorWallet).toBe(wallet.address)

    const { valid, signer } = ReceiptBuilder.verify(receipt)
    expect(valid).toBe(true)
    expect(signer.toLowerCase()).toBe(wallet.address.toLowerCase())
  })

  it('builds executor receipt type', async () => {
    const wallet = ethers.Wallet.createRandom()

    const receipt = await ReceiptBuilder.build({
      jobId: 16,
      agentType: 1,
      devWallet: '0x1234567890123456789012345678901234567890',
      amount: 50000,
      paymentTxHash: '0x' + 'ab'.repeat(32),
      ledgerTxHash: '0x' + 'cd'.repeat(32),
      reasoning: 'Executor rebalanced vault successfully.',
      orchestratorWallet: wallet,
    })

    expect(receipt.agentType).toBe('executor')
    expect(receipt.amount).toBe('0.050000')
  })

  it('verify rejects tampered receipt', async () => {
    const wallet = ethers.Wallet.createRandom()

    const receipt = await ReceiptBuilder.build({
      jobId: 15,
      agentType: 0,
      devWallet: '0x1234567890123456789012345678901234567890',
      amount: 100000,
      paymentTxHash: '0x' + '4a'.repeat(32),
      ledgerTxHash: '0x' + '9f'.repeat(32),
      reasoning: 'Approved payment.',
      orchestratorWallet: wallet,
    })

    // Tamper with amount
    receipt.amount = '1.000000'
    const { valid, signer } = ReceiptBuilder.verify(receipt)
    // Signature will recover a different signer (not the orchestrator)
    expect(signer.toLowerCase()).not.toBe(wallet.address.toLowerCase())
  })
})
