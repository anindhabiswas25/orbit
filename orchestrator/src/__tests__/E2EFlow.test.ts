/**
 * E2E flow test — simulates the entire orchestrator pipeline:
 *   JobCompleted event → Verification → LLM decision → Payment → x402 Receipt
 *
 * Uses mocked chain client and HTTP server to test the full integration
 * without needing a live blockchain or LLM API.
 */

jest.mock('../config', () => ({
  CONFIG: {
    GROQ_API_KEY: 'test-key',
    GROQ_BASE_URL: 'http://localhost:0',
    LLM_MODEL: 'llama-3.1-8b-instant',
    LLM_MAX_TOKENS: 1000,
    MIN_POOL_RESERVE: 10_000_000,
    MAX_PAYMENT_USDC: 100_000,
    OPTIMAL_POOL_BALANCE: 100_000_000,
    MIN_HEALTH_FACTOR: 0.10,
    MIN_PAYMENT_USDC: 10_000,
    PAYMENT_RETRY_MAX: 1,
    RECEIPT_TIMEOUT_MS: 5000,
    CHAIN_ID: 43113,
    ADDRESSES: {},
    ALERT_WEBHOOK_URL: '',
    PORT: 0,
    RECEIPT_VERSION: '1.0',
  },
}))

import { VerificationEngine, VerificationResult } from '../verification/VerificationEngine'
import { DecisionParser, LLMDecision } from '../llm/DecisionParser'
import { ReceiptBuilder } from '../x402/ReceiptBuilder'
import { AmountCalculator } from '../payment/AmountCalculator'
import { AnomalyDetector } from '../guards/AnomalyDetector'
import { JobCompletedEvent } from '../chain/EventWatcher'
import { ethers } from 'ethers'

// ─── Mock chain client ─────────────────────────────────────────────────────

function makeMockClient(overrides: any = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    wallet: ethers.Wallet.createRandom(),
    provider: { getBlockNumber: jest.fn().mockResolvedValue(100) },
    adapters: [
      { address: '0xAave', name: 'AAVE V3', contract: { getAPY: jest.fn().mockResolvedValue(BigInt(620)) } },
      { address: '0xBenqi', name: 'Benqi', contract: { getAPY: jest.fn().mockResolvedValue(BigInt(410)) } },
      { address: '0xMockA', name: 'MockPoolA', contract: { getAPY: jest.fn().mockResolvedValue(BigInt(500)) } },
      { address: '0xMockB', name: 'MockPoolB', contract: { getAPY: jest.fn().mockResolvedValue(BigInt(480)) } },
    ],
    async getAllAdapterAPYs() {
      const results: Record<string, number> = {}
      for (const a of this.adapters) {
        try { results[a.name] = Number(await a.contract.getAPY()) } catch { results[a.name] = 0 }
      }
      return results
    },
    contracts: {
      engine: {
        jobs: jest.fn().mockResolvedValue({
          status: 1,
          assignedAgent: '0xScoutWallet',
          assignedAt: BigInt(now - 10),
        }),
        filters: { JobCompleted: jest.fn(), JobAssigned: jest.fn() },
        queryFilter: jest.fn().mockResolvedValue([]),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
      },
      registry: {
        getAgent: jest.fn().mockResolvedValue({
          status: BigInt(0),
          developerWallet: '0xDevWallet',
          reputationScore: BigInt(10),
          jobsCompleted: BigInt(12),
          jobsFailed: BigInt(0),
          stake: BigInt(5_000_000),
          registeredAt: BigInt(now - 86400),
          endpoint: 'http://localhost:4001/agent-card',
          fee: BigInt(50),
          agentType: BigInt(0),
        }),
      },
      yieldReg: {
        bestProtocol: jest.fn().mockResolvedValue('0xAave'),
        bestAPY: jest.fn().mockResolvedValue(BigInt(620)),
        lastUpdated: jest.fn().mockResolvedValue(BigInt(now)),
        isAdapter: jest.fn().mockResolvedValue(true),
        activeProtocol: jest.fn().mockResolvedValue('0xAave'),
        activeAPY: jest.fn().mockResolvedValue(BigInt(620)),
        getRebalanceLogsCount: jest.fn().mockResolvedValue(BigInt(1)),
        getRebalanceLogs: jest.fn().mockResolvedValue([{
          fromAPY: BigInt(410), toAPY: BigInt(620), timestamp: BigInt(now),
        }]),
        getAdapters: jest.fn().mockResolvedValue([]),
        adapterName: jest.fn().mockResolvedValue('Unknown'),
      },
      vault: {
        getVaultBalance: jest.fn().mockResolvedValue(BigInt(100_000_000)),
        getCurrentAdapter: jest.fn().mockResolvedValue('0xAave'),
      },
      feePool: {
        getBalance: jest.fn().mockResolvedValue(BigInt(50_000_000)),
        payAgent: jest.fn().mockResolvedValue({
          wait: jest.fn().mockResolvedValue({ hash: '0x' + 'ab'.repeat(32) }),
        }),
      },
      ledger: {
        isPaid: jest.fn().mockResolvedValue(false),
        getTotalSettled: jest.fn().mockResolvedValue(BigInt(0)),
        getSettledJobIds: jest.fn().mockResolvedValue([]),
        settle: jest.fn().mockResolvedValue({
          wait: jest.fn().mockResolvedValue({ hash: '0x' + 'cd'.repeat(32) }),
        }),
      },
      ...overrides,
    },
  } as any
}

