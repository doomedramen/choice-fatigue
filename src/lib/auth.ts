import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { isAuthEmailReady, sendAuthEmail } from "@/lib/auth-email";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:4173";
const secret = process.env.BETTER_AUTH_SECRET;

if (process.env.NODE_ENV === "production" && !secret) {
  throw new Error("BETTER_AUTH_SECRET must be set in production.");
}

export const auth = betterAuth({
  appName: "Choice Fatigue",
  baseURL,
  secret: secret ?? "choice-fatigue-local-development-secret-only",
  trustedOrigins: [baseURL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your Choice Fatigue password",
        text: `A password reset was requested for your Choice Fatigue account.\n\nOpen this link to choose a new password:\n${url}\n\nIf you did not request this, you can ignore this email.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your Choice Fatigue email",
        text: `Confirm your email address to finish creating your Choice Fatigue account:\n\n${url}\n\nIf you did not create this account, you can ignore this email.`,
      });
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
      disabled: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
        returned: false,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const suppliedEmail = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof suppliedEmail === "string") {
          const user = await prisma.user.findFirst({
            where: { email: { equals: suppliedEmail.trim(), mode: "insensitive" } },
            select: { disabled: true },
          });
          if (user?.disabled) {
            throw new APIError("FORBIDDEN", {
              message: "This account is disabled. Contact an administrator.",
            });
          }
        }
        return;
      }

      if (ctx.path !== "/sign-up/email") return;

      if (!isAuthEmailReady()) {
        throw new APIError("FORBIDDEN", {
          message: "Signup is unavailable until authentication email delivery is configured.",
        });
      }

      const inviteCode = process.env.BETA_INVITE_CODE;
      const suppliedCode = ctx.headers?.get("x-beta-invite-code");
      if (!inviteCode || !suppliedCode || suppliedCode !== inviteCode) {
        throw new APIError("FORBIDDEN", {
          message: "A valid Choice Fatigue beta invite is required to sign up.",
        });
      }
    }),
  },
});

export type AuthSession = typeof auth.$Infer.Session;
