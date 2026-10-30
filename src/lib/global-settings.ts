import "server-only";
import { prisma } from "@/lib/prisma";
import { serverConfig } from "@/lib/server-config";

export async function getGlobalSettings() {
  const settings = await prisma.globalSettings.findUnique({ where: { id: "global" } });
  return {
    appName: settings?.appName ?? "Choice Fatigue",
    defaultCategory: settings?.defaultCategory ?? "Movies",
    adultSectionEnabled: serverConfig.adultSectionEnabled && settings?.adultSectionEnabled === true,
  };
}
