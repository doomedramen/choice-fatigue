import type { Metadata } from "next";
import { AuthForm } from "../auth/auth-form";

export const metadata: Metadata = { title: "Sign in | Choice Fatigue" };

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
