import { SihProviderError } from "./sih.client";

const MAXIMUM_RETRY_AFTER_MS = 3_600_000;
const MINIMUM_RETRY_AFTER_MS = 1_000;

export function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  if (contentType === null) return false;
  const [mediaType] = contentType.split(";", 1);
  return mediaType?.trim().toLowerCase() === "application/json";
}

export function retryAfterMs(response: Response, now = new Date()): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;
  let delayMs: number;
  if (/^(?:0|[1-9][0-9]*)$/.test(value)) {
    delayMs = Number(value) * 1_000;
  } else {
    delayMs = Date.parse(value) - now.getTime();
  }
  if (!Number.isFinite(delayMs)) return undefined;
  return Math.min(Math.max(delayMs, MINIMUM_RETRY_AFTER_MS), MAXIMUM_RETRY_AFTER_MS);
}

export async function cancelBody(response: Response): Promise<void> {
  if (response.body === null || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Preserve the original sanitized provider failure.
  }
}

export async function readBoundedBody(response: Response, maximumBodyBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes <= 0) {
    throw new Error("SIH_MAXIMUM_BODY_BYTES_INVALID");
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || BigInt(contentLength) > BigInt(maximumBodyBytes))
  ) {
    await cancelBody(response);
    throw new SihProviderError("retryable", "SIH_RESPONSE_TOO_LARGE");
  }
  if (response.body === null) return "";
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read() as { done: true; value?: undefined } | { done: false; value: Uint8Array };
      if (chunk.done) break;
      const value = chunk.value;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBodyBytes) {
        await reader.cancel();
        throw new SihProviderError("retryable", "SIH_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function classifyHttpFailure(status: number): SihProviderError {
  if (status === 401 || status === 403) return new SihProviderError("permanent", "SIH_AUTHENTICATION_INVALID");
  if (status === 429) return new SihProviderError("retryable", "SIH_RATE_LIMITED");
  if (status === 408 || (status >= 500 && status <= 599)) return new SihProviderError("retryable", "SIH_PROVIDER_UNAVAILABLE");
  if (status >= 400 && status <= 499) return new SihProviderError("permanent", "SIH_REQUEST_REJECTED");
  return new SihProviderError("retryable", "SIH_CONTRACT_SUSPECT");
}
