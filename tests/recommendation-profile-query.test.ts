import assert from "node:assert/strict";
import test from "node:test";
import { recommendationConsideredBeforeQuery, recommendationProfileEventTypes, recommendationProfileHistoryLimit, recommendationProfileQuery, recommendationTracePruneQuery } from "../src/lib/recommendation-profile-query";

test("profile reads are bounded, category-scoped, and skip trace payloads", () => {
  const query = recommendationProfileQuery("user", "Movies");
  assert.equal(query.take, recommendationProfileHistoryLimit);
  assert.deepEqual(query.where.category, "Movies");
  assert.equal(query.where.userId, "user");
  for (const column of ["candidateIds", "provenance", "retrievalId", "source", "lane"]) assert.equal(column in query.select, false, column);
  for (const traceType of ["item_shown", "candidate_batch", "retrieval_snapshot"]) assert.equal((recommendationProfileEventTypes as readonly string[]).includes(traceType), false, traceType);
  assert.ok((recommendationProfileEventTypes as readonly string[]).includes("save_withdrawn"));
  assert.equal(query.orderBy[0].occurredAt, "desc", "take keeps the newest evidence");
});

test("titles from before the capped window stay excluded through an ID-only query", () => {
  const before = new Date("2026-01-01T00:00:00.000Z");
  const query = recommendationConsideredBeforeQuery("user", "Shows", before);
  assert.deepEqual(query.select, { itemId: true });
  assert.deepEqual(query.distinct, ["itemId"]);
  assert.deepEqual(query.where.occurredAt, { lt: before });
  assert.deepEqual(query.where.eventType, { in: ["decision", "saved"] });
  assert.equal(query.where.category, "Shows");
});

test("pruning removes only this account's trace events older than 180 days", () => {
  const now = Date.parse("2026-10-31T00:00:00.000Z");
  const query = recommendationTracePruneQuery("user", now);
  assert.equal(query.where.userId, "user");
  assert.deepEqual(query.where.eventType.in, ["item_shown", "candidate_batch", "retrieval_snapshot"]);
  for (const kept of recommendationProfileEventTypes) assert.equal((query.where.eventType.in as readonly string[]).includes(kept), false, kept);
  assert.equal(query.where.occurredAt.lt.toISOString(), "2026-05-04T00:00:00.000Z");
});
