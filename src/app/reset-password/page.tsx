import type { Metadata } from "next";
import { ResetPasswordForm } from "../auth/recovery-forms";

export const metadata: Metadata = { title: "Choose a new password | Choice Fatigue" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={token ?? ""} />;
}
