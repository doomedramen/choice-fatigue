import type { Metadata } from "next";
import { AuthForm } from "../auth/auth-form";

export const metadata: Metadata = { title: "Join Choice Fatigue" };

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
