import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { getGlobalSettings } from "@/lib/global-settings";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { parseProviderTitleId } from "@/lib/media-provider-id";
import { getTmdbMediaItem } from "@/lib/providers/tmdb";
import { getThePornDBMediaItem } from "@/lib/providers/theporndb";
import { getStashDbMediaItem } from "@/lib/providers/stashdb";
import type { MediaItem } from "@/data";

const MAX_IDS = 40;

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Saved title details could not be resolved." }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await requireSession();
    const body = await readIntegrationJson(request, 12 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Array.isArray((body as Record<string, unknown>).ids)) {
      return NextResponse.json({ error: "Saved provider IDs have an invalid shape." }, { status: 400 });
    }
    const ids = (body as { ids: unknown[] }).ids;
    if (ids.length > MAX_IDS || !ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 200) || new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "Saved provider IDs have an invalid value." }, { status: 400 });
    }
    const references = ids.map(id => parseProviderTitleId(id as string));
    if (references.some(reference => reference?.category === "Adult")) {
      const [settings, grant] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id)]);
      if (!adultAccessEnabled(settings.adultSectionEnabled, grant)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    }
    const resolve = async (id: string, reference: ReturnType<typeof parseProviderTitleId>): Promise<MediaItem | null> => {
      if (!reference) return null;
      try {
        if (reference.provider === "tmdb") return await getTmdbMediaItem(reference.mediaType, reference.sourceId);
        if (reference.provider === "theporndb") return await getThePornDBMediaItem(reference.kind, reference.sourceId);
        return await getStashDbMediaItem(reference.sourceId);
      } catch {
        return null;
      }
    };
    const items: MediaItem[] = [];
    for (let index = 0; index < ids.length; index += 4) {
      const resolved = await Promise.all(ids.slice(index, index + 4).map((id, offset) => resolve(id as string, references[index + offset])));
      items.push(...resolved.filter((item): item is MediaItem => item !== null));
    }
    const resolvedIds = new Set(items.map(item => item.id));
    return NextResponse.json({ items, unavailableIds: (ids as string[]).filter(id => !resolvedIds.has(id)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
