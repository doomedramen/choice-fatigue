import assert from "node:assert/strict";
import test from "node:test";
import { hasUsableTmdbDiscoveryMetadata } from "../src/lib/tmdb-discovery-quality";

test("filters an undated, imageless entry even when it has a vague synopsis", () => {
  assert.equal(hasUsableTmdbDiscoveryMetadata("", null, "Plot to be announced."), false);
  assert.equal(hasUsableTmdbDiscoveryMetadata("2022-12-01", null, "A real synopsis."), true);
  assert.equal(hasUsableTmdbDiscoveryMetadata("", "/poster.jpg", ""), true);
  assert.equal(hasUsableTmdbDiscoveryMetadata("2022-12-01", null, ""), false);
  assert.equal(hasUsableTmdbDiscoveryMetadata("0000-00-00", "/invalid?secret=1", "Plot to be announced."), false);
});
