import { Logger } from '../logger/Logger'

const log = new Logger('retry')

interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  label: string
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      if (attempt < opts.maxAttempts) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt - 1)
        log.warn(`${opts.label} attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${delay}ms`, {
          error: err.message,
        })
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError!
}
