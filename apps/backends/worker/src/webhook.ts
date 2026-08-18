import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

const BODY_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 64 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const DEFAULT_MAX_REDIRECTS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELIVERY_REQUEST_KEYS = new Set([
  "endpointId",
  "eventType",
  "organizationId",
  "publicationId",
  "signingKeyVersion",
]);

export interface WebhookDeliveryRequest {
  organizationId: string;
  publicationId: string;
  endpointId: string;
  eventType: string;
  signingKeyVersion: number;
}

export interface WebhookDeliveryContext extends WebhookDeliveryRequest {
  endpointUrl: string;
  publication: {
    aggregateId: string;
    aggregateType: string;
    createdAt: Date;
    payload: Record<string, unknown>;
  };
}

export interface WebhookDeliveryOptions {
  allowLocalTestServer?: boolean;
  masterKey?: string;
  maxRedirects?: number;
  responseLimitBytes?: number;
  timeoutMs?: number;
}

type ResolvedTarget = { address: string; family: 4 | 6; url: URL };

export class WebhookDeliveryError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "WebhookDeliveryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWebhookDeliveryRequest(payload: unknown): WebhookDeliveryRequest {
  if (!isRecord(payload)) throw new WebhookDeliveryError("WEBHOOK_EVENT_INVALID");
  const keys = Object.keys(payload);
  if (
    keys.length !== DELIVERY_REQUEST_KEYS.size ||
    keys.some((key) => !DELIVERY_REQUEST_KEYS.has(key))
  ) {
    throw new WebhookDeliveryError("WEBHOOK_EVENT_INVALID");
  }
  const { organizationId, publicationId, endpointId, eventType, signingKeyVersion } = payload;
  if (
    typeof organizationId !== "string" ||
    !UUID.test(organizationId) ||
    typeof publicationId !== "string" ||
    !UUID.test(publicationId) ||
    typeof endpointId !== "string" ||
    !UUID.test(endpointId) ||
    typeof eventType !== "string" ||
    eventType.length < 1 ||
    eventType.length > 120 ||
    !Number.isInteger(signingKeyVersion) ||
    (signingKeyVersion as number) < 1
  ) {
    throw new WebhookDeliveryError("WEBHOOK_EVENT_INVALID");
  }
  return {
    organizationId,
    publicationId,
    endpointId,
    eventType,
    signingKeyVersion: signingKeyVersion as number,
  };
}

function canonicalValue(value: unknown, depth = 0): unknown {
  if (depth > 40) throw new WebhookDeliveryError("WEBHOOK_BODY_INVALID");
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, depth + 1));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalValue(item, depth + 1)]),
    );
  return value;
}

export function canonicalWebhookBody(context: WebhookDeliveryContext) {
  return JSON.stringify(
    canonicalValue({
      aggregate: {
        id: context.publication.aggregateId,
        type: context.publication.aggregateType,
      },
      data: context.publication.payload,
      id: context.publicationId,
      timestamp: context.publication.createdAt.toISOString(),
      type: context.eventType,
      version: BODY_VERSION,
    }),
  );
}

export function deriveWebhookSecret(
  masterKey: string,
  organizationId: string,
  endpointId: string,
  signingKeyVersion: number,
) {
  if (masterKey.length < 32) throw new WebhookDeliveryError("WEBHOOK_SIGNING_NOT_CONFIGURED");
  return createHmac("sha256", masterKey)
    .update(`${organizationId}:${endpointId}:v${signingKeyVersion}`)
    .digest("base64url");
}

