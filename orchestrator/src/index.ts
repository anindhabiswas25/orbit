import { CONFIG } from './config'
import { ChainClient } from './chain/ChainClient'
import { EventWatcher } from './chain/EventWatcher'
import { VerificationEngine } from './verification/VerificationEngine'
import { LLMAgent } from './llm/LLMAgent'
import { PaymentExecutor } from './payment/PaymentExecutor'
import { AmountCalculator } from './payment/AmountCalculator'
import { ReceiptSender } from './x402/ReceiptSender'
import { DeadlineWatcher } from './guards/DeadlineWatcher'
import { PoolMonitor } from './guards/PoolMonitor'
import { ProcessedEvents } from './storage/ProcessedEvents'
import { Logger } from './logger/Logger'
import * as http from 'http'

const log = new Logger('orchestrator')

async function main() {
  log.info('═══════════════════════════════════════════════════')
  log.info('  ORBIT ORCHESTRATOR — LLM Payment Agent')
  log.info('  Network: Avalanche Fuji (Chain ID: 43113)')
  log.info('═══════════════════════════════════════════════════')

  const client = new ChainClient(CONFIG.ORCHESTRATOR_PRIVATE_KEY, CONFIG.FUJI_RPC_URL)
  const processed = new ProcessedEvents()
  const verifier = new VerificationEngine(client)
  const llmAgent = new LLMAgent(client)
  const payExecutor = new PaymentExecutor(client)
  const receiptSender = new ReceiptSender(client)

  await client.verifyNetwork()
  await client.initAdapters()
  log.info(`Orchestrator wallet: ${client.wallet.address}`)

  await processed.initialize(client.contracts.ledger, CONFIG.ADDRESSES.AgentSelectionEngine)

  const poolBalance = await client.contracts.feePool.getBalance()
  log.info(`FeePool balance: ${Number(poolBalance) / 1e6} USDC`)

  const deadlineWatcher = new DeadlineWatcher(client)
  const poolMonitor = new PoolMonitor(client)
  deadlineWatcher.start()
  poolMonitor.start()

  const watcher = new EventWatcher(client)

  // Track assigned jobs for deadline watching
  watcher.onJobAssigned(async (event) => {
    deadlineWatcher.trackJob(event.jobId, event.deadline)
  })

  // Core event handler — every JobCompleted flows through this
  watcher.onJobCompleted(async (event) => {
    const { jobId } = event

    if (processed.has(jobId)) {
      log.debug(`Job #${jobId} already processed — skipping`)
      return
    }
    processed.mark(jobId)

    // Scout jobs are free — no verification, no LLM, no payment
    if (event.agentType === 0) {
      log.info(`Scout job #${jobId} completed (free — no payment)`, {
        agent: event.agentWallet.slice(0, 12) + '...',
      })
      return
    }

    // Executor jobs: full pipeline with dynamic payment scaling
    log.info(`══ Executor job #${jobId} completed — starting verification ══`)

    try {
      // Step 1: Deterministic verification
      const verResult = await verifier.verify(event)

      if (!verResult.passed) {
        log.warn(`Job #${jobId} FAILED verification`, { failures: verResult.failures })
        if (verResult.suspicious) {
          await sendAlert(`Suspicious job #${jobId}: ${verResult.failures.join(', ')}`)
        }
        return
      }

      // Step 2: LLM reasoning
      const llmDecision = await llmAgent.decide(event, verResult)

      log.info(`LLM decision for job #${jobId}`, {
        decision: llmDecision.decision,
        confidence: llmDecision.confidence,
        reasoning: llmDecision.reasoning.slice(0, 100),
        flags: llmDecision.flags,
      })

      if (llmDecision.decision !== 'PAY') {
        log.warn(`LLM rejected payment for job #${jobId}: ${llmDecision.reasoning}`)
        if (llmDecision.decision === 'ESCALATE') {
          await sendAlert(`LLM escalation — Job #${jobId}: ${llmDecision.reasoning}`)
        }
        return
      }

      // Step 3: Calculate scaled payment based on pool health.
      // The payment base is the engine-computed fee from the JobCompleted event
      // (event.amount, in micro-USDC) — authoritative and deterministic. The LLM
      // only decides PAY/REJECT, not the amount (its free-form number is unit-
      // ambiguous and must never directly control how much USDC leaves the pool).
      const poolBalance = Number(await client.contracts.feePool.getBalance())
      const scaledAmount = AmountCalculator.calculateScaled(event.amount, poolBalance)
      const healthFactor = AmountCalculator.getHealthFactor(poolBalance)

      const agentEndpoint = await getAgentEndpoint(client, event.agentWallet)

      if (scaledAmount > 0) {
        // Pool has funds — pay executor with scaled amount
        const payResult = await payExecutor.execute({
          jobId,
          devWallet: event.devWallet,
          agentWallet: event.agentWallet,
          amount: scaledAmount,
          agentType: event.agentType,
          reasoning: llmDecision.reasoning,
        })

        log.info(`Payment executed for job #${jobId}`, {
          paymentTx: payResult.paymentTxHash,
          ledgerTx: payResult.ledgerTxHash,
          amount: scaledAmount / 1e6 + ' USDC',
          healthFactor: healthFactor.toFixed(2),
        })

        if (agentEndpoint) {
          await receiptSender.send({
            jobId,
            agentEndpoint,
            devWallet: event.devWallet,
            amount: scaledAmount,
            agentType: event.agentType,
            paymentTxHash: payResult.paymentTxHash,
            ledgerTxHash: payResult.ledgerTxHash,
            reasoning: llmDecision.reasoning,
          })
          log.info(`x402 receipt sent to ${agentEndpoint} for job #${jobId}`)
        }
      } else {
        // Pool empty — executor worked for free, send $0 receipt
        log.info(`Job #${jobId} — executor unpaid (pool health: ${healthFactor.toFixed(2)})`)

        if (agentEndpoint) {
          await receiptSender.send({
            jobId,
            agentEndpoint,
            devWallet: event.devWallet,
            amount: 0,
            agentType: event.agentType,
            paymentTxHash: '0x' + '0'.repeat(64),
            ledgerTxHash: '0x' + '0'.repeat(64),
            reasoning: `Executor job verified and approved. Pool depleted — working for free. ${llmDecision.reasoning}`,
          })
          log.info(`$0 receipt sent to ${agentEndpoint} for job #${jobId}`)
        }
      }

    } catch (err: any) {
      log.error(`Fatal error processing job #${jobId}`, { error: err.message, stack: err.stack })
      await sendAlert(`Orchestrator error on job #${jobId}: ${err.message}`)
    }
  })

  await watcher.start()
  log.info('Event watcher started — listening for JobCompleted events')

  // Health check server
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      const balance = Number(await client.contracts.feePool.getBalance()) / 1e6
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'running',
        wallet: client.wallet.address,
        feePool: balance + ' USDC',
        processed: processed.count(),
      }))
    } else {
      res.writeHead(404); res.end()
    }
  })
  server.listen(CONFIG.PORT, () => log.info(`Health check: http://localhost:${CONFIG.PORT}/health`))

  process.on('SIGINT', () => {
    log.info('Shutting down orchestrator...')
    watcher.stop()
    deadlineWatcher.stop()
    poolMonitor.stop()
    server.close()
    process.exit(0)
  })
}

async function getAgentEndpoint(client: ChainClient, wallet: string): Promise<string | null> {
  const override = CONFIG.AGENT_ENDPOINT_OVERRIDES[wallet.toLowerCase()]
  if (override) {
    log.debug(`Using endpoint override for ${wallet.slice(0, 10)}`, { url: override })
    return override
  }
  try {
    const agent = await client.contracts.registry.getAgent(wallet)
    return agent.endpoint || null
  } catch { return null }
}

async function sendAlert(message: string): Promise<void> {
  if (!CONFIG.ALERT_WEBHOOK_URL) return
  try {
    await fetch(CONFIG.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `ORBIT ORCHESTRATOR ALERT: ${message}` }),
    })
  } catch { /* Alert failure is non-fatal */ }
}

main().catch(err => {
  console.error('FATAL orchestrator error:', err)
  process.exit(1)
})
