import { recommendationPreferenceProfile, type RecommendationSignal } from "@/lib/recommendations";

export type CreditFeature = `actor:${number}` | `director:${number}` | `writer:${number}` | `creator:${number}` | `company:${number}`;
type Person = { id?: unknown; order?: unknown; job?: unknown; jobs?: Array<{ job?: unknown }> };
type Credits = { cast?: Person[]; crew?: Person[] };
type Metadata = { created_by?: Person[]; production_companies?: Person[]; credits?: Credits; aggregate_credits?: Credits };
const key = (role: string, id: unknown) => Number.isSafeInteger(id) && Number(id) > 0 ? `${role}:${id}` : "";

/** Stable, role-specific IDs only. Names and raw responses remain transient. */
export function creditFeatureKeys(metadata: Metadata, mediaType: "movie" | "tv"): string[] {
  const credits = mediaType === "tv" ? metadata.aggregate_credits : metadata.credits;
  const cast = [...(Array.isArray(credits?.cast) ? credits.cast : [])].sort((a, b) => (typeof a.order === "number" ? a.order : Infinity) - (typeof b.order === "number" ? b.order : Infinity));
  const crew = Array.isArray(credits?.crew) ? credits.crew : [];
  const jobs = (person: Person) => [person.job, ...(person.jobs ?? []).map(job => job.job)].filter((job): job is string => typeof job === "string");
  const roleIds = (role: string, people: Person[], limit: number) => [...new Set(people.map(person => key(role, person.id)).filter(Boolean))].slice(0, limit);
  return [
    ...roleIds("actor", cast, 5),
    ...roleIds("director", crew.filter(person => jobs(person).includes("Director")), 3),
    ...roleIds("writer", crew.filter(person => jobs(person).some(job => ["Writer", "Screenplay", "Story", "Teleplay"].includes(job))), 3),
    ...roleIds("creator", Array.isArray(metadata.created_by) ? metadata.created_by : [], 3),
    ...roleIds("company", Array.isArray(metadata.production_companies) ? metadata.production_companies : [], 3),
  ];
}

export function creditPreferences(signals: RecommendationSignal[]) {
  const positiveTitles = new Map<string, Set<string>>();
  for (const signal of signals) {
    if (!(signal.decision === "keep" || signal.decision === "seen" && (signal.rating ?? 0) >= 8)) continue;
    for (const feature of signal.featureKeys ?? []) {
      if (!/^(actor|director|writer|creator|company):[1-9]\d*$/.test(feature)) continue;
      const ids = positiveTitles.get(feature) ?? new Set<string>(); ids.add(signal.itemId); positiveTitles.set(feature, ids);
    }
  }
  return recommendationPreferenceProfile(signals).filter(entry => /^(actor|director|writer|creator|company):[1-9]\d*$/.test(entry.key))
    .map(entry => ({ ...entry, positiveTitles: positiveTitles.get(entry.key)?.size ?? 0 }));
}

export function creditBonus(features: string[], preferences: ReturnType<typeof creditPreferences>) {
  const scores = new Map(preferences.map(preference => [preference.key, preference.score]));
  const matched = features.filter(feature => scores.has(feature));
  if (!matched.length) return 0;
  return Math.max(-0.15, Math.min(0.15, matched.reduce((sum, feature) => sum + scores.get(feature)!, 0) / matched.length * 0.15));
}
