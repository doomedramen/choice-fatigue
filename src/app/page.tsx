import { redirect } from "next/navigation";
import DiscoveryClient from "./discovery-client";
import { getSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { getDiscoveryCatalogue } from "@/lib/catalogue";
import { prisma } from "@/lib/prisma";
import { adultAccessEnabled } from "@/lib/adult-access-policy";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [settings, seerrConnections, plexConnections, user] = await Promise.all([
    getGlobalSettings(),
    prisma.adminServiceIntegration.findMany({ where: { service: "seerr" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.adminServiceIntegration.findMany({ where: { service: "plex" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { adultAllowed: true } }),
  ]);
  const canAccessAdult = adultAccessEnabled(settings.adultSectionEnabled, user?.adultAllowed === true);
  const catalogue = await getDiscoveryCatalogue(session.user.id, canAccessAdult);
  return <DiscoveryClient
    appName={settings.appName}
    userName={session.user.name}
    userId={session.user.id}
    isAdmin={session.user.role === "admin"}
    adultSectionEnabled={canAccessAdult}
    mediaItems={catalogue.items.filter(item => canAccessAdult || item.category !== "Adult")}
    initialFeeds={catalogue.feeds}
    seerrConnections={seerrConnections}
    plexConnections={plexConnections}
  />;
}