export function signWebhookBody(context: WebhookDeliveryContext, body: string, masterKey: string) {
  const secret = deriveWebhookSecret(
    masterKey,
    context.organizationId,
    context.endpointId,
    context.signingKeyVersion,
  );
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function ipv4Octets(address: string) {
  const octets = address.split(".").map(Number);
  return octets.length === 4 && octets.every((value) => Number.isInteger(value)) ? octets : null;
}

function mappedIpv4Address(address: string) {
  const match = address.toLowerCase().match(/^(?:(?:0{1,4}:){5}|::)ffff:([0-9a-f:.]+)$/);
  const tail = match?.[1];
  if (!tail) return null;
  if (isIP(tail) === 4) return tail;
  const parts = tail.split(":");
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const high = Number.parseInt(parts[0] ?? "", 16);
  const low = Number.parseInt(parts[1] ?? "", 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isLoopbackAddress(address: string): boolean {
  if (address === "::1") return true;
  const octets = ipv4Octets(address);
  if (octets?.[0] === 127) return true;
  const mapped = mappedIpv4Address(address);
  return mapped ? isLoopbackAddress(mapped) : false;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = ipv4Octets(address);
    if (!octets) return false;
    const [first = 0, second = 0, third = 0] = octets;
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
    if (first === 100 && second >= 64 && second <= 127) return false;
    if (first === 169 && second === 254) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && second === 168) return false;
    if (first === 192 && second === 0 && third <= 2) return false;
    if (first === 198 && (second === 18 || second === 19)) return false;
    if (first === 198 && second === 51 && third === 100) return false;
    if (first === 203 && second === 0 && third === 113) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    const mapped = mappedIpv4Address(normalized);
    if (mapped) return isPublicAddress(mapped);
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::") ||
      normalized.startsWith("64:ff9b:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      /^fe[c-f]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("2002:")
    )
      return false;
    return true;
  }
  return false;
}

async function resolveTarget(
  rawUrl: string,
  options: WebhookDeliveryOptions,
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookDeliveryError("WEBHOOK_TARGET_INVALID");
  }
  if (url.username || url.password) throw new WebhookDeliveryError("WEBHOOK_TARGET_INVALID");
  const localTestAllowed = options.allowLocalTestServer === true && process.env.NODE_ENV === "test";
  const localHttp = url.protocol === "http:" && localTestAllowed;
  if (url.protocol !== "https:" && !localHttp)
    throw new WebhookDeliveryError("WEBHOOK_TARGET_HTTPS_REQUIRED");
  if (!url.hostname) throw new WebhookDeliveryError("WEBHOOK_TARGET_INVALID");
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebhookDeliveryError("WEBHOOK_TARGET_DNS_FAILED");
  }
  if (addresses.length === 0) throw new WebhookDeliveryError("WEBHOOK_TARGET_DNS_FAILED");
  for (const item of addresses) {
    const allowed = localHttp ? isLoopbackAddress(item.address) : isPublicAddress(item.address);
    if (!allowed) throw new WebhookDeliveryError("WEBHOOK_TARGET_BLOCKED");
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6))
    throw new WebhookDeliveryError("WEBHOOK_TARGET_DNS_FAILED");
  return { address: selected.address, family: selected.family, url };
}

function requestOnce(
  target: ResolvedTarget,
  body: string,
  headers: Record<string, string>,
  options: Required<Pick<WebhookDeliveryOptions, "responseLimitBytes" | "timeoutMs">>,
) {
  return new Promise<{ location?: string; statusCode: number }>((resolve, reject) => {
    let settled = false;
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      reject(new WebhookDeliveryError(code));
    };
    const transport = target.url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        headers: { ...headers, host: target.url.host },
        hostname: target.address,
        maxHeaderSize: 16 * 1024,
        method: "POST",
        path: `${target.url.pathname}${target.url.search}`,
        port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
        protocol: target.url.protocol,
        servername: target.url.hostname.replace(/^\[(.*)\]$/, "$1"),
      },
      (response) => {
        let responseBytes = 0;
        response.on("data", (chunk: Buffer) => {
          responseBytes += chunk.length;
          if (responseBytes > options.responseLimitBytes) {
            response.destroy();
            request.destroy();
            fail("WEBHOOK_RESPONSE_TOO_LARGE");
          }
        });
        response.on("error", () => fail("WEBHOOK_NETWORK_ERROR"));
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            ...(typeof response.headers.location === "string"
              ? { location: response.headers.location }
              : {}),
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.setTimeout(options.timeoutMs, () => {
      request.destroy();
      fail("WEBHOOK_TIMEOUT");
    });
    request.on("error", () => fail("WEBHOOK_NETWORK_ERROR"));
    request.end(body);
  });
}

export async function deliverWebhook(
  context: WebhookDeliveryContext,
  options: WebhookDeliveryOptions = {},
) {
  const masterKey = options.masterKey ?? process.env.WEBHOOK_SIGNING_MASTER_KEY ?? "";
  const body = canonicalWebhookBody(context);
  if (Buffer.byteLength(body) > MAX_WEBHOOK_BODY_BYTES)
    throw new WebhookDeliveryError("WEBHOOK_BODY_TOO_LARGE");
  const timestamp = context.publication.createdAt.toISOString();
  const headers = {
    "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json; charset=utf-8",
    "idempotency-key": `${context.publicationId}:${context.endpointId}`,
    "user-agent": "GiroMesa-Webhook/1.0",
    "x-giromesa-event-id": context.publicationId,
    "x-giromesa-event-version": String(BODY_VERSION),
    "x-giromesa-signature": signWebhookBody(context, body, masterKey),
    "x-giromesa-signing-key-version": String(context.signingKeyVersion),
    "x-giromesa-timestamp": timestamp,
  };
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let targetUrl = context.endpointUrl;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const target = await resolveTarget(targetUrl, options);
    const response = await requestOnce(target, body, headers, {
      responseLimitBytes: options.responseLimitBytes ?? DEFAULT_RESPONSE_LIMIT_BYTES,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    if (response.statusCode === 307 || response.statusCode === 308) {
      if (!response.location || redirect === maxRedirects)
        throw new WebhookDeliveryError("WEBHOOK_REDIRECT_REJECTED");
      try {
        targetUrl = new URL(response.location, target.url).toString();
      } catch {
        throw new WebhookDeliveryError("WEBHOOK_REDIRECT_REJECTED");
      }
      continue;
    }
    throw new WebhookDeliveryError("WEBHOOK_HTTP_STATUS");
  }
  throw new WebhookDeliveryError("WEBHOOK_REDIRECT_REJECTED");
}
