import { DecisionParser } from '../llm/DecisionParser'

describe('DecisionParser', () => {
  it('parses a valid PAY response', () => {
    const raw = JSON.stringify({
      decision: 'PAY',
      confidence: 0.99,
      amount: 100000,
      reasoning: 'Scout correctly identified best protocol. All checks passed. Payment authorized per RULE 4.',
      flags: [],
      rule_refs: ['RULE 4'],
    })
    const decision = DecisionParser.parse(raw)
    expect(decision.decision).toBe('PAY')
    expect(decision.amount).toBe(100000)
    expect(decision.confidence).toBe(0.99)
    expect(decision.ruleRefs).toContain('RULE 4')
  })

  it('parses a REJECT response', () => {
    const raw = JSON.stringify({
      decision: 'REJECT',
      confidence: 1.0,
      amount: 0,
      reasoning: 'Verification failed — job status is not Completed. Payment rejected per RULE 1.',
      flags: ['verification_failed'],
      rule_refs: ['RULE 1'],
    })
    const decision = DecisionParser.parse(raw)
    expect(decision.decision).toBe('REJECT')
    expect(decision.amount).toBe(0)
  })

  it('strips markdown code fences', () => {
    const raw = '```json\n' + JSON.stringify({
      decision: 'PAY',
      confidence: 0.95,
      amount: 50000,
      reasoning: 'Valid scout job completion. All deterministic checks passed. No anomalies detected.',
      flags: [],
      rule_refs: [],
    }) + '\n```'
    const decision = DecisionParser.parse(raw)
    expect(decision.decision).toBe('PAY')
  })

  it('throws on invalid decision value', () => {
    expect(() => DecisionParser.parse(JSON.stringify({
      decision: 'MAYBE', confidence: 0.5, amount: 0,
      reasoning: 'Not sure about this one — need more data to make a determination.',
      flags: [],
    }))).toThrow('Invalid decision value')
  })

  it('allows PAY with zero amount (executor pool empty)', () => {
    const raw = JSON.stringify({
      decision: 'PAY', confidence: 0.9, amount: 0,
      reasoning: 'Executor job verified. Pool depleted — executor working for free. All checks passed.',
      flags: [],
      rule_refs: ['RULE 7'],
    })
    const decision = DecisionParser.parse(raw)
    expect(decision.decision).toBe('PAY')
    expect(decision.amount).toBe(0)
  })

  it('throws on PAY with negative amount', () => {
    expect(() => DecisionParser.parse(JSON.stringify({
      decision: 'PAY', confidence: 0.9, amount: -100,
      reasoning: 'This should fail validation because amount is negative despite PAY decision.',
      flags: [],
    }))).toThrow('PAY decision must have non-negative amount')
  })

  it('throws on PAY with amount exceeding max', () => {
    expect(() => DecisionParser.parse(JSON.stringify({
      decision: 'PAY', confidence: 0.9, amount: 200000,
      reasoning: 'This should fail because amount 200000 exceeds MAX_PAYMENT_USDC of 100000.',
      flags: [],
    }))).toThrow('exceeds MAX_PAYMENT_USDC')
  })

  it('throws on invalid JSON', () => {
    expect(() => DecisionParser.parse('not json at all')).toThrow('not valid JSON')
  })

  it('throws on reasoning too short', () => {
    expect(() => DecisionParser.parse(JSON.stringify({
      decision: 'PAY', confidence: 0.9, amount: 100000,
      reasoning: 'too short',
      flags: [],
    }))).toThrow('Reasoning too short')
  })
})
