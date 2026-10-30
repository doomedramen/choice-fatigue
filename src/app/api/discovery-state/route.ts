import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth-session";
import { getDiscoveryState, saveDiscoveryState } from "@/lib/discovery-state";
import { getGlobalSettings } from "@/lib/global-settings";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 5_000;
const MAX_ID_LENGTH = 128;

type Category = "Movies" | "TV" | "Adult";
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
type PersistedSessionState = Omit<SessionState, "lockedItemId" | "ratings"> & { lockedItemId?: string | null; ratings?: Record<string, number> };

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
  const optionalKeys = ["lockedItemId", "ratings"];
  const valueKeys = Object.keys(value);
  if (!requiredKeys.every(key => key in value) || valueKeys.some(key => !requiredKeys.includes(key) && !optionalKeys.includes(key))) return false;
  if (value.lockedItemId !== undefined && value.lockedItemId !== null && !isId(value.lockedItemId)) return false;
  if (value.category !== "Movies" && value.category !== "TV" && value.category !== "Adult") return false;
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
    if (entry.decision === "seen") return Object.keys(entry).length === 3 && isReviewRating(entry.rating);
    return Object.keys(entry).length === 2 && (entry.decision === "keep" || entry.decision === "pass");
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
    const settings = await getGlobalSettings();
    if (state === null) return NextResponse.json({ ...defaultState, category: settings.defaultCategory as Category }, { headers: { "x-discovery-state-exists": "false" } });
    if (!isSessionState(state)) {
      console.error("Stored discovery state failed validation for the current account.");
      return jsonError("Saved discovery data could not be read.", 500);
    }
    if (state.category === "Adult" && !settings.adultSectionEnabled) {
      return NextResponse.json({ ...defaultState, category: settings.defaultCategory as Category, decisions: state.decisions, ratings: state.ratings ?? {}, shortlisted: state.shortlisted, saved: state.saved, history: state.history, reviewRemoved: state.reviewRemoved });
    }
    return NextResponse.json({ ...state, lockedItemId: state.lockedItemId ?? null, ratings: state.ratings ?? {} }, { headers: { "x-discovery-state-exists": "true" } });
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
  if (value.category === "Adult" && !(await getGlobalSettings()).adultSectionEnabled) {
    return jsonError("The Adult category is currently disabled.", 403);
  }

  try {
    const normalizedState = { ...value, lockedItemId: value.lockedItemId ?? null };
    await saveDiscoveryState(JSON.parse(JSON.stringify(normalizedState)));
    return NextResponse.json(normalizedState);
  } catch (error) {
    console.error("Unable to save discovery state.", error);
    return jsonError("Discovery data could not be saved.", 500);
  }
}
