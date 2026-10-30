import { redirect } from "next/navigation";
import DiscoveryClient from "./discovery-client";
import { getSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const settings = await getGlobalSettings();
  return <DiscoveryClient
    appName={settings.appName}
    userName={session.user.name}
    isAdmin={session.user.role === "admin"}
    adultSectionEnabled={settings.adultSectionEnabled}
  />;
}
