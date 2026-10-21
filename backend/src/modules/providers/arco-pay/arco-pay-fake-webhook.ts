import { createHmac, timingSafeEqual } from "node:crypto";

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

// Used only by the local fake provider; live callbacks require RSA-SHA1 over raw bytes.
export function verifyFakeArcoPayWebhookSignature(payload: unknown, signature: string | undefined, signingSecret: string): boolean {
  const normalizedSignature = signature?.trim();
  if (!normalizedSignature || !/^[a-fA-F0-9]{64}$/.test(normalizedSignature)) return false;
  const expected = createHmac("sha256", signingSecret).update(stableJson(payload), "utf8").digest();
  return timingSafeEqual(Buffer.from(normalizedSignature, "hex"), expected);
}
