import "server-only";
import { headers } from "next/headers";
import { auth, type AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export class AuthenticationError extends Error {
  readonly status = 401;
  constructor() {
    super("Sign in is required.");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor() {
    super("Administrator access is required.");
    this.name = "AuthorizationError";
  }
}

export async function getSession(): Promise<AuthSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { disabled: true },
  });
  if (!account || account.disabled) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } });
    return null;
  }

  return session;
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw new AuthenticationError();
  return session;
}

export async function requireAdmin(): Promise<AuthSession> {
  const session = await requireSession();
  if (session.user.role !== "admin") throw new AuthorizationError();
  return session;
}
