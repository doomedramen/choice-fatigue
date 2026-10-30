export const integrationServices = [
  { id: "seerr", name: "Seerr", credentialLabel: "API key", adultOnly: false },
  { id: "plex", name: "Plex", credentialLabel: "Plex token", adultOnly: false },
  { id: "radarr", name: "Radarr", credentialLabel: "API key", adultOnly: false },
  { id: "sonarr", name: "Sonarr", credentialLabel: "API key", adultOnly: false },
  { id: "whisparr-v2", name: "Whisparr v2", credentialLabel: "API key", adultOnly: true },
  { id: "whisparr-v3", name: "Whisparr v3", credentialLabel: "API key", adultOnly: true },
  { id: "stash", name: "Stash", credentialLabel: "API key", adultOnly: true },
  { id: "jellyfin", name: "Jellyfin", credentialLabel: "API key", adultOnly: false },
  { id: "emby", name: "Emby", credentialLabel: "API key", adultOnly: false },
] as const;

export type IntegrationService = (typeof integrationServices)[number]["id"];

export function getIntegrationService(value: unknown) {
  return integrationServices.find(service => service.id === value) ?? null;
}
