import assert from "node:assert/strict";
import test from "node:test";
import { recommendationProfileEventTypes, recommendationProfileHistoryLimit, recommendationProfileQuery } from "../src/lib/recommendation-profile-query";

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
