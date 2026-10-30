import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-session";
import { getDiscoveryState, saveDiscoveryState } from "@/lib/discovery-state";
import { getGlobalSettings } from "@/lib/global-settings";
import { getAdultCatalogueIds, isAdultCatalogueId, userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 5_000;
const MAX_ID_LENGTH = 128;

type Category = "Movies" | "Shows" | "Adult";
type Decision = "keep" | "pass" | "seen";
interface SessionState {
  category: Category;
  lockedItemId: string | null;
  decisions: Record<string, Decision>;
  ratings: Record<string, number>;
  shortlisted: string[];
  saved: string[];
  history: Array<{ id: string; decision: Decision; rating?: number }>;
  reviewRemoved: string[];
  view: "discover" | "review";
  ageVerified: boolean;
}
type PersistedSessionState = Omit<SessionState, "lockedItemId" | "ratings" | "category"> & { category: Category | "TV"; lockedItemId?: string | null; ratings?: Record<string, number> };

const defaultState: SessionState = {
  category: "Movies",
  lockedItemId: null,
  decisions: {},
  ratings: {},
  shortlisted: [],
  saved: [],
  history: [],
  reviewRemoved: [],
  view: "discover",
  ageVerified: false,
};

function hideAdultState(value: Record<string, unknown>, adultIds: Set<string>, fallbackCategory: string) {
  const next = { ...value };
  if (next.category === "Adult") next.category = fallbackCategory;
  if (typeof next.lockedItemId === "string" && isAdultCatalogueId(next.lockedItemId, adultIds)) next.lockedItemId = null;
  for (const key of ["shortlisted", "saved", "reviewRemoved"]) {
    if (Array.isArray(next[key])) next[key] = (next[key] as unknown[]).filter(id => typeof id !== "string" || !isAdultCatalogueId(id, adultIds));
  }
  for (const key of ["decisions", "ratings"]) {
    const map = next[key];
    if (isObject(map)) next[key] = Object.fromEntries(Object.entries(map).filter(([id]) => !isAdultCatalogueId(id, adultIds)));
  }
  if (Array.isArray(next.history)) next.history = next.history.filter(entry => !isObject(entry) || typeof entry.id !== "string" || !isAdultCatalogueId(entry.id, adultIds));
  return next;
}

function preserveHiddenAdultState(current: Record<string, unknown>, incoming: Record<string, unknown>, adultIds: Set<string>) {
  const next = { ...incoming };
  for (const key of ["shortlisted", "saved", "reviewRemoved"]) {
    const incomingIds = Array.isArray(next[key]) ? (next[key] as unknown[]).filter(id => typeof id === "string" && !isAdultCatalogueId(id, adultIds)) : [];
    const existingAdultIds = Array.isArray(current[key]) ? (current[key] as unknown[]).filter(id => typeof id === "string" && isAdultCatalogueId(id, adultIds)) : [];
    next[key] = [...incomingIds, ...existingAdultIds];
  }
  for (const key of ["decisions", "ratings"]) {
    const incomingMap = isObject(next[key]) ? next[key] as Record<string, unknown> : {};
    const currentMap = isObject(current[key]) ? current[key] as Record<string, unknown> : {};
    next[key] = { ...Object.fromEntries(Object.entries(incomingMap).filter(([id]) => !isAdultCatalogueId(id, adultIds))), ...Object.fromEntries(Object.entries(currentMap).filter(([id]) => isAdultCatalogueId(id, adultIds))) };
  }
  const incomingHistory = Array.isArray(next.history) ? next.history.filter(entry => !isObject(entry) || typeof entry.id !== "string" || !isAdultCatalogueId(entry.id, adultIds)) : [];
  const currentAdultHistory = Array.isArray(current.history) ? current.history.filter(entry => isObject(entry) && typeof entry.id === "string" && isAdultCatalogueId(entry.id, adultIds)) : [];
  next.history = [...incomingHistory, ...currentAdultHistory];
  if (typeof current.lockedItemId === "string" && isAdultCatalogueId(current.lockedItemId, adultIds)) next.lockedItemId = current.lockedItemId;
  return next;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_COLLECTION_ITEMS && value.every(isId);
}

function isReviewRating(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1 && value <= 5;
}

function isSessionState(value: unknown): value is PersistedSessionState {
  if (!isObject(value)) return false;
  const requiredKeys = ["category", "decisions", "shortlisted", "saved", "history", "reviewRemoved", "view", "ageVerified"];
  const optionalKeys = ["lockedItemId", "ratings", "sessionId", "eventSequence", "reviewId"];
  const valueKeys = Object.keys(value);
  if (!requiredKeys.every(key => key in value) || valueKeys.some(key => !requiredKeys.includes(key) && !optionalKeys.includes(key))) return false;
  if (value.lockedItemId !== undefined && value.lockedItemId !== null && !isId(value.lockedItemId)) return false;
  if (value.sessionId !== undefined && !isId(value.sessionId)) return false;
  if (value.eventSequence !== undefined && (!Number.isSafeInteger(value.eventSequence) || Number(value.eventSequence) < 0)) return false;
  if (value.reviewId !== undefined && value.reviewId !== null && !isId(value.reviewId)) return false;
  if (value.category !== "Movies" && value.category !== "Shows" && value.category !== "TV" && value.category !== "Adult") return false;
  if (value.view !== "discover" && value.view !== "review") return false;
  if (typeof value.ageVerified !== "boolean") return false;
  if (!isIdList(value.shortlisted) || !isIdList(value.saved) || !isIdList(value.reviewRemoved)) return false;
  const decisions = value.decisions;
  if (!isObject(decisions) || Object.keys(decisions).length > MAX_COLLECTION_ITEMS) return false;
  if (!Object.entries(decisions).every(([id, decision]) => isId(id) && (decision === "keep" || decision === "pass" || decision === "seen"))) return false;
  const ratings = value.ratings === undefined ? {} : value.ratings;
  if (!isObject(ratings) || Object.keys(ratings).length > MAX_COLLECTION_ITEMS) return false;
  if (!Object.entries(ratings).every(([id, rating]) => isId(id) && isReviewRating(rating) && decisions[id] === "seen")) return false;
  if (!Object.entries(decisions).every(([id, decision]) => decision !== "seen" || isReviewRating(ratings[id]))) return false;
  if (!Array.isArray(value.history) || value.history.length > MAX_COLLECTION_ITEMS) return false;
  if (!value.history.every(entry => {
    if (!isObject(entry) || !isId(entry.id)) return false;
    const allowedKeys = entry.eventId === undefined ? ["id", "decision", ...(entry.decision === "seen" ? ["rating"] : [])] : ["id", "decision", "eventId", ...(entry.decision === "seen" ? ["rating"] : [])];
    if (Object.keys(entry).length !== allowedKeys.length || Object.keys(entry).some(key => !allowedKeys.includes(key))) return false;
    if (entry.eventId !== undefined && !isId(entry.eventId)) return false;
    if (entry.decision === "seen") return isReviewRating(entry.rating);
    return entry.decision === "keep" || entry.decision === "pass";
  })) return false;
  return true;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Authentication required.", 401);

  try {
    const state = await getDiscoveryState();
    const [settings, adultGrant, adultIds] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id), getAdultCatalogueIds()]);
    if (state === null) return NextResponse.json({ ...defaultState, category: settings.defaultCategory as Category }, { headers: { "x-discovery-state-exists": "false" } });
    if (!isSessionState(state)) {
      console.error("Stored discovery state failed validation for the current account.");
      return jsonError("Saved discovery data could not be read.", 500);
    }
    const category: Category = state.category === "TV" ? "Shows" : state.category;
    const canAccessAdult = adultAccessEnabled(settings.adultSectionEnabled, adultGrant);
    if (category === "Adult" && !canAccessAdult) {
      const hidden = hideAdultState(state as Record<string, unknown>, adultIds, settings.defaultCategory) as unknown as SessionState;
      return NextResponse.json({ ...hidden, category: settings.defaultCategory as Category, lockedItemId: null }, { headers: { "x-discovery-state-exists": "true" } });
    }
    if (!canAccessAdult) {
      const hidden = hideAdultState(state as Record<string, unknown>, adultIds, settings.defaultCategory);
      return NextResponse.json({ ...hidden, category, lockedItemId: hidden.lockedItemId ?? null }, { headers: { "x-discovery-state-exists": "true" } });
    }
    return NextResponse.json({ ...state, category, lockedItemId: state.lockedItemId ?? null, ratings: state.ratings ?? {} }, { headers: { "x-discovery-state-exists": "true" } });
  } catch (error) {
    console.error("Unable to read discovery state.", error);
    return jsonError("Saved discovery data could not be read.", 500);
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Authentication required.", 401);

  try {
    requireSameOrigin(request);
  } catch (error) {
    if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
    return jsonError("Request origin is not allowed.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError("Expected a JSON discovery state.", 400);
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) return jsonError("Discovery state is too large.", 413);

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError("Could not read the request body.", 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return jsonError("Discovery state is too large.", 413);

  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonError("Request body is not valid JSON.", 400);
  }
  if (!isSessionState(value)) return jsonError("Discovery state has an invalid shape or value.", 400);
  const [settings, adultGrant, adultIds] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id), getAdultCatalogueIds()]);
  const canAccessAdult = adultAccessEnabled(settings.adultSectionEnabled, adultGrant);
  if (value.category === "Adult" && !canAccessAdult) {
    return jsonError("The Adult category is currently disabled.", 403);
  }

  try {
    let stateToSave: Record<string, unknown> = value as unknown as Record<string, unknown>;
    if (!canAccessAdult) {
      const existing = await prisma.discoveryState.findUnique({ where: { userId: session.user.id }, select: { state: true } });
      if (existing && isObject(existing.state)) stateToSave = preserveHiddenAdultState(existing.state, stateToSave, adultIds);
      if (stateToSave.category === "Adult") stateToSave.category = settings.defaultCategory;
      if (typeof stateToSave.lockedItemId === "string" && isAdultCatalogueId(stateToSave.lockedItemId, adultIds)) stateToSave.lockedItemId = null;
    }
    const normalizedState = { ...stateToSave, category: stateToSave.category === "TV" ? "Shows" : stateToSave.category, lockedItemId: stateToSave.lockedItemId ?? null };
    await saveDiscoveryState(JSON.parse(JSON.stringify(normalizedState)));
    const responseState = !canAccessAdult
      ? hideAdultState(normalizedState, adultIds, settings.defaultCategory)
      : normalizedState;
    return NextResponse.json(responseState);
  } catch (error) {
    console.error("Unable to save discovery state.", error);
    return jsonError("Discovery data could not be saved.", 500);
  }
}
