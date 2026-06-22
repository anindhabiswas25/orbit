// Snowtrace (Avalanche Fuji testnet) explorer link helpers for the Tracking page.

export const SNOWTRACE_BASE = 'https://testnet.snowtrace.io'

export function txUrl(hash?: string | null, base: string = SNOWTRACE_BASE): string | null {
  return hash ? `${base}/tx/${hash}` : null
}

export function addressUrl(addr?: string | null, base: string = SNOWTRACE_BASE): string | null {
  return addr ? `${base}/address/${addr}` : null
}
