import OpenAI from 'openai'
import { CONFIG } from '../config'
import { ORCHESTRATOR_SYSTEM_PROMPT, buildDecisionPrompt } from './RuleSystem'
import { ContextBuilder } from './ContextBuilder'
import { DecisionParser, LLMDecision } from './DecisionParser'
import { AmountCalculator } from '../payment/AmountCalculator'
import { JobCompletedEvent } from '../chain/EventWatcher'
import { VerificationResult } from '../verification/VerificationEngine'
import { ChainClient } from '../chain/ChainClient'
import { Logger } from '../logger/Logger'

const log = new Logger('llm-agent')

export class LLMAgent {
  private client: OpenAI
  private builder: ContextBuilder
  private chainClient: ChainClient

  constructor(chainClient: ChainClient) {
    this.chainClient = chainClient
    this.client = new OpenAI({
      apiKey: CONFIG.GROQ_API_KEY,
      baseURL: CONFIG.GROQ_BASE_URL,
    })
    this.builder = new ContextBuilder(chainClient)
  }

  async decide(
    event: JobCompletedEvent,
    verResult: VerificationResult
  ): Promise<LLMDecision> {
    const startMs = Date.now()

    try {
      const context = await this.builder.build(event, verResult)

      log.debug('Calling Groq LLM for job decision', { jobId: event.jobId })

      const response = await this.client.chat.completions.create({
        model: CONFIG.LLM_MODEL,
        max_tokens: CONFIG.LLM_MAX_TOKENS,
        messages: [
          {
            role: 'system',
            content: ORCHESTRATOR_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildDecisionPrompt(context),
          }
        ],
      })

      const raw = response.choices[0]?.message?.content ?? ''

      const decision = DecisionParser.parse(raw)

      log.info('LLM decision received', {
        jobId: event.jobId,
        decision: decision.decision,
        confidence: decision.confidence,
        elapsedMs: Date.now() - startMs,
        model: CONFIG.LLM_MODEL,
        tokens: response.usage?.total_tokens ?? 0,
      })

      return decision

    } catch (err: any) {
      log.error('LLM call failed — using rule-based fallback', {
        jobId: event.jobId,
        error: err.message,
      })

      if (verResult.passed && !verResult.suspicious) {
        const poolBalance = Number(await this.chainClient.contracts.feePool.getBalance())
        const baseAmount = AmountCalculator.calculate(event.amount, 50)
        const amount = AmountCalculator.calculateScaled(baseAmount, poolBalance)
        const healthFactor = AmountCalculator.getHealthFactor(poolBalance)
        log.warn('LLM unavailable — auto-paying verified executor job via rule fallback', {
          jobId: event.jobId, amount: amount / 1e6 + ' USDC', healthFactor: healthFactor.toFixed(2),
        })
        return {
          decision: 'PAY',
          confidence: 0.6,
          amount,
          reasoning: `LLM unavailable (${err.message.slice(0, 80)}). All ${Object.keys(verResult.checks).length} deterministic checks passed. Pool health: ${healthFactor.toFixed(2)}. Auto-approving via rule fallback.`,
          flags: ['llm_failure', 'rule_fallback'],
          ruleRefs: ['RULE_VERIFY_PASS'],
        }
      }

      return {
        decision: 'REJECT',
        confidence: 0,
        amount: 0,
        reasoning: `LLM call failed: ${err.message}. Defaulting to REJECT for safety.`,
        flags: ['llm_failure'],
        ruleRefs: [],
      }
    }
  }
}
