/** Process-level guardrails for local read-only use and isolated browser tests. */
export function integrationsReadOnly() {
  return process.env.INTEGRATIONS_READ_ONLY === "1";
}

export function assertIntegrationReadOnly(method: string, body?: unknown) {
  if (integrationsReadOnly() && (method.toUpperCase() !== "GET" || body !== undefined)) throw new Error("Media service writes are disabled in read-only mode.");
}

export function assertTestNetworkTarget(url: string | URL) {
  if (process.env.E2E_NETWORK_ISOLATION !== "1") return;
  const target = new URL(url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.port !== "4199") {
    throw new Error("Browser test network isolation blocked an external service.");
  }
}
