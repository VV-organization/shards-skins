import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { verifyArcoPayWebhookSignature } from "./arco-pay-webhook-signature";

it("verifies RSA-SHA1 Payment-Sign over exact raw bytes and accepts PEM escaped newlines", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
  const rawBody = Buffer.from('{ "Response": { "Success": true }, "Order": { "Status": "IPS_ACCEPTED" } }');
  const signature = sign("RSA-SHA1", rawBody, keys.privateKey).toString("base64");
  expect(verifyArcoPayWebhookSignature({ rawBody, signature, publicKey })).toBe(true);
  expect(verifyArcoPayWebhookSignature({ rawBody, signature, publicKey: publicKey.replace(/\n/g, "\\n") })).toBe(true);
  expect(verifyArcoPayWebhookSignature({ rawBody: Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()))), signature, publicKey })).toBe(false);
  expect(verifyArcoPayWebhookSignature({ rawBody, signature: sign("RSA-SHA256", rawBody, keys.privateKey).toString("base64"), publicKey })).toBe(false);
  expect(verifyArcoPayWebhookSignature({ rawBody, signature, publicKey: "invalid" })).toBe(false);
});

it.each([undefined, "", "invalid!", "a".repeat(4097)])("rejects absent or malformed signatures %s", signature => {
  expect(verifyArcoPayWebhookSignature({ rawBody: Buffer.from("{}"), ...(signature === undefined ? {} : { signature }), publicKey: "invalid" })).toBe(false);
});
