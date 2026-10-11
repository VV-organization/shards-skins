import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_WEBHOOK_CLOCK_SKEW_SECONDS = 300;

function signatureParts(signatureHeader: string): { signatures: string[]; timestamp?: string } {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  return {
    signatures: parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3)),
    ...(timestamp === undefined ? {} : { timestamp }),
  };
}

export function verifyArcPayWebhookSignature(command: {
  eventId?: string;
  now?: Date;
  rawBody?: Buffer;
  secret: string;
  signature?: string;
  timestamp?: string;
}): boolean {
  if (
    !command.secret.trim() ||
    !command.eventId?.trim() ||
    command.rawBody === undefined ||
    command.signature === undefined ||
    command.timestamp === undefined
  ) {
    return false;
  }
  const parsed = signatureParts(command.signature);
  if (parsed.timestamp === undefined || parsed.timestamp !== command.timestamp || parsed.signatures.length === 0) return false;

  const timestampSeconds = Number(command.timestamp);
  if (!/^[0-9]+$/.test(command.timestamp) || !Number.isSafeInteger(timestampSeconds)) return false;
  const nowSeconds = Math.floor((command.now ?? new Date()).getTime() / 1000);
  if (!Number.isFinite(nowSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_WEBHOOK_CLOCK_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", command.secret)
    .update(Buffer.concat([
      Buffer.from(`${command.eventId}.${command.timestamp}.`, "utf8"),
      command.rawBody,
    ]))
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return parsed.signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  });
}
