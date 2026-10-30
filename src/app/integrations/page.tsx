import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import IntegrationsClient from "./integrations-client";

export const metadata: Metadata = { title: "Connections | Choice Fatigue" };

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const settings = await getGlobalSettings();

  return <IntegrationsClient adultSectionEnabled={settings.adultSectionEnabled} />;
}
