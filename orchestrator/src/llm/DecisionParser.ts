export interface LLMDecision {
  decision: 'PAY' | 'REJECT' | 'INVESTIGATE' | 'ESCALATE'
  confidence: number
  amount: number
  reasoning: string
  flags: string[]
  ruleRefs: string[]
}

export class DecisionParser {
  static parse(raw: string): LLMDecision {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      throw new Error(`LLM response is not valid JSON: ${raw.slice(0, 200)}`)
    }

    const validDecisions = ['PAY', 'REJECT', 'INVESTIGATE', 'ESCALATE']
    if (!validDecisions.includes(parsed.decision)) {
      throw new Error(`Invalid decision value: ${parsed.decision}`)
    }

    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      throw new Error(`Invalid confidence: ${parsed.confidence}`)
    }

    if (!parsed.reasoning || parsed.reasoning.length < 30) {
      throw new Error(`Reasoning too short: "${parsed.reasoning}"`)
    }

    if (parsed.decision === 'PAY') {
      if (typeof parsed.amount !== 'number' || parsed.amount < 0) {
        throw new Error(`PAY decision must have non-negative amount, got: ${parsed.amount}`)
      }
      if (parsed.amount > 100_000) {
        throw new Error(`Amount ${parsed.amount} exceeds MAX_PAYMENT_USDC (100000)`)
      }
    }

    return {
      decision: parsed.decision,
      confidence: parsed.confidence,
      amount: parsed.amount ?? 0,
      reasoning: parsed.reasoning,
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      ruleRefs: Array.isArray(parsed.rule_refs) ? parsed.rule_refs : [],
    }
  }
}
