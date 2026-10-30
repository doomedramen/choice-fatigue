import { redirect } from "next/navigation";
import DiscoveryClient from "./discovery-client";
import { getSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { getDiscoveryCatalogue } from "@/lib/catalogue";
import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [settings, catalogue, seerrConnections, plexConnections] = await Promise.all([
    getGlobalSettings(),
    getDiscoveryCatalogue(),
    prisma.adminServiceIntegration.findMany({ where: { service: "seerr" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.adminServiceIntegration.findMany({ where: { service: "plex" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return <DiscoveryClient
    appName={settings.appName}
    userName={session.user.name}
    isAdmin={session.user.role === "admin"}
    adultSectionEnabled={settings.adultSectionEnabled}
    mediaItems={catalogue.items.filter(item => settings.adultSectionEnabled || item.category !== "Adult")}
    catalogueNotice={catalogue.notice}
    seerrConnections={seerrConnections}
    plexConnections={plexConnections}
  />;
}
