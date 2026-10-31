import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { getPopularTmdbCataloguePage, type TmdbCategory } from "@/lib/providers/tmdb";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const category = request.nextUrl.searchParams.get("category");
    const page = Number(request.nextUrl.searchParams.get("page"));
    if ((category !== "Movies" && category !== "Shows") || !Number.isSafeInteger(page) || page < 3 || page > 500) {
      return NextResponse.json({ error: "Choose a valid discovery page." }, { status: 400 });
    }
    const result = await getPopularTmdbCataloguePage(category as TmdbCategory, page);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    return NextResponse.json({ error: "More titles could not be loaded." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
