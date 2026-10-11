const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new Error("Idempotency key must be at most 128 characters.");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new Error("Idempotency key contains unsupported characters.");
  }
  return normalized;
}
