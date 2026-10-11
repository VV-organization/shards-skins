import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CUSTOMER_SESSION_COOKIE = "__Host-shards_session";
export const STEAM_AUTH_BROWSER_COOKIE = "__Host-shards_steam_auth";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CSRF_PATTERN = /^(v1)\.([A-Za-z0-9_-]{43})$/;
type CookieSameSite = "Lax" | "None";

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function parseExactCookie(cookieHeader: string | undefined, name: string): string | null {
  if (cookieHeader === undefined) return null;
  const values: string[] = [];
  for (const segment of cookieHeader.split(";")) {
    const trimmed = segment.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    if (trimmed.slice(0, separator) === name) values.push(trimmed.slice(separator + 1));
  }
  if (values.length === 0) return null;
  if (values.length !== 1 || !TOKEN_PATTERN.test(values[0] as string)) throw new Error("Cookie is ambiguous or malformed");
  return values[0] as string;
}

export function secureCookie(
  name: string,
  value: string,
  maximumAgeSeconds: number,
  sameSite: CookieSameSite = "Lax",
): string {
  return `${name}=${value}; Max-Age=${maximumAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function clearSecureCookie(name: string, sameSite: CookieSameSite = "Lax"): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function secureCustomerSessionCookie(value: string, maximumAgeSeconds: number): string {
  return secureCookie(CUSTOMER_SESSION_COOKIE, value, maximumAgeSeconds, "None");
}

export function clearCustomerSessionCookie(): string {
  return clearSecureCookie(CUSTOMER_SESSION_COOKIE, "None");
}

export function createCsrfToken(sessionToken: string, secret: Buffer): string {
  if (!TOKEN_PATTERN.test(sessionToken)) throw new Error("Customer session token is malformed");
  const mac = createHmac("sha256", secret)
    .update("shards\u0000customer-csrf\u0000", "utf8")
    .update(sessionToken, "utf8")
    .digest("base64url");
  return `v1.${mac}`;
}

export function verifyCsrfToken(sessionToken: string, csrfToken: string, secret: Buffer): boolean {
  if (!TOKEN_PATTERN.test(sessionToken)) return false;
  const match = CSRF_PATTERN.exec(csrfToken);
  if (match?.[2] === undefined) return false;
  const supplied = Buffer.from(match[2], "base64url");
  const expected = Buffer.from(createCsrfToken(sessionToken, secret).slice(3), "base64url");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
