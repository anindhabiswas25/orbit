export interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  label: string
}

/**
 * Exponential-backoff retry for RPC calls. Fuji RPC can have transient
 * failures — wrap critical chain calls in this.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: Error = new Error('Unknown error')
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < opts.maxAttempts) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt - 1)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw new Error(`${opts.label} failed after ${opts.maxAttempts} attempts: ${lastError.message}`)
}
