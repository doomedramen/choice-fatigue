import assert from "node:assert/strict";
import test from "node:test";
import { stashDbPeople, thePornDbPeople, tmdbPeople } from "../src/lib/media-people";

test("normalizes movie and aggregate TV cast with safe headshots", () => {
  const cast = [{ name: "Actor", character: "Lead", roles: [{ character: "TV Lead" }], profile_path: "/portrait.jpg" }, { name: "Actor", profile_path: "/duplicate.jpg" }, { name: "No Image", profile_path: "//bad.example/image.jpg" }];
  assert.deepEqual(tmdbPeople({ credits: { cast } }, "movie"), [{ name: "Actor", role: "Lead", imageUrl: "https://image.tmdb.org/t/p/w185/portrait.jpg" }, { name: "No Image" }]);
  assert.equal(tmdbPeople({ aggregate_credits: { cast } }, "tv")[0].role, "TV Lead");
  assert.equal(tmdbPeople({ credits: { cast } }, "tv").length, 0);
});

test("normalizes Adult performers and never exposes credential-bearing image URLs", () => {
  assert.deepEqual(thePornDbPeople({ performers: [{ name: "A", face: "https://example.test/face.jpg?token=secret", image: "https://example.test/public.jpg" }, null, { name: "B" }] }), [{ name: "A", imageUrl: "https://example.test/public.jpg" }, { name: "B" }]);
  assert.deepEqual(stashDbPeople({ performers: [{ as: "Alias", performer: { name: "C", images: [{ url: "https://example.test/c.jpg" }] } }] }), [{ name: "C", role: "as Alias", imageUrl: "https://example.test/c.jpg" }]);
  assert.deepEqual(stashDbPeople({ performers: [] }), []);
  assert.equal(thePornDbPeople({ performers: Array.from({ length: 30 }, (_, i) => ({ name: `Person ${i}` })) }).length, 15);
});
