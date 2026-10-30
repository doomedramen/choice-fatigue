import { redirect } from "next/navigation";
import DiscoveryClient from "./discovery-client";
import { getSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { getCatalogue } from "@/lib/catalogue";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [settings, mediaItems] = await Promise.all([getGlobalSettings(), getCatalogue()]);
  return <DiscoveryClient
    appName={settings.appName}
    userName={session.user.name}
    isAdmin={session.user.role === "admin"}
    adultSectionEnabled={settings.adultSectionEnabled}
    mediaItems={mediaItems.filter(item => settings.adultSectionEnabled || item.category !== "Adult")}
  />;
}
