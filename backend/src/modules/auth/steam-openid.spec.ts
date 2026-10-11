import { describe, expect, it } from "vitest";

import {
  OPENID_NAMESPACE,
  STEAM_OPENID_ENDPOINT,
  createSteamAuthenticationUrl,
  parseOpenIdCallback,
} from "./steam-openid";

function signedCallbackQuery(returnTo: URL): string {
  const parameters = new URLSearchParams();
  parameters.set("state", returnTo.searchParams.get("state") ?? "");
  parameters.set("openid.ns", OPENID_NAMESPACE);
  parameters.set("openid.mode", "id_res");
  parameters.set("openid.op_endpoint", STEAM_OPENID_ENDPOINT);
  parameters.set("openid.claimed_id", "https://steamcommunity.com/openid/id/76561198000000001");
  parameters.set("openid.identity", "https://steamcommunity.com/openid/id/76561198000000001");
  parameters.set("openid.return_to", returnTo.toString());
  parameters.set("openid.response_nonce", "2026-07-27T10:00:00Znonce");
  parameters.set("openid.assoc_handle", "assoc");
  parameters.set("openid.signed", "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle");
  parameters.set("openid.sig", "signature");
  return parameters.toString();
}

describe("Steam OpenID boundary", () => {
  it("builds a Steam challenge with state-bound return_to and realm", () => {
    const returnTo = new URL("https://shards.example/auth/steam/callback?state=state_123");
    const url = createSteamAuthenticationUrl(returnTo, new URL("https://shards.example/"));

    expect(url.origin + url.pathname).toBe(STEAM_OPENID_ENDPOINT);
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.return_to")).toBe(returnTo.toString());
    expect(url.searchParams.get("openid.realm")).toBe("https://shards.example/");
  });

  it("extracts SteamID64 only from a signed, fresh, state-matching Steam callback", () => {
    const returnTo = new URL("https://shards.example/auth/steam/callback?state=state_123");

    expect(parseOpenIdCallback({
      expectedReturnTo: returnTo,
      futureSkewSeconds: 60,
      maximumNonceAgeSeconds: 300,
      now: new Date("2026-07-27T10:01:00Z"),
      rawQuery: signedCallbackQuery(returnTo),
    }).identity.steamId64).toBe("76561198000000001");

    const wrongReturnTo = new URL("https://shards.example/auth/steam/callback?state=other");
    expect(() => parseOpenIdCallback({
      expectedReturnTo: wrongReturnTo,
      futureSkewSeconds: 60,
      maximumNonceAgeSeconds: 300,
      now: new Date("2026-07-27T10:01:00Z"),
      rawQuery: signedCallbackQuery(returnTo),
    })).toThrow("Invalid Steam Authentication");
  });
});
