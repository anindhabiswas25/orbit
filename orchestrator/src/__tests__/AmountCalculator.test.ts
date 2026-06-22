jest.mock('../config', () => ({
  CONFIG: {
    MAX_PAYMENT_USDC: 100_000,
    MIN_POOL_RESERVE: 10_000_000,
    OPTIMAL_POOL_BALANCE: 100_000_000,
    MIN_HEALTH_FACTOR: 0.10,
    MIN_PAYMENT_USDC: 10_000,
  },
}))

import { AmountCalculator } from '../payment/AmountCalculator'

describe('AmountCalculator', () => {
  it('calculates payment from vault balance and fee', () => {
    const result = AmountCalculator.calculate(100_000_000, 50)
    expect(result).toBe(100_000)
  })

  it('returns raw amount when below max', () => {
    const result = AmountCalculator.calculate(10_000_000, 50)
    expect(result).toBe(50_000)
  })

  it('handles zero vault balance', () => {
    const result = AmountCalculator.calculate(0, 50)
    expect(result).toBe(0)
  })

  it('handles zero fee', () => {
    const result = AmountCalculator.calculate(100_000_000, 0)
    expect(result).toBe(0)
  })

  it('verify returns true when amounts match', () => {
    const result = AmountCalculator.verify(50_000, 10_000_000, 50)
    expect(result).toBe(true)
  })

  it('verify returns true within 1 unit rounding', () => {
    const result = AmountCalculator.verify(50_001, 10_000_000, 50)
    expect(result).toBe(true)
  })

  it('verify returns false when amounts differ by more than 1', () => {
    const result = AmountCalculator.verify(60_000, 10_000_000, 50)
    expect(result).toBe(false)
  })
})

describe('AmountCalculator — Dynamic Scaling', () => {
  describe('getHealthFactor', () => {
    it('returns 1.0 when pool is at optimal balance', () => {
      expect(AmountCalculator.getHealthFactor(110_000_000)).toBe(1.0)
    })

    it('returns 0.5 when pool is halfway between reserve and optimal', () => {
      // available = 60M - 10M = 50M, factor = 50M / 100M = 0.5
      expect(AmountCalculator.getHealthFactor(60_000_000)).toBe(0.5)
    })

    it('returns MIN_HEALTH_FACTOR when pool is just above reserve', () => {
      // available = 12M - 10M = 2M, factor = 2M / 100M = 0.02, clamped to 0.10
      expect(AmountCalculator.getHealthFactor(12_000_000)).toBe(0.10)
    })

    it('returns 0 when pool is at MIN_RESERVE', () => {
      expect(AmountCalculator.getHealthFactor(10_000_000)).toBe(0)
    })

    it('returns 0 when pool is below MIN_RESERVE', () => {
      expect(AmountCalculator.getHealthFactor(5_000_000)).toBe(0)
    })

    it('returns 0 when pool is empty', () => {
      expect(AmountCalculator.getHealthFactor(0)).toBe(0)
    })

    it('caps at 1.0 when pool exceeds optimal', () => {
      expect(AmountCalculator.getHealthFactor(200_000_000)).toBe(1.0)
    })
  })

  describe('calculateScaled', () => {
    it('returns full amount when pool is at optimal', () => {
      expect(AmountCalculator.calculateScaled(100_000, 110_000_000)).toBe(100_000)
    })

    it('returns half amount when pool health is 0.5', () => {
      // pool=60M, health=0.5, scaled = floor(100_000 * 0.5) = 50_000
      expect(AmountCalculator.calculateScaled(100_000, 60_000_000)).toBe(50_000)
    })

    it('returns 10% amount when pool is near reserve (floored at MIN_HEALTH_FACTOR)', () => {
      // pool=12M, health=0.02 clamped to 0.10, scaled = floor(100_000 * 0.10) = 10_000
      expect(AmountCalculator.calculateScaled(100_000, 12_000_000)).toBe(10_000)
    })

    it('returns 0 when pool is at MIN_RESERVE', () => {
      expect(AmountCalculator.calculateScaled(100_000, 10_000_000)).toBe(0)
    })

    it('returns 0 when pool is empty', () => {
      expect(AmountCalculator.calculateScaled(100_000, 0)).toBe(0)
    })

    it('returns 0 when scaled amount is below MIN_PAYMENT_USDC', () => {
      // base=5_000, pool=60M, health=0.5, scaled=floor(5000*0.5)=2500 < 10_000 → 0
      expect(AmountCalculator.calculateScaled(5_000, 60_000_000)).toBe(0)
    })

    it('returns 0 for zero base amount', () => {
      expect(AmountCalculator.calculateScaled(0, 110_000_000)).toBe(0)
    })
  })
})
