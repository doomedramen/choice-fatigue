export type MergeableDiscoveryState = {
  sessionId?: string;
  eventSequence?: number;
  reviewId?: string | null;
  category: string;
  lockedItemId?: string | null;
  decisions: Record<string, unknown>;
  ratings?: Record<string, unknown>;
  shortlisted: string[];
  saved: string[];
  history: Array<{ id: string; eventId?: string; [key: string]: unknown }>;
  reviewRemoved: string[];
  view: string;
  ageVerified: boolean;
};

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeSet(base: string[], local: string[], remote: string[]) {
  const result = new Set(remote);
  const baseSet = new Set(base);
  const localSet = new Set(local);
  for (const id of baseSet) if (!localSet.has(id)) result.delete(id);
  for (const id of localSet) if (!baseSet.has(id)) result.add(id);
  return [...result];
}

function entryKey(entry: MergeableDiscoveryState["history"][number]) {
  return entry.eventId ? `event:${entry.eventId}` : `legacy:${JSON.stringify(entry)}`;
}

function mergeHistory(base: MergeableDiscoveryState["history"], local: MergeableDiscoveryState["history"], remote: MergeableDiscoveryState["history"]) {
  const baseCounts = new Map<string, number>();
  const localCounts = new Map<string, number>();
  const remoteCounts = new Map<string, number>();
  const values = new Map<string, MergeableDiscoveryState["history"][number]>();
  for (const [list, counts] of [[base, baseCounts], [local, localCounts], [remote, remoteCounts]] as const) {
    for (const entry of list) {
      const key = entryKey(entry);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      values.set(key, entry);
    }
  }
  for (const [key, count] of baseCounts) {
    const localCount = localCounts.get(key) ?? 0;
    if (localCount < count) remoteCounts.set(key, Math.max(0, (remoteCounts.get(key) ?? 0) - (count - localCount)));
  }
  for (const [key, count] of localCounts) {
    const baseCount = baseCounts.get(key) ?? 0;
    if (count > baseCount) remoteCounts.set(key, (remoteCounts.get(key) ?? 0) + (count - baseCount));
  }
  const merged: MergeableDiscoveryState["history"] = [];
  for (const [key, count] of remoteCounts) for (let index = 0; index < count; index += 1) merged.push(values.get(key)!);
  return merged;
}

function mergeRecord(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const result = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    const baseHas = Object.hasOwn(base, key);
    const localHas = Object.hasOwn(local, key);
    if (baseHas === localHas && sameValue(base[key], local[key])) continue;
    if (localHas) result[key] = local[key];
    else delete result[key];
  }
  return result;
}

/**
 * The lists merge independently, so restore the rules between them: a saved title is no longer on the
 * shortlist or in review removals, a removed title is not shortlisted, and every shortlisted title is a keep.
 */
export function normalizeDiscoveryLists<T extends MergeableDiscoveryState>(state: T): T {
  const saved = new Set(state.saved);
  const reviewRemoved = state.reviewRemoved.filter(id => !saved.has(id));
  const removed = new Set(reviewRemoved);
  const shortlisted = state.shortlisted.filter(id => !saved.has(id) && !removed.has(id));
  return { ...state, shortlisted, reviewRemoved, decisions: { ...state.decisions, ...Object.fromEntries(shortlisted.map(id => [id, "keep"])) } };
}

/** Rebase local user actions made from `base` onto a newer server snapshot. */
export function mergeDiscoveryState<T extends MergeableDiscoveryState>(base: T, local: T, remote: T): T {
  const scalar = <K extends keyof T>(key: K) => sameValue(base[key], local[key]) ? remote[key] : local[key];
  return normalizeDiscoveryLists({
    ...remote,
    sessionId: scalar("sessionId"),
    eventSequence: Math.max(base.eventSequence ?? 0, local.eventSequence ?? 0, remote.eventSequence ?? 0),
    reviewId: scalar("reviewId"),
    category: scalar("category"),
    lockedItemId: scalar("lockedItemId"),
    decisions: mergeRecord(base.decisions, local.decisions, remote.decisions),
    ratings: mergeRecord(base.ratings ?? {}, local.ratings ?? {}, remote.ratings ?? {}),
    shortlisted: mergeSet(base.shortlisted, local.shortlisted, remote.shortlisted),
    saved: mergeSet(base.saved, local.saved, remote.saved),
    history: mergeHistory(base.history, local.history, remote.history),
    reviewRemoved: mergeSet(base.reviewRemoved, local.reviewRemoved, remote.reviewRemoved),
    view: scalar("view"),
    ageVerified: scalar("ageVerified"),
  } as T);
}
