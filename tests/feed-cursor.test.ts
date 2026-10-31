import assert from "node:assert/strict";
import test from "node:test";
import { encodeFeedCursor, InvalidFeedCursorError, readFeedCursor, validateFeedCursor } from "../src/lib/feed-cursor";

const secret = "test-secret-at-least-32-characters-long";
const cursor = { category: "Movies", streams: [{ source: "tmdb", lane: "person", features: ["actor:7"], page: 2 }] };

test("a signed cursor round-trips for the account that received it", () => {
  assert.deepEqual(readFeedCursor(encodeFeedCursor(cursor, "user-a", secret), "user-a", secret), cursor);
});

test("tampered, foreign, and oversized cursors are rejected; pre-signing cursors restart", () => {
  const signed = encodeFeedCursor(cursor, "user-a", secret);
  assert.throws(() => readFeedCursor(signed, "user-b", secret), InvalidFeedCursorError);
  const forged = `${Buffer.from(JSON.stringify({ ...cursor, streams: [{ ...cursor.streams[0], features: ["actor:9"] }] })).toString("base64url")}.${signed.split(".")[1]}`;
  assert.throws(() => readFeedCursor(forged, "user-a", secret), InvalidFeedCursorError);
  assert.throws(() => readFeedCursor("x".repeat(9000), "user-a", secret), InvalidFeedCursorError);
  assert.equal(readFeedCursor(Buffer.from(JSON.stringify(cursor)).toString("base64url"), "user-a", secret), null);
});

test("cursor contents are schema-checked and bound to their category", () => {
  const valid = { category: "Movies", streams: [{ source: "tmdb", lane: "popular", features: [], page: 2, done: false, retryAt: null, fingerprint: null }] };
  assert.deepEqual(validateFeedCursor(valid, "Movies"), valid);
  assert.throws(() => validateFeedCursor(valid, "Shows"), InvalidFeedCursorError, "another category's cursor");
  assert.throws(() => validateFeedCursor({ ...valid, category: "Adult" }, "Adult"), InvalidFeedCursorError, "TMDB streams never serve Adult");
  assert.throws(() => validateFeedCursor({ ...valid, streams: [{ ...valid.streams[0], page: 900 }] }, "Movies"), InvalidFeedCursorError);
  assert.throws(() => validateFeedCursor({ ...valid, streams: [{ ...valid.streams[0], features: ["genre:drama"] }] }, "Movies"), InvalidFeedCursorError, "popular lanes carry no features");
  assert.throws(() => validateFeedCursor({ ...valid, streams: [valid.streams[0], valid.streams[0]] }, "Movies"), InvalidFeedCursorError, "duplicate lanes");
  assert.throws(() => validateFeedCursor(null, "Movies"), InvalidFeedCursorError);
});
