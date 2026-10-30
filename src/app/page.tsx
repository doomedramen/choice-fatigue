import { redirect } from "next/navigation";
import DiscoveryClient from "./discovery-client";
import { getSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { getCatalogue } from "@/lib/catalogue";
import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [settings, mediaItems, seerrConnections, plexConnections] = await Promise.all([
    getGlobalSettings(),
    getCatalogue(),
    prisma.adminServiceIntegration.findMany({ where: { service: "seerr" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.adminServiceIntegration.findMany({ where: { service: "plex" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return <DiscoveryClient
    appName={settings.appName}
    userName={session.user.name}
    isAdmin={session.user.role === "admin"}
    adultSectionEnabled={settings.adultSectionEnabled}
    mediaItems={mediaItems.filter(item => settings.adultSectionEnabled || item.category !== "Adult")}
    seerrConnections={seerrConnections}
    plexConnections={plexConnections}
  />;
}
