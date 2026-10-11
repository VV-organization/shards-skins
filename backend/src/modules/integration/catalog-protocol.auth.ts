import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type HeaderValue = string | string[] | undefined;

export type CatalogProtocolAuthInput = {
  readonly body: string;
  readonly headers: Record<string, HeaderValue>;
  readonly method: string;
  readonly path: string;
};

export type CatalogProtocolActor = {
  readonly actorId: string;
  readonly idempotencyKey: string | null;
  readonly requestId: string;
  readonly siteKey: string;
};

const timestampWindowMs = 300_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function authenticateCatalogProtocolRequest(
  input: CatalogProtocolAuthInput,
  secret: string,
  expectedSiteKey: string,
  now = new Date(),
): CatalogProtocolActor {
  const actorId = readHeader(input.headers, "x-vv-actor-id")?.trim();
  const requestId = readHeader(input.headers, "x-vv-request-id");
  const siteKey = readHeader(input.headers, "x-vv-site-key");
  const timestamp = readHeader(input.headers, "x-vv-timestamp");
  const signature = readHeader(input.headers, "x-vv-signature");
  const idempotencyKey = readHeader(input.headers, "idempotency-key");
  const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(input.method.toUpperCase());

  if (
    !actorId ||
    !requestId ||
    !uuidPattern.test(requestId) ||
    siteKey !== expectedSiteKey ||
    !timestamp ||
    !currentTimestamp(timestamp, now) ||
    !signature ||
    (isMutation && (!idempotencyKey || !uuidPattern.test(idempotencyKey)))
  ) {
    throw new Error("CATALOG_PROTOCOL_AUTH_FAILED");
  }

  const digest = createHash("sha256").update(input.body).digest("hex");
  const canonical = [
    "vv-admin",
    timestamp,
    requestId,
    input.method.toUpperCase(),
    input.path,
    digest,
  ].join(".");
  const expected = `sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
  if (!safeEqual(signature, expected)) throw new Error("CATALOG_PROTOCOL_AUTH_FAILED");

  return {
    actorId,
    idempotencyKey: idempotencyKey ?? null,
    requestId,
    siteKey,
  };
}

function readHeader(headers: Record<string, HeaderValue>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function currentTimestamp(value: string, now: Date): boolean {
  if (!timestampPattern.test(value)) return false;
  const timestamp = Date.parse(value);
  const normalized = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === normalized &&
    Math.abs(now.getTime() - timestamp) <= timestampWindowMs
  );
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
