import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import AccountClient from "./account-client";

export const metadata: Metadata = { title: "Your account | Choice Fatigue" };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <AccountClient userId={session.user.id} name={session.user.name} email={session.user.email} isAdmin={session.user.role === "admin"} />;
}
