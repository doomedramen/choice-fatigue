import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, disabled: true, adultAllowed: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ users }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
    console.error("Admin users request failed.", error);
    return NextResponse.json({ error: "Users could not be loaded." }, { status: 500 });
  }
}

class AccountUpdateError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AccountUpdateError";
  }
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export async function PATCH(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
    console.error("Admin account update authorization failed.", error);
    return NextResponse.json({ error: "Account could not be updated." }, { status: 500 });
  }

  try { requireSameOrigin(request); }
  catch (error) {
    if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });

  let value: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    value = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Request body has an invalid shape." }, { status: 400 });
  const input = value as Record<string, unknown>;
  const changeKeys = ["disabled", "adultAllowed"].filter(key => key in input);
  if (Object.keys(input).length !== 2 || typeof input.userId !== "string" || input.userId.length < 1 || input.userId.length > 128 || changeKeys.length !== 1 || typeof input[changeKeys[0]] !== "boolean") {
    return NextResponse.json({ error: "Request body has an invalid value." }, { status: 400 });
  }

  try {
    const user = await prisma.$transaction(async transaction => {
      const target = await transaction.user.findUnique({
        where: { id: input.userId as string },
        select: { id: true, name: true, email: true, role: true, disabled: true, adultAllowed: true, createdAt: true },
      });
      if (!target) throw new AccountUpdateError(404, "Account not found.");
      const field = changeKeys[0] as "disabled" | "adultAllowed";
      const nextValue = input[field] as boolean;
      if (field === "disabled" && nextValue && target.id === admin.user.id) throw new AccountUpdateError(400, "You can’t disable your own account.");
      if (target[field] === nextValue) return target;

      if (field === "disabled" && nextValue && target.role === "admin") {
        const activeAdminCount = await transaction.user.count({ where: { role: "admin", disabled: false } });
        if (activeAdminCount <= 1) throw new AccountUpdateError(409, "The last active administrator can’t be disabled.");
      }

      const updated = await transaction.user.update({
        where: { id: target.id },
        data: field === "disabled" ? { disabled: nextValue } : { adultAllowed: nextValue },
        select: { id: true, name: true, email: true, role: true, disabled: true, adultAllowed: true, createdAt: true },
      });
      if (updated.disabled) await transaction.session.deleteMany({ where: { userId: updated.id } });
      return updated;
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof AccountUpdateError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (isSerializationConflict(error)) return NextResponse.json({ error: "Another account change happened at the same time. Refresh and try again." }, { status: 409 });
    console.error("Admin account update failed.", error);
    return NextResponse.json({ error: "Account could not be updated." }, { status: 500 });
  }
}
