import { verify } from "node:crypto";

export function verifyArcoPayWebhookSignature(input: { rawBody?: Buffer; signature?: string; publicKey: string }): boolean {
  if (!input.rawBody || !input.signature || input.signature.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.signature)) return false;
  try {
    const signature = Buffer.from(input.signature, "base64");
    if (signature.toString("base64") !== input.signature) return false;
    return verify("RSA-SHA1", input.rawBody, input.publicKey.replace(/\\n/g, "\n").trim(), signature);
  } catch { return false; }
}
