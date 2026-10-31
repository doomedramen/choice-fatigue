/**
 * In-memory token buckets. Choice Fatigue runs as a single self-hosted process, so per-process state
 * is enough to stop one account flooding a write endpoint; it resets on restart.
 */
export type TokenBuckets = Map<string, { tokens: number; updatedAt: number }>;

export function takeToken(buckets: TokenBuckets, key: string, capacity: number, refillMs: number, now = Date.now()) {
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const tokens = Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) / refillMs);
  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfterSeconds: Math.ceil(((1 - tokens) * refillMs) / 1000) };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > 10_000) for (const [staleKey, stale] of buckets) if (now - stale.updatedAt > capacity * refillMs) buckets.delete(staleKey);
  return { allowed: true, retryAfterSeconds: 0 };
}
