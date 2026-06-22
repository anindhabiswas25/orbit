import { CONFIG } from '../config'

export class AmountCalculator {
  static calculate(vaultBalanceUnits: number, agentFeeBps: number): number {
    const raw = Math.floor((vaultBalanceUnits * agentFeeBps) / 10_000)
    return Math.min(raw, CONFIG.MAX_PAYMENT_USDC)
  }

  static calculateScaled(baseAmount: number, poolBalanceUnits: number): number {
    const available = poolBalanceUnits - CONFIG.MIN_POOL_RESERVE
    if (available <= 0) return 0

    const healthFactor = Math.min(available / CONFIG.OPTIMAL_POOL_BALANCE, 1.0)
    const clamped = Math.max(healthFactor, CONFIG.MIN_HEALTH_FACTOR)
    const scaled = Math.floor(baseAmount * clamped)

    if (scaled < CONFIG.MIN_PAYMENT_USDC) return 0
    return scaled
  }

  static getHealthFactor(poolBalanceUnits: number): number {
    const available = poolBalanceUnits - CONFIG.MIN_POOL_RESERVE
    if (available <= 0) return 0
    return Math.min(Math.max(available / CONFIG.OPTIMAL_POOL_BALANCE, CONFIG.MIN_HEALTH_FACTOR), 1.0)
  }

  static verify(claimed: number, vaultBalance: number, agentFeeBps: number): boolean {
    const expected = AmountCalculator.calculate(vaultBalance, agentFeeBps)
    return Math.abs(claimed - expected) <= 1
  }
}
