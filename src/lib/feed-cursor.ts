import { createHmac, timingSafeEqual } from "node:crypto";
import type { FeedCursor } from "@/lib/discovery-feed";
import type { RecommendationCategory } from "@/lib/recommendation-event-validation";

export class InvalidFeedCursorError extends Error {}

function signature(payload: string, userId: string, secret: string) {
  return createHmac("sha256", secret).update(`feed-cursor\n${userId}\n${payload}`).digest("base64url");
}

/** The cursor carries retrieval seeds and credit IDs, so it is bound to the account that received it. */
export function encodeFeedCursor(value: unknown, userId: string, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, userId, secret)}`;
}

/**
 * Returns the cursor's JSON, or null for a cursor issued before signing (the caller restarts the
 * feed rather than trusting it). A tampered or foreign cursor is rejected.
 */
export function readFeedCursor(value: string, userId: string, secret: string): unknown {
  if (value.length > 8192) throw new InvalidFeedCursorError();
  const separator = value.lastIndexOf(".");
  if (separator < 0) return null;
  const payload = value.slice(0, separator);
  const expected = Buffer.from(signature(payload, userId, secret));
  const actual = Buffer.from(value.slice(separator + 1));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InvalidFeedCursorError();
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new InvalidFeedCursorError(); }
}

export function feedCursorSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to sign discovery cursors.");
  return secret;
}

/** Strict schema check of a decoded cursor; anything unexpected is rejected rather than repaired. */
export function validateFeedCursor(value: unknown, category: RecommendationCategory): FeedCursor {
  try {
    const cursor = value as FeedCursor;
    if (!cursor || typeof cursor !== "object") throw new Error();
    if (cursor.category !== category || !Array.isArray(cursor.streams) || cursor.streams.length > 6) throw new Error();
    const keys = new Set<string>();
    for (const stream of cursor.streams) {
      if (!stream || !["tmdb", "theporndb", "stashdb"].includes(stream.source) || !["popular", "personalized", "related", "person", "company"].includes(stream.lane)) throw new Error();
      if ((category === "Adult") === (stream.source === "tmdb")) throw new Error();
      if (stream.source === "theporndb" ? !["scene", "movie"].includes(stream.kind ?? "") || stream.lane !== "popular" : stream.kind !== undefined) throw new Error();
      if (!Number.isSafeInteger(stream.page) || stream.page < 1 || stream.page > 501 || typeof stream.done !== "boolean") throw new Error();
      if (!Array.isArray(stream.features) || stream.features.length > 2 || !stream.features.every(feature => typeof feature === "string" && feature.length <= 200 && (stream.source === "stashdb" ? /^[A-Za-z0-9_-]+$/.test(feature) : /^(genre:.+|(actor|director|writer|creator|company):[1-9]\d*)$/.test(feature)))) throw new Error();
      if (stream.lane === "related") {
        if (category !== "Shows" || stream.source !== "tmdb" || !/^tmdb-tv-[1-9]\d*$/.test(stream.seedItemId ?? "") || !stream.seedEventId || stream.seedEventId.length > 200 || stream.features.length) throw new Error();
      } else if (stream.seedItemId !== undefined || stream.seedEventId !== undefined) throw new Error();
      if (["person", "company"].includes(stream.lane) && (stream.source !== "tmdb" || stream.features.length !== 1 || !(stream.lane === "company" ? /^company:/ : /^(actor|director|writer|creator):/).test(stream.features[0]))) throw new Error();
      if (stream.lane === "popular" && stream.features.length || ["personalized", "person", "company"].includes(stream.lane) && !stream.features.length) throw new Error();
      if (!(stream.retryAt === null || typeof stream.retryAt === "number" && Number.isFinite(stream.retryAt))) throw new Error();
      if (!(stream.fingerprint === null || typeof stream.fingerprint === "string" && /^[a-f0-9]{64}$/.test(stream.fingerprint))) throw new Error();
      const key = `${stream.source}:${stream.kind ?? ""}:${stream.lane}:${stream.seedItemId ?? ""}`;
      if (keys.has(key)) throw new Error();
      keys.add(key);
    }
    return cursor;
  } catch { throw new InvalidFeedCursorError(); }
}
