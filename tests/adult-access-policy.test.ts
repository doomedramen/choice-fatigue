import assert from "node:assert/strict";
import test from "node:test";
import { adultAccessEnabled } from "../src/lib/adult-access-policy";

test("Adult access requires both the instance switch and account grant", () => {
  assert.equal(adultAccessEnabled(false, false), false);
  assert.equal(adultAccessEnabled(false, true), false);
  assert.equal(adultAccessEnabled(true, false), false);
  assert.equal(adultAccessEnabled(true, true), true);
});
