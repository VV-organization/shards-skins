import { BadRequestException } from "@nestjs/common";

import { canonicalSteamId64, type VerifiedSteamIdentity } from "../users/steam-identity";

export const STEAM_OPENID_PROVIDER_IDENTIFIER = "https://steamcommunity.com/openid/";
export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
export const OPENID_NAMESPACE = "http://specs.openid.net/auth/2.0";
export const OPENID_IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";

const CALLBACK_FIELDS = new Set([
  "openid.ns",
  "openid.mode",
  "openid.op_endpoint",
  "openid.claimed_id",
  "openid.identity",
  "openid.return_to",
  "openid.response_nonce",
  "openid.invalidate_handle",
  "openid.assoc_handle",
  "openid.signed",
  "openid.sig",
]);

const REQUIRED_FIELDS = [
  "openid.ns",
  "openid.mode",
  "openid.op_endpoint",
  "openid.claimed_id",
  "openid.identity",
  "openid.return_to",
  "openid.response_nonce",
  "openid.assoc_handle",
  "openid.signed",
  "openid.sig",
] as const;

const REQUIRED_SIGNED_FIELDS = [
  "op_endpoint",
  "claimed_id",
  "identity",
  "return_to",
  "response_nonce",
  "assoc_handle",
] as const;

export type ParsedOpenIdCallback = {
  identity: VerifiedSteamIdentity;
  openIdFields: URLSearchParams;
};

export type ParseOpenIdCallbackInput = {
  expectedReturnTo: URL;
  futureSkewSeconds: number;
  maximumNonceAgeSeconds: number;
  now: Date;
  rawQuery: string;
};

function invalidCallback(): BadRequestException {
  return new BadRequestException("Invalid Steam Authentication");
}

export function createSteamAuthenticationUrl(returnTo: URL, realm: URL): URL {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  url.searchParams.set("openid.ns", OPENID_NAMESPACE);
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.claimed_id", OPENID_IDENTIFIER_SELECT);
  url.searchParams.set("openid.identity", OPENID_IDENTIFIER_SELECT);
  url.searchParams.set("openid.return_to", returnTo.toString());
  url.searchParams.set("openid.realm", realm.toString());
  return url;
}

function parseClaimedIdentifier(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidCallback();
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.hostname !== "steamcommunity.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalidCallback();
  }
  const match = /^\/openid\/id\/([^/]+)$/.exec(url.pathname);
  if (match?.[1] === undefined) throw invalidCallback();
  try {
    return canonicalSteamId64(match[1]);
  } catch {
    throw invalidCallback();
  }
}

function parseUniqueQuery(rawQuery: string): URLSearchParams {
  if (rawQuery.length === 0 || Buffer.byteLength(rawQuery, "utf8") > 65_536) throw invalidCallback();
  const parameters = new URLSearchParams(rawQuery);
  const names = new Set<string>();
  let count = 0;
  for (const [name, value] of parameters) {
    count += 1;
    if (
      count > 32 ||
      names.has(name) ||
      Buffer.byteLength(name, "utf8") > 128 ||
      Buffer.byteLength(value, "utf8") > 4_096 ||
      (name !== "state" && !CALLBACK_FIELDS.has(name))
    ) {
      throw invalidCallback();
    }
    names.add(name);
  }
  return parameters;
}

function validateNonce(value: string, input: ParseOpenIdCallbackInput): void {
  if (value.length > 255) throw invalidCallback();
  const timestamp = value.slice(0, 20);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) throw invalidCallback();
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) throw invalidCallback();
  const age = input.now.getTime() - time;
  if (age > input.maximumNonceAgeSeconds * 1_000 || age < -input.futureSkewSeconds * 1_000) {
    throw invalidCallback();
  }
}

export function parseOpenIdCallback(input: ParseOpenIdCallbackInput): ParsedOpenIdCallback {
  const parameters = parseUniqueQuery(input.rawQuery);
  for (const field of REQUIRED_FIELDS) {
    if (parameters.get(field) === null) throw invalidCallback();
  }

  if (
    parameters.get("openid.ns") !== OPENID_NAMESPACE ||
    parameters.get("openid.mode") !== "id_res" ||
    parameters.get("openid.op_endpoint") !== STEAM_OPENID_ENDPOINT ||
    parameters.get("openid.return_to") !== input.expectedReturnTo.toString()
  ) {
    throw invalidCallback();
  }

  const expectedState = input.expectedReturnTo.searchParams.get("state");
  if (expectedState === null || parameters.get("state") !== expectedState) throw invalidCallback();

  const claimedIdentifier = parameters.get("openid.claimed_id") as string;
  if (parameters.get("openid.identity") !== claimedIdentifier) throw invalidCallback();
  const steamId64 = parseClaimedIdentifier(claimedIdentifier);
  const responseNonce = parameters.get("openid.response_nonce") as string;
  validateNonce(responseNonce, input);

  const signed = (parameters.get("openid.signed") as string).split(",");
  if (
    signed.some((field) => field.length === 0) ||
    new Set(signed).size !== signed.length ||
    REQUIRED_SIGNED_FIELDS.some((field) => !signed.includes(field))
  ) {
    throw invalidCallback();
  }

  const openIdFields = new URLSearchParams();
  for (const [name, value] of parameters) {
    if (name.startsWith("openid.")) openIdFields.append(name, value);
  }

  return {
    identity: {
      claimedIdentifier,
      providerEndpoint: STEAM_OPENID_ENDPOINT,
      responseNonce,
      steamId64,
    },
    openIdFields,
  };
}

export function buildCheckAuthenticationBody(openIdFields: URLSearchParams): URLSearchParams {
  const body = new URLSearchParams();
  for (const [name, value] of openIdFields) {
    body.append(name, name === "openid.mode" ? "check_authentication" : value);
  }
  return body;
}
