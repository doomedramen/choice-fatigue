import { createHmac, timingSafeEqual } from "node:crypto";

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
