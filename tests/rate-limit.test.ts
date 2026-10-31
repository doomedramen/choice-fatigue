import assert from "node:assert/strict";
import test from "node:test";
import { takeToken, type TokenBuckets } from "../src/lib/rate-limit";

test("a burst beyond capacity is refused with a retry delay, then tokens refill over time", () => {
  const buckets: TokenBuckets = new Map();
  for (let index = 0; index < 20; index++) assert.equal(takeToken(buckets, "user", 20, 500, 0).allowed, true);
  const refused = takeToken(buckets, "user", 20, 500, 0);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 1);
  assert.equal(takeToken(buckets, "other-user", 20, 500, 0).allowed, true, "accounts have separate buckets");
  assert.equal(takeToken(buckets, "user", 20, 500, 600).allowed, true, "a token returns after the refill interval");
});
