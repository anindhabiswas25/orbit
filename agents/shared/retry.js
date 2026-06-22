// Exponential backoff retry for RPC calls.
// Fuji RPC can have transient failures — always wrap critical calls.

async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[retry] ${label} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms. Error: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

module.exports = { withRetry };