function makeEvent(overrides: Partial<JobCompletedEvent> = {}): JobCompletedEvent {
  return {
    jobId: 15,
    agentWallet: '0xScoutWallet',
    devWallet: '0xDevWallet',
    amount: 100_000,
    agentType: 0,
    assignedAt: Date.now() - 5000,
    completedAt: Date.now(),
    txHash: '0x' + 'ff'.repeat(32),
    blockNumber: 100,
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('E2E Flow — Scout Job Payment', () => {

  it('Step 1: Verification passes for valid scout job', async () => {
    const client = makeMockClient()
    const verifier = new VerificationEngine(client)
    const event = makeEvent()

    const result = await verifier.verify(event)

    expect(result.passed).toBe(true)
    expect(result.suspicious).toBe(false)
    expect(result.failures).toHaveLength(0)
    expect(Object.keys(result.checks).length).toBeGreaterThanOrEqual(7)
    expect(result.checks['job_status_completed'].passed).toBe(true)
    expect(result.checks['not_already_paid'].passed).toBe(true)
    expect(result.checks['pool_sufficient'].passed).toBe(true)
    expect(result.checks['agent_active'].passed).toBe(true)
    expect(result.checks['devwallet_match'].passed).toBe(true)
    expect(result.checks['amount_in_range'].passed).toBe(true)
    expect(result.checks['scout_posted_nonzero_apy'].passed).toBe(true)
    expect(result.checks['scout_apy_within_tolerance'].passed).toBe(true)
  })

  it('Step 2: LLM PAY decision parses correctly', () => {
    const llmResponse = JSON.stringify({
      decision: 'PAY',
      confidence: 0.99,
      amount: 100000,
      reasoning: 'Scout correctly identified AAVE V3 as best protocol at 620 bps, which is highest of all 4 adapters. Job completed in 5s, well within 90s window. Agent has strong reputation. FeePool has sufficient balance. Payment authorized per RULE 4.',
      flags: [],
      rule_refs: ['RULE 4', 'RULE 1'],
    })

    const decision = DecisionParser.parse(llmResponse)
    expect(decision.decision).toBe('PAY')
    expect(decision.amount).toBe(100000)
    expect(decision.confidence).toBe(0.99)
    expect(decision.reasoning.length).toBeGreaterThan(50)
  })

  it('Step 3: Payment amount calculation matches', () => {
    const amount = AmountCalculator.calculate(100_000_000, 50)
    expect(amount).toBe(100_000)
    expect(AmountCalculator.verify(100_000, 100_000_000, 50)).toBe(true)
  })

  it('Step 4: x402 receipt builds and verifies correctly', async () => {
    const wallet = ethers.Wallet.createRandom()

    const receipt = await ReceiptBuilder.build({
      jobId: 15,
      agentType: 0,
      devWallet: '0xDevWallet',
      amount: 100000,
      paymentTxHash: '0x' + 'ab'.repeat(32),
      ledgerTxHash: '0x' + 'cd'.repeat(32),
      reasoning: 'Scout correctly identified best protocol. Payment authorized.',
      orchestratorWallet: wallet,
    })

    expect(receipt.version).toBe('x402/1.0')
    expect(receipt.jobId).toBe(15)
    expect(receipt.agentType).toBe('scout')
    expect(receipt.amount).toBe('0.100000')
    expect(receipt.currency).toBe('USDC')
    expect(receipt.chain).toBe('avalanche-fuji')
    expect(receipt.chainId).toBe(43113)
    expect(receipt.settlementTx).toContain('0xab')
    expect(receipt.ledgerTx).toContain('0xcd')
    expect(receipt.explorerUrls.settlement).toContain('snowtrace.io')
    expect(receipt.signature).toBeTruthy()
    expect(receipt.orchestratorWallet).toBe(wallet.address)

    const { valid, signer } = ReceiptBuilder.verify(receipt)
    expect(valid).toBe(true)
    expect(signer.toLowerCase()).toBe(wallet.address.toLowerCase())
  })

  it('Full pipeline: verify → decide → pay → receipt', async () => {
    const client = makeMockClient()
    const event = makeEvent()

    // Step 1: Verification
    const verifier = new VerificationEngine(client)
    const verResult = await verifier.verify(event)
    expect(verResult.passed).toBe(true)

    // Step 2: LLM decision (simulated)
    const decision: LLMDecision = {
      decision: 'PAY',
      confidence: 0.99,
      amount: 100000,
      reasoning: 'Scout correctly identified AAVE V3 as best protocol at 620 bps. All verification checks passed. Payment authorized.',
      flags: [],
      ruleRefs: ['RULE 4'],
    }

    // Step 3: Payment execution
    const { feePool, ledger } = client.contracts
    const payTx = await feePool.payAgent(event.devWallet, decision.amount, event.jobId)
    const payReceipt = await payTx.wait()
    expect(payReceipt.hash).toBeTruthy()
    expect(feePool.payAgent).toHaveBeenCalledWith(event.devWallet, 100000, 15)

    const ledgerTx = await ledger.settle(
      event.jobId, event.agentWallet, event.devWallet,
      decision.amount, ethers.zeroPadValue('0x01', 32),
      decision.reasoning.slice(0, 500), event.agentType
    )
    const ledgerReceipt = await ledgerTx.wait()
    expect(ledgerReceipt.hash).toBeTruthy()
    expect(ledger.settle).toHaveBeenCalled()

    // Step 4: x402 receipt
    const receipt = await ReceiptBuilder.build({
      jobId: event.jobId,
      agentType: event.agentType,
      devWallet: event.devWallet,
      amount: decision.amount,
      paymentTxHash: payReceipt.hash,
      ledgerTxHash: ledgerReceipt.hash,
      reasoning: decision.reasoning,
      orchestratorWallet: client.wallet,
    })
    expect(receipt.version).toBe('x402/1.0')
    expect(receipt.jobId).toBe(15)
    const { valid } = ReceiptBuilder.verify(receipt)
    expect(valid).toBe(true)
  })
})

describe('E2E Flow — Verification Failures', () => {

  it('rejects double payment attempt', async () => {
    const client = makeMockClient()
    client.contracts.ledger.isPaid.mockResolvedValue(true)
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(makeEvent())

    expect(result.passed).toBe(false)
    expect(result.suspicious).toBe(true)
    expect(result.failures.some((f: string) => f.includes('not_already_paid'))).toBe(true)
  })

  it('passes pool check even when low (dynamic scaling handles amount)', async () => {
    const client = makeMockClient()
    client.contracts.feePool.getBalance.mockResolvedValue(BigInt(5_000_000))
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(makeEvent())

    expect(result.checks['pool_sufficient'].passed).toBe(true)
    expect(result.checks['pool_sufficient'].detail).toContain('health=0.00')
  })

  it('rejects when agent is deregistered', async () => {
    const client = makeMockClient()
    client.contracts.registry.getAgent.mockResolvedValue({
      status: BigInt(2),
      developerWallet: '0xDevWallet',
      reputationScore: BigInt(0), jobsCompleted: BigInt(0), jobsFailed: BigInt(0),
      stake: BigInt(0), registeredAt: BigInt(0), endpoint: '', fee: BigInt(50),
    })
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(makeEvent())

    expect(result.passed).toBe(false)
    expect(result.failures.some((f: string) => f.includes('agent_active'))).toBe(true)
  })

  it('rejects devWallet mismatch', async () => {
    const client = makeMockClient()
    client.contracts.registry.getAgent.mockResolvedValue({
      status: BigInt(0),
      developerWallet: '0xWRONGwallet',
      reputationScore: BigInt(10), jobsCompleted: BigInt(12), jobsFailed: BigInt(0),
      stake: BigInt(5_000_000), registeredAt: BigInt(1000000), endpoint: 'http://x.com', fee: BigInt(50),
    })
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(makeEvent())

    expect(result.passed).toBe(false)
    expect(result.failures.some((f: string) => f.includes('devwallet_match'))).toBe(true)
  })

  it('rejects when job not completed on-chain', async () => {
    const client = makeMockClient()
    const now = Math.floor(Date.now() / 1000)
    client.contracts.engine.jobs.mockResolvedValue({
      status: 0,
      assignedAgent: '0xScoutWallet',
      assignedAt: BigInt(now - 10),
    })
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(makeEvent())

    expect(result.passed).toBe(false)
    expect(result.failures.some((f: string) => f.includes('job_status_completed'))).toBe(true)
  })
})

describe('E2E Flow — Executor Job', () => {

  it('passes verification for valid executor job', async () => {
    const client = makeMockClient()
    const event = makeEvent({ agentType: 1 })
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(event)

    expect(result.passed).toBe(true)
    expect(result.checks['executor_vault_on_best'].passed).toBe(true)
    expect(result.checks['executor_registry_active_updated'].passed).toBe(true)
    expect(result.checks['executor_yield_improved'].passed).toBe(true)
  })

  it('fails executor when vault not on best protocol', async () => {
    const client = makeMockClient()
    client.contracts.vault.getCurrentAdapter.mockResolvedValue('0xWrongAdapter')
    const event = makeEvent({ agentType: 1 })
    const verifier = new VerificationEngine(client)
    const result = await verifier.verify(event)

    expect(result.passed).toBe(false)
    expect(result.checks['executor_vault_on_best'].passed).toBe(false)
  })
})

describe('E2E Flow — Anomaly Detection', () => {

  it('detects implausibly high APY', () => {
    const detector = new AnomalyDetector()
    const signals = detector.detect({
      event: makeEvent(),
      agentReputation: 10,
      agentJobsCompleted: 12,
      bestAPY: 6000,
      feePoolBalance: 50_000_000,
    })
    expect(signals.some(s => s.includes('implausible_apy'))).toBe(true)
  })

  it('detects low pool balance', () => {
    const detector = new AnomalyDetector()
    const signals = detector.detect({
      event: makeEvent(),
      agentReputation: 10,
      agentJobsCompleted: 12,
      bestAPY: 620,
      feePoolBalance: 3_000_000,
    })
    expect(signals.some(s => s.includes('low_pool'))).toBe(true)
  })

  it('returns no signals for normal conditions', () => {
    const detector = new AnomalyDetector()
    const signals = detector.detect({
      event: makeEvent(),
      agentReputation: 10,
      agentJobsCompleted: 12,
      bestAPY: 620,
      feePoolBalance: 50_000_000,
    })
    expect(signals).toHaveLength(0)
  })
})

describe('E2E Flow — LLM Decision Edge Cases', () => {

  it('REJECT decision parses correctly', () => {
    const raw = JSON.stringify({
      decision: 'REJECT',
      confidence: 1.0,
      amount: 0,
      reasoning: 'Job verification failed — job status is Pending, not Completed. Cannot authorize payment per RULE 1.',
      flags: ['verification_failed'],
      rule_refs: ['RULE 1'],
    })
    const d = DecisionParser.parse(raw)
    expect(d.decision).toBe('REJECT')
    expect(d.amount).toBe(0)
    expect(d.flags).toContain('verification_failed')
  })

  it('ESCALATE decision parses correctly', () => {
    const raw = JSON.stringify({
      decision: 'ESCALATE',
      confidence: 0.85,
      amount: 0,
      reasoning: 'Agent completing jobs at inhuman speed (avg 1.5s between completions). Flagging for team review per RULE 6.',
      flags: ['inhuman_speed'],
      rule_refs: ['RULE 6'],
    })
    const d = DecisionParser.parse(raw)
    expect(d.decision).toBe('ESCALATE')
    expect(d.flags).toContain('inhuman_speed')
  })

  it('INVESTIGATE decision parses correctly', () => {
    const raw = JSON.stringify({
      decision: 'INVESTIGATE',
      confidence: 0.6,
      amount: 0,
      reasoning: 'Scout posted AAVE V3 at 620 bps but actual best may be MockPoolA at 650 bps. Need manual verification.',
      flags: ['apy_discrepancy'],
      rule_refs: ['RULE 4'],
    })
    const d = DecisionParser.parse(raw)
    expect(d.decision).toBe('INVESTIGATE')
  })
})
