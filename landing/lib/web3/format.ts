import { formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from './contracts'

/** Format a 6-decimal USDC bigint into a human string. */
export function fmtUSDC(value: bigint | undefined, dp = 2): string {
  if (value === undefined) return '—'
  const n = Number(formatUnits(value, USDC_DECIMALS))
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })
}

/** Raw numeric value of a USDC bigint. */
export function numUSDC(value: bigint | undefined): number {
  if (value === undefined) return 0
  return Number(formatUnits(value, USDC_DECIMALS))
}

/** Parse a user-typed USDC amount string into a 6-decimal bigint. */
export function parseUSDC(value: string): bigint {
  return parseUnits(value || '0', USDC_DECIMALS)
}

/** Format raw share bigint (18 decimals in the vault) for display. */
export function fmtShares(value: bigint | undefined, dp = 4): string {
  if (value === undefined) return '—'
  const n = Number(formatUnits(value, 18))
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })
}

/** APY stored as basis-point-ish integer (e.g. 850 = 8.50%). */
export function fmtAPY(bps: bigint | undefined): string {
  if (bps === undefined) return '—'
  return `${(Number(bps) / 100).toFixed(2)}%`
}

export function truncateAddress(addr?: string): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
