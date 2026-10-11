import { createHmac, timingSafeEqual } from "node:crypto";

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function verifyFakeArcPayWebhookSignature(payload: unknown, signature: string | undefined, signingSecret: string): boolean {
  const normalizedSignature = signature?.trim();
  if (!normalizedSignature) return false;
  const expected = createHmac("sha256", signingSecret).update(stableJson(payload), "utf8").digest("hex");
  const actualBuffer = Buffer.from(normalizedSignature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
