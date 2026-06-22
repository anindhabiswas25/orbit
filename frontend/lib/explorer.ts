// Snowtrace (Avalanche Fuji testnet) explorer link helpers.
// The base can be overridden by the backend /api/meta response, but defaults
// here keep links working before meta loads.

export const EXPLORER_BASE = 'https://testnet.snowtrace.io';

export function txUrl(hash: string, base: string = EXPLORER_BASE): string {
  return `${base}/tx/${hash}`;
}

export function addressUrl(addr: string, base: string = EXPLORER_BASE): string {
  return `${base}/address/${addr}`;
}

/** Shorten a hash/address for display: 0x1234… abcd */
export function shorten(value: string, lead = 6, tail = 4): string {
  if (!value) return '';
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
