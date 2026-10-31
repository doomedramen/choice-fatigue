import assert from "node:assert/strict";
import test from "node:test";
import { providerArtworkUrl } from "../src/lib/provider-artwork";

test("uses the first public HTTPS image without credentials or query parameters", () => {
  assert.equal(providerArtworkUrl(null, "https://images.example.test/poster.jpg"), "https://images.example.test/poster.jpg");
  for (const url of ["http://images.example.test/a.jpg", "https://user:secret@example.test/a.jpg", "https://images.example.test/a.jpg?token=secret", "data:image/png;base64,abc"]) assert.equal(providerArtworkUrl(url), undefined);
});
