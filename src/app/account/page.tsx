import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import AccountClient from "./account-client";
import { getGlobalSettings } from "@/lib/global-settings";
import { prisma } from "@/lib/prisma";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { parseHiddenPairings } from "@/lib/adult-pairing";

export const metadata: Metadata = { title: "Your account | Choice Fatigue" };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [settings, user] = await Promise.all([
    getGlobalSettings(),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { adultAllowed: true, adultHiddenPairings: true } }),
  ]);
  const adultAccess = adultAccessEnabled(settings.adultSectionEnabled, user?.adultAllowed === true);
  return <AccountClient userId={session.user.id} name={session.user.name} email={session.user.email} isAdmin={session.user.role === "admin"}
    adultAccess={adultAccess} hiddenPairings={adultAccess ? parseHiddenPairings(user?.adultHiddenPairings ?? []) ?? [] : []} />;
}
