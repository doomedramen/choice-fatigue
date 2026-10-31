/**
 * Adult pairing: who is on screen, derived from performer genders (or, failing that, tags).
 * Pairing is a strong, stable preference, so the ranker weighs it above any single tag, and an
 * account can hide pairings outright. Derived when a title is fetched; never stored.
 */
export const adultPairingKeys = ["pairing:women", "pairing:men", "pairing:mixed", "pairing:trans"] as const;
export type AdultPairingKey = (typeof adultPairingKeys)[number];

export const adultPairingLabels: Record<AdultPairingKey, string> = {
  "pairing:women": "Women only",
  "pairing:men": "Men only",
  "pairing:mixed": "Mixed",
  "pairing:trans": "Trans performers",
};

type Gender = "woman" | "man" | "trans";

/** StashDB enums (MALE, TRANSGENDER_FEMALE, …) and ThePornDB strings ("Female", "Trans woman", …). */
function normalizeGender(value: unknown): Gender | null {
  if (typeof value !== "string") return null;
  const gender = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/\btrans/.test(gender)) return "trans";
  if (/^(female|woman|f)$/.test(gender)) return "woman";
  if (/^(male|man|m)$/.test(gender)) return "man";
  return null;
}

const tagPairings: Array<[RegExp, AdultPairingKey]> = [
  [/^(gay|gay sex|male on male|man on man)$/, "pairing:men"],
  [/^(lesbian|lesbian sex|girl on girl|female on female)$/, "pairing:women"],
  [/^(straight|hetero|heterosexual|boy girl|boy\/girl|bg)$/, "pairing:mixed"],
  [/^(trans|transgender|transsexual|shemale|tgirl|trans woman|trans man)$/, "pairing:trans"],
];

/**
 * Women only, men only, or mixed, plus a separate trans flag. Performer genders decide; tags are a
 * fallback only when no performer gender is known. No signal at all is neutral (no keys).
 */
export function adultPairingFromCast(genders: unknown[], tags: string[] = []): AdultPairingKey[] {
  const known = genders.map(normalizeGender).filter((gender): gender is Gender => gender !== null);
  if (known.length) {
    const keys: AdultPairingKey[] = [];
    const women = known.includes("woman"), men = known.includes("man");
    if (women && men) keys.push("pairing:mixed");
    else if (women) keys.push("pairing:women");
    else if (men) keys.push("pairing:men");
    if (known.includes("trans")) keys.push("pairing:trans");
    return keys;
  }
  const normalizedTags = tags.map(tag => tag.trim().toLowerCase().replace(/\s+/g, " "));
  return [...new Set(tagPairings.filter(([pattern]) => normalizedTags.some(tag => pattern.test(tag))).map(([, key]) => key))];
}

export function isAdultPairingKey(value: unknown): value is AdultPairingKey {
  return typeof value === "string" && (adultPairingKeys as readonly string[]).includes(value);
}

/** Validates a saved setting: a de-duplicated list of known pairing keys, or null when malformed. */
export function parseHiddenPairings(value: unknown): AdultPairingKey[] | null {
  if (!Array.isArray(value) || value.length > adultPairingKeys.length || !value.every(isAdultPairingKey)) return null;
  return [...new Set(value)];
}

/** An explicit hide always wins. Titles whose pairing is unknown are kept. */
export function withoutHiddenPairings<T extends { pairing?: string[] }>(items: T[], hidden: readonly string[]): T[] {
  if (!hidden.length) return items;
  const hiddenSet = new Set(hidden);
  return items.filter(item => !(item.pairing ?? []).some(key => hiddenSet.has(key)));
}
