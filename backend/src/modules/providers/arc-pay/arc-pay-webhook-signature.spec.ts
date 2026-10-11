import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyArcPayWebhookSignature } from "./arc-pay-webhook-signature";

describe("verifyArcPayWebhookSignature", () => {
  it("verifies payment provider HMAC over event id, timestamp and raw body", () => {
    const rawBody = Buffer.from("{\"event_id\":\"evt_1\"}", "utf8");
    const timestamp = "1785237600";
    const eventId = "019f7841-4b12-7a2f-a42b-5c3a72e3b277";
    const secret = "sandbox-webhook-secret";
    const signature = createHmac("sha256", secret)
      .update(Buffer.concat([Buffer.from(`${eventId}.${timestamp}.`, "utf8"), rawBody]))
      .digest("hex");

    expect(verifyArcPayWebhookSignature({
      eventId,
      now: new Date(Number(timestamp) * 1000),
      rawBody,
      secret,
      signature: `t=${timestamp},v1=${signature}`,
      timestamp,
    })).toBe(true);
    expect(verifyArcPayWebhookSignature({
      eventId,
      now: new Date(Number(timestamp) * 1000),
      rawBody,
      secret,
      signature: `t=${timestamp},v1=${"0".repeat(64)}`,
      timestamp,
    })).toBe(false);
  });
});

describe("Arc Pay signature replay and raw body guards", () => {
  const timestamp = "1785237600", eventId = "event-test", secret = "test-only-webhook-secret";
  const rawBody = Buffer.from('{ "event_type": "payment.captured", "description": "СБП" }');
  const sig = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${eventId}.${timestamp}.`), rawBody])).digest("hex");
  const command = { timestamp, eventId, secret, rawBody, now: new Date(Number(timestamp) * 1000), signature: `t=${timestamp},v1=${sig}` };
  it("accepts rotation with one valid signature", () => {
    expect(verifyArcPayWebhookSignature({ ...command, signature: `t=${timestamp},v1=${"0".repeat(64)},v1=${sig}` })).toBe(true);
  });
  it.each([-301, 301])("rejects stale/future timestamps (%i seconds)", (seconds) => {
    expect(verifyArcPayWebhookSignature({ ...command, now: new Date((Number(timestamp) + seconds) * 1000) })).toBe(false);
  });
  it("rejects reserialized bodies, changed event ids and mismatched header timestamp", () => {
    expect(verifyArcPayWebhookSignature({ ...command, rawBody: Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()) as unknown)) })).toBe(false);
    expect(verifyArcPayWebhookSignature({ ...command, eventId: "another-event" })).toBe(false);
    expect(verifyArcPayWebhookSignature({ ...command, timestamp: String(Number(timestamp) + 1) })).toBe(false);
  });
  it("rejects missing or malformed authentication fields", () => {
    expect(verifyArcPayWebhookSignature({ timestamp, eventId, secret, now: command.now, signature: command.signature })).toBe(false);
    for (const update of [{ secret: "" }, { eventId: "" }, { timestamp: "1e9" }, { signature: `t=${timestamp},v1=xx` }, { now: new Date("invalid") }]) {
      expect(verifyArcPayWebhookSignature({ ...command, ...update })).toBe(false);
    }
  });
});
