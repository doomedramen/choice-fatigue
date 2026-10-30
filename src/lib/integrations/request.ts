import type { NextRequest } from "next/server";

export class IntegrationRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "IntegrationRequestError";
  }
}

export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new IntegrationRequestError(403, "Request origin is not allowed.");
}

export async function readIntegrationJson(request: NextRequest, maxBytes: number) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new IntegrationRequestError(400, "Expected a JSON request.");
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new IntegrationRequestError(413, "Request body is too large.");

  const reader = request.body?.getReader();
  if (!reader) throw new IntegrationRequestError(400, "Request body is empty.");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new IntegrationRequestError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof IntegrationRequestError) throw error;
    throw new IntegrationRequestError(400, "Could not read the request body.");
  }

  try {
    const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8");
    return JSON.parse(body) as unknown;
  } catch {
    throw new IntegrationRequestError(400, "Request body is not valid JSON.");
  }
}
