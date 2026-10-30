import type { Metadata } from "next";
import { ForgotPasswordForm } from "../auth/recovery-forms";

export const metadata: Metadata = { title: "Reset password | Choice Fatigue" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
