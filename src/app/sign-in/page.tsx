import type { Metadata } from "next";
import { AuthForm } from "../auth/auth-form";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Sign in | Choice Fatigue" };

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const firstAccount = await prisma.user.count() === 0;
  return <AuthForm mode="sign-in" firstAccount={firstAccount} />;
}
