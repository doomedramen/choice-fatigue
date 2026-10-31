import assert from "node:assert/strict";
import test from "node:test";
import { createClientUuid } from "../src/lib/client-uuid";

test("uses a secure UUID fallback when randomUUID is unavailable", () => {
  const crypto = {
    getRandomValues(bytes: Uint8Array) {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return bytes;
    },
  };

  assert.equal(createClientUuid(crypto), "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("prefers the platform randomUUID implementation when available", () => {
  const crypto = {
    randomUUID: () => "platform-generated-uuid",
    getRandomValues: (_bytes: Uint8Array) => { throw new Error("fallback should not be used"); },
  };

  assert.equal(createClientUuid(crypto), "platform-generated-uuid");
});
