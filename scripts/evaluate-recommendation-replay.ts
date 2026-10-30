import { readFile } from "node:fs/promises";

type Category = "Movies" | "Shows" | "Adult";
type Row = {
  id: string;
  sessionId: string;
  category: Category;
  sequence: number;
  eventType: string;
  itemId: string | null;
  decision: string | null;
  candidateIds?: string[] | null;
  targetEventId?: string | null;
  createdAt?: string | Date;
};

async function main() {
  const file = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
  if (!file) throw new Error("Usage: pnpm eval:replay -- account-export.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { recommendationHistory?: unknown };
  if (!Array.isArray(parsed.recommendationHistory)) throw new Error("Input must be a Choice Fatigue account export with recommendationHistory.");
  const rows = parsed.recommendationHistory.filter((row): row is Row => Boolean(row && typeof row === "object" && ["Movies", "Shows", "Adult"].includes((row as Row).category) && typeof (row as Row).sessionId === "string" && typeof (row as Row).id === "string"));

function orderRows(events: Row[]) {
  return [...events].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB || a.sequence - b.sequence;
  });
}
function median(values: number[]) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

  const summaries = ["Movies", "Shows", "Adult"].map(category => {
  const groups = new Map<string, Row[]>();
  for (const row of rows.filter(row => row.category === category)) groups.set(row.sessionId, [...(groups.get(row.sessionId) ?? []), row]);
  let impressions = 0;
  let shortlisted = 0;
  let saves = 0;
  let sessionsWithSave = 0;
  const cardsToFirstSave: number[] = [];
  const providerSaveRanks: number[] = [];
  const shownSaveRanks: number[] = [];
  let candidateSetCount = 0;

  for (const events of groups.values()) {
    const ordered = orderRows(events);
    const base = ordered.find(event => event.eventType === "candidate_set" && Array.isArray(event.candidateIds))?.candidateIds ?? [];
    const shown = ordered.filter(event => event.eventType === "item_shown" && event.itemId);
    const decisions = ordered.filter(event => event.eventType === "decision" && event.itemId && (event.decision === "keep" || event.decision === "pass"));
    const saved = new Set(ordered.filter(event => event.eventType === "saved" && event.itemId).map(event => event.itemId as string));
    if (base.length) candidateSetCount++;
    impressions += shown.length;
    const withdrawnIds = new Set(ordered.filter(event => ["decision_undone", "shortlist_withdrawn"].includes(event.eventType) && event.targetEventId).map(event => event.targetEventId));
    const removed = new Set<string>();
    for (const event of ordered.filter(event => ["review_removed", "review_restored"].includes(event.eventType) && event.targetEventId)) {
      if (event.eventType === "review_removed") removed.add(event.targetEventId!);
      else removed.delete(event.targetEventId!);
    }
    const kept = decisions.filter(event => event.decision === "keep" && !withdrawnIds.has(event.id) && !removed.has(event.id));
    shortlisted += kept.length;
    saves += saved.size;
    const firstSavedIndex = shown.findIndex(event => saved.has(event.itemId!));
    if (firstSavedIndex >= 0) {
      sessionsWithSave++;
      cardsToFirstSave.push(firstSavedIndex + 1);
      const savedId = shown[firstSavedIndex].itemId!;
      const providerIndex = base.indexOf(savedId);
      if (providerIndex >= 0) providerSaveRanks.push(providerIndex + 1);
      shownSaveRanks.push(firstSavedIndex + 1);
    }
  }
  return {
    category,
    sessions: groups.size,
    candidateSets: candidateSetCount,
    impressions,
    shortlists: shortlisted,
    saves,
    shortlistToSaveRate: shortlisted ? Number((saves / shortlisted).toFixed(4)) : null,
    sessionsWithSave,
    medianCardsToFirstSave: median(cardsToFirstSave),
    medianProviderOrderRankOfFirstSavedTitle: median(providerSaveRanks),
    medianObservedDisplayRankOfFirstSavedTitle: median(shownSaveRanks),
    rankPairs: providerSaveRanks.length,
  };
  });

  process.stdout.write(`${JSON.stringify({ method: "descriptive historical replay; not causal", generatedAt: new Date().toISOString(), categories: summaries }, null, 2)}\n`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
