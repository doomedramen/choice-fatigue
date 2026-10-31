import { assertTestNetworkTarget } from "@/lib/outbound-policy";

/** Provider throttles are kept in process memory; metadata and credentials are never cached. */
const cooldowns = new Map<string, number>();
let activeRequests = 0;
const waiters: Array<() => void> = [];

async function withProviderSlot<T>(request: () => Promise<T>): Promise<T> {
  if (activeRequests >= 4) await new Promise<void>(resolve => waiters.push(resolve));
  else activeRequests += 1;
  try { return await request(); }
  finally {
    const next = waiters.shift();
    if (next) next();
    else activeRequests -= 1;
  }
}
export class ProviderRequestError extends Error {
  constructor(public retryAt: number | null = null, public status: number | null = null) { super("Metadata provider request failed."); }
}

export function retryAfterTime(value: string | null, now = Date.now()): number {
  const seconds = value === null || !value.trim() ? Number.NaN : Number(value);
  const date = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : Number.isFinite(date) ? Math.max(now + 1000, date) : now + 30_000;
}

export async function requestProviderJson<T>(source: string, url: string, init: RequestInit = {}): Promise<T> {
  assertTestNetworkTarget(url);
  return withProviderSlot(async () => {
    const retryAt = cooldowns.get(source) ?? 0;
    if (retryAt > Date.now()) throw new ProviderRequestError(retryAt, 429);
    try {
      const response = await fetch(url, { ...init, ...(process.env.E2E_NETWORK_ISOLATION === "1" ? { redirect: "manual" as const } : {}), signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (response.status === 429) {
        const next = retryAfterTime(response.headers.get("retry-after"));
        cooldowns.set(source, next);
        throw new ProviderRequestError(next, 429);
      }
      if (!response.ok) throw new ProviderRequestError(null, response.status);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError();
    }
  });
}
