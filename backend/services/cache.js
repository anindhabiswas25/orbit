// 5-second in-memory cache to reduce RPC calls.
// All route handlers call cache.wrap() instead of calling chain.js directly.

const TTL_MS = 5_000;

const _store = new Map();

function wrap(key, fetchFn) {
  return async function (...args) {
    const cacheKey = args.length ? `${key}:${JSON.stringify(args)}` : key;
    const cached   = _store.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return cached.value;
    }
    const value = await fetchFn(...args);
    _store.set(cacheKey, { value, ts: Date.now() });
    return value;
  };
}

function invalidate(key) {
  for (const k of _store.keys()) {
    if (k === key || k.startsWith(`${key}:`)) _store.delete(k);
  }
}

module.exports = { wrap, invalidate };
