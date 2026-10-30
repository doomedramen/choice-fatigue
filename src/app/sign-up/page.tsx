import type { Metadata } from "next";
import { AuthForm } from "../auth/auth-form";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Join Choice Fatigue" };

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const firstAccount = await prisma.user.count() === 0;
  return <AuthForm mode="sign-up" firstAccount={firstAccount} />;
}
