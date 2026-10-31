import assert from "node:assert/strict";
import test from "node:test";
import { adultPairingFromCast, parseHiddenPairings, withoutHiddenPairings } from "../src/lib/adult-pairing";

test("performer genders decide the pairing, from either provider's vocabulary", () => {
  assert.deepEqual(adultPairingFromCast(["FEMALE", "FEMALE"]), ["pairing:women"]);
  assert.deepEqual(adultPairingFromCast(["Male", "male"]), ["pairing:men"]);
  assert.deepEqual(adultPairingFromCast(["MALE", "Female"]), ["pairing:mixed"]);
  assert.deepEqual(adultPairingFromCast(["TRANSGENDER_FEMALE", "MALE"]), ["pairing:men", "pairing:trans"]);
  assert.deepEqual(adultPairingFromCast(["Trans woman"]), ["pairing:trans"]);
  assert.deepEqual(adultPairingFromCast(["NON_BINARY", null, 3]), [], "unknown genders are neutral");
});

test("tags are only a fallback when no performer gender is known", () => {
  assert.deepEqual(adultPairingFromCast([], ["Gay", "Outdoors"]), ["pairing:men"]);
  assert.deepEqual(adultPairingFromCast([], ["lesbian"]), ["pairing:women"]);
  assert.deepEqual(adultPairingFromCast([], ["Boy Girl"]), ["pairing:mixed"]);
  assert.deepEqual(adultPairingFromCast(["FEMALE", "MALE"], ["Gay"]), ["pairing:mixed"], "known genders win over a mis-tag");
  assert.deepEqual(adultPairingFromCast([], ["Drama"]), []);
});

test("a hidden pairing is removed, titles with unknown pairing stay, and settings are validated", () => {
  const items = [{ id: "a", pairing: ["pairing:men"] }, { id: "b", pairing: ["pairing:women"] }, { id: "c" }, { id: "d", pairing: ["pairing:mixed", "pairing:trans"] }];
  assert.deepEqual(withoutHiddenPairings(items, ["pairing:men", "pairing:trans"]).map(item => item.id), ["b", "c"]);
  assert.equal(withoutHiddenPairings(items, []), items);
  assert.deepEqual(parseHiddenPairings(["pairing:men", "pairing:men"]), ["pairing:men"]);
  assert.equal(parseHiddenPairings(["pairing:everything"]), null);
  assert.equal(parseHiddenPairings("pairing:men"), null);
});
