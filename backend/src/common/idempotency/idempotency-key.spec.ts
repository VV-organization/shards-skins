import { describe, expect, it } from "vitest";

import { normalizeIdempotencyKey } from "./idempotency-key";

describe("normalizeIdempotencyKey", () => {
  it("normalizes empty keys to undefined and preserves valid provider-safe keys", () => {
    expect(normalizeIdempotencyKey(undefined)).toBeUndefined();
    expect(normalizeIdempotencyKey(" shards:order_123.1 ")).toBe("shards:order_123.1");
  });

  it("rejects keys that cannot be safely logged or sent to providers", () => {
    expect(() => normalizeIdempotencyKey("bad key")).toThrow("Idempotency key contains unsupported characters.");
    expect(() => normalizeIdempotencyKey("x".repeat(129))).toThrow("Idempotency key must be at most 128 characters.");
  });
});
