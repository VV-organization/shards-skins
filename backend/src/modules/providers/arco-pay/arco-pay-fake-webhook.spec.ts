import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { stableJson, verifyFakeArcoPayWebhookSignature } from "./arco-pay-fake-webhook";

it("canonicalizes nested payloads for deterministic local fake signatures", () => {
  expect(stableJson({ z: [{ b: 2, a: null }], a: true })).toBe('{"a":true,"z":[{"a":null,"b":2}]}');
});
it("verifies fake HMAC signatures without accepting payload mutation or malformed hex", () => {
  const signature = createHmac("sha256", "test-only-secret").update('{"a":1,"b":2}').digest("hex");
  expect(verifyFakeArcoPayWebhookSignature({ b: 2, a: 1 }, signature, "test-only-secret")).toBe(true);
  expect(verifyFakeArcoPayWebhookSignature({ b: 3, a: 1 }, signature, "test-only-secret")).toBe(false);
  expect(verifyFakeArcoPayWebhookSignature({ b: 2, a: 1 }, signature + "ignored", "test-only-secret")).toBe(false);
  expect(verifyFakeArcoPayWebhookSignature({}, undefined, "test-only-secret")).toBe(false);
});
