import "server-only";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";
import type { IntegrationConfig } from "@/lib/integrations/crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const DNS_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export class IntegrationTargetError extends Error {
  constructor() {
    super("The saved service address could not be reached safely.");
    this.name = "IntegrationTargetError";
  }
}

interface ServiceResponse {
  status: number;
  body: string;
}

function ipv4Bytes(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map(part => Number(part));
  if (bytes.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return bytes;
}

function inIpv4Range(bytes: number[], start: number[], bits: number) {
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < wholeBytes; index++) if (bytes[index] !== start[index]) return false;
  if (!remainingBits) return true;
  const mask = 0xff << (8 - remainingBits);
  return (bytes[wholeBytes] & mask) === (start[wholeBytes] & mask);
}

function publicIpv4(address: string) {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const blocked: Array<[number[], number]> = [
    [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10],
    [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12],
    [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24],
    [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24],
    [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
  ];
  return !blocked.some(([start, bits]) => inIpv4Range(bytes, start, bits));
}

function ipv6Groups(address: string) {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const split = normalized.lastIndexOf(":");
    const bytes = ipv4Bytes(normalized.slice(split + 1));
    if (!bytes) return null;
    const high = ((bytes[0] << 8) | bytes[1]).toString(16);
    const low = ((bytes[2] << 8) | bytes[3]).toString(16);
    normalized = `${normalized.slice(0, split + 1)}${high}:${low}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map(group => Number.parseInt(group, 16));
}

function publicIpv6(address: string) {
  const groups = ipv6Groups(address);
  if (groups === null) return false;
  const allZero = groups.every(group => group === 0);
  if (allZero || groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return false;
  // IPv4-mapped IPv6 addresses inherit the IPv4 address policy.
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const mapped = [groups[6] >>> 8, groups[6] & 255, groups[7] >>> 8, groups[7] & 255].join(".");
    return publicIpv4(mapped);
  }
  // Only globally-routable unicast space is allowed for ordinary hosted use.
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  // Reject special-purpose 2001::/23 and the documentation-only 2001:db8::/32.
  return !(groups[0] === 0x2001 && (groups[1] <= 0x01ff || groups[1] === 0x0db8));
}

function privateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const bytes = ipv4Bytes(address);
    return Boolean(bytes && (
      inIpv4Range(bytes, [10, 0, 0, 0], 8)
      || inIpv4Range(bytes, [172, 16, 0, 0], 12)
      || inIpv4Range(bytes, [192, 168, 0, 0], 16)
      || inIpv4Range(bytes, [127, 0, 0, 0], 8)
    ));
  }
  if (family === 6) {
    const groups = ipv6Groups(address);
    if (groups === null) return false;
    const loopback = groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
    if (loopback || (groups[0] & 0xfe00) === 0xfc00) return true;
    if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
      const mapped = [groups[6] >>> 8, groups[6] & 255, groups[7] >>> 8, groups[7] & 255].join(".");
      return privateAddress(mapped);
    }
  }
  return false;
}

function safeAddress(address: string, allowPrivate: boolean) {
  const family = isIP(address);
  if (family === 4) {
    return publicIpv4(address) || (allowPrivate && privateAddress(address));
  }
  if (family === 6) {
    return publicIpv6(address) || (allowPrivate && privateAddress(address));
  }
  return false;
}

async function resolveTarget(hostname: string, allowPrivate: boolean): Promise<LookupAddress[]> {
  try {
    const literalFamily = isIP(hostname);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let addresses: LookupAddress[];
    try {
      addresses = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new IntegrationTargetError()), DNS_TIMEOUT_MS); }),
        ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!addresses.length || addresses.some(address => !safeAddress(address.address, allowPrivate))) throw new IntegrationTargetError();
    return addresses;
  } catch (error) {
    if (error instanceof IntegrationTargetError) throw error;
    throw new IntegrationTargetError();
  }
}

export async function requestIntegrationService(
  config: IntegrationConfig,
  endpoint: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<ServiceResponse> {
  const allowPrivate = process.env.INTEGRATION_ALLOW_PRIVATE_NETWORKS === "true";
  let target: URL;
  try {
    const base = new URL(config.baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    target = new URL(`${basePath}/${endpoint.replace(/^\/+/, "")}`, base.origin);
  } catch {
    throw new IntegrationTargetError();
  }

  if ((target.protocol !== "https:" && target.protocol !== "http:") || target.username || target.password || target.hash) throw new IntegrationTargetError();
  if (!allowPrivate && target.protocol !== "https:") throw new IntegrationTargetError();
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolveTarget(hostname, allowPrivate);
  if (target.protocol === "http:" && addresses.some(address => !privateAddress(address.address))) throw new IntegrationTargetError();
  const pinnedLookup: NonNullable<http.RequestOptions["lookup"]> = (_name, lookupOptions, callback) => {
    if (typeof lookupOptions === "object" && lookupOptions.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  };
  const transport = target.protocol === "https:" ? https : http;
  const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
  const headers: http.OutgoingHttpHeaders = {
    accept: "application/json",
    "accept-encoding": "identity",
    "x-api-key": config.apiKey,
    ...(body ? { "content-type": "application/json", "content-length": body.byteLength } : {}),
  };
  const requestPath = `${target.pathname}${target.search}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let receivedBytes = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error, response?: ServiceResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new IntegrationTargetError());
    };
    const timeout = setTimeout(() => request.destroy(new Error("timeout")), REQUEST_TIMEOUT_MS);
    const request = transport.request(target, {
      method: options.method ?? "GET",
      path: requestPath,
      headers,
      lookup: pinnedLookup,
      agent: false,
      maxHeaderSize: 16 * 1024,
    }, response => {
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.byteLength;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("response too large"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => finish(undefined, { status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", () => finish(new IntegrationTargetError()));
      response.on("aborted", () => finish(new IntegrationTargetError()));
    });
    request.on("error", () => finish(new IntegrationTargetError()));
    request.end(body);
  });
}
