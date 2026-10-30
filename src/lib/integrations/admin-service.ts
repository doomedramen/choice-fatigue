import "server-only";
import { getIntegrationService } from "@/lib/integrations/registry";
import { IntegrationRequestError } from "@/lib/integrations/request";

function parseUrl(value: unknown) {
  const baseUrlText = typeof value === "string" ? value.trim() : "";
  if (!baseUrlText || baseUrlText.length > 2048) throw new IntegrationRequestError(400, "Enter a server address.");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrlText);
  } catch {
    throw new IntegrationRequestError(400, "Enter a complete server address, including http:// or https://.");
  }
  if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new IntegrationRequestError(400, "Use an http or https address without credentials, query parameters, or fragments.");
  }
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
  return parsedUrl.toString().replace(/\/$/, "");
}

function parseName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 60) throw new IntegrationRequestError(400, "Enter a connection name of up to 60 characters.");
  return name;
}

function parseApiKey(value: unknown, optional: boolean) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string") throw new IntegrationRequestError(400, "Enter a credential.");
  const apiKey = value.trim();
  if (apiKey.length > 4096 || (!optional && !apiKey)) throw new IntegrationRequestError(400, "Enter a valid credential.");
  return apiKey;
}

export function parseAdminServiceCreateInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationRequestError(400, "Connection details are invalid.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["service", "name", "baseUrl", "apiKey"].includes(key))) throw new IntegrationRequestError(400, "Connection details are invalid.");
  const service = getIntegrationService(input.service);
  if (!service) throw new IntegrationRequestError(400, "Choose a supported service.");
  return { service, name: parseName(input.name), baseUrl: parseUrl(input.baseUrl), apiKey: parseApiKey(input.apiKey, false) };
}

export function parseAdminServiceUpdateInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationRequestError(400, "Connection details are invalid.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["name", "baseUrl", "apiKey"].includes(key))) throw new IntegrationRequestError(400, "Connection details are invalid.");
  return { name: parseName(input.name), baseUrl: parseUrl(input.baseUrl), apiKey: parseApiKey(input.apiKey, true) };
}
