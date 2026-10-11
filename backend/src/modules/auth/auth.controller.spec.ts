import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthModule } from "./auth.module";
import { OPENID_NAMESPACE, STEAM_OPENID_ENDPOINT } from "./steam-openid";

function setCookie(response: request.Response, cookieName: string): string {
  const header = response.headers["set-cookie"] as string[] | string | undefined;
  const cookies = Array.isArray(header) ? header : [header];
  const cookie = cookies.find((value): value is string => typeof value === "string" && value.startsWith(`${cookieName}=`));
  if (!cookie) throw new Error(`Missing ${cookieName} cookie`);
  const value = cookie.split(";")[0];
  if (!value) throw new Error(`Malformed ${cookieName} cookie`);
  return value;
}

function callbackQuery(location: string): string {
  const challenge = new URL(location);
  const returnTo = new URL(challenge.searchParams.get("openid.return_to") ?? "");
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

describe("AuthModule", () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = "https://shards.example";
    process.env.STEAM_OPENID_TEST_NOW = "2026-07-27T10:01:00Z";
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.STEAM_OPENID_TEST_NOW;
    await app.close();
  });

  it("creates a Steam challenge, validates callback state, and issues an HTTP-only session cookie", async () => {
    const start = await request(httpServer)
      .get("/auth/steam/start")
      .query({ returnTo: "/checkout" })
      .expect(302);

    expect(start.headers.location).toContain(STEAM_OPENID_ENDPOINT);
    const authCookie = setCookie(start, "__Host-shards_steam_auth");

    const callback = await request(httpServer)
      .get(`/auth/steam/callback?${callbackQuery(start.headers.location as string)}`)
      .set("Cookie", authCookie)
      .expect(302);

    expect(callback.headers.location).toBe("/checkout");
    const sessionCookieRaw = callback.headers["set-cookie"] as unknown;
    const sessionCookieHeader = Array.isArray(sessionCookieRaw) ? sessionCookieRaw.join("\n") : String(sessionCookieRaw);
    expect(sessionCookieHeader).toContain("__Host-shards_session=");
    expect(sessionCookieHeader).toContain("HttpOnly");
    expect(sessionCookieHeader).toContain("Secure");
    expect(sessionCookieHeader).toContain("SameSite=None");

    const authCookieRaw = start.headers["set-cookie"] as unknown;
    const authCookieHeader = Array.isArray(authCookieRaw) ? authCookieRaw.join("\n") : String(authCookieRaw);
    expect(authCookieHeader).toContain("__Host-shards_steam_auth=");
    expect(authCookieHeader).toContain("SameSite=Lax");

    const sessionCookie = setCookie(callback, "__Host-shards_session");
    const me = await request(httpServer)
      .get("/session/me")
      .set("Cookie", sessionCookie)
      .expect(200);
    expect(me.body).toMatchObject({
      id: "user_76561198000000001",
      steam: {
        steamId64: "76561198000000001",
        connected: true,
      },
    });

    const csrf = await request(httpServer)
      .get("/session/csrf")
      .set("Cookie", sessionCookie)
      .expect(200);
    const csrfBody = csrf.body as { token: string };
    expect(csrfBody.token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);

    await request(httpServer)
      .post("/session/logout")
      .set("Cookie", sessionCookie)
      .expect(403);

    await request(httpServer)
      .post("/session/logout")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfBody.token)
      .expect(204);

    await request(httpServer)
      .get("/session/me")
      .set("Cookie", sessionCookie)
      .expect(401);
  });

  it("redirects completed Steam auth to the configured frontend origin", async () => {
    const originalFrontendOrigin = process.env.PUBLIC_FRONTEND_ORIGIN;
    process.env.PUBLIC_FRONTEND_ORIGIN = "https://app.shards.example";
    try {
      const start = await request(httpServer)
        .get("/auth/steam/start")
        .query({ returnTo: "/balance/top-up" })
        .expect(302);

      const callback = await request(httpServer)
        .get(`/auth/steam/callback?${callbackQuery(start.headers.location as string).replace("2026-07-27T10%3A00%3A00Znonce", "2026-07-27T10%3A00%3A01Znonce")}`)
        .set("Cookie", setCookie(start, "__Host-shards_steam_auth"))
        .expect(302);

      expect(callback.headers.location).toBe("https://app.shards.example/balance/top-up");
    } finally {
      if (originalFrontendOrigin === undefined) {
        delete process.env.PUBLIC_FRONTEND_ORIGIN;
      } else {
        process.env.PUBLIC_FRONTEND_ORIGIN = originalFrontendOrigin;
      }
    }
  });

  it("stores Steam Trade URL as write-only account state behind session and CSRF", async () => {
    const start = await request(httpServer).get("/auth/steam/start").expect(302);
    const callback = await request(httpServer)
      .get(`/auth/steam/callback?${callbackQuery(start.headers.location as string)}`)
      .set("Cookie", setCookie(start, "__Host-shards_steam_auth"))
      .expect(302);
    const sessionCookie = setCookie(callback, "__Host-shards_session");
    const csrf = await request(httpServer).get("/session/csrf").set("Cookie", sessionCookie).expect(200);
    const csrfBody = csrf.body as { token: string };

    await request(httpServer)
      .put("/me/steam-trade-url")
      .set("Cookie", sessionCookie)
      .send({ tradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=39734273&token=secretToken" })
      .expect(403);

    await request(httpServer)
      .put("/me/steam-trade-url")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfBody.token)
      .send({ tradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=39734273&token=secretToken" })
      .expect(200, { configured: true });

    const status = await request(httpServer)
      .get("/me/steam-trade-url/status")
      .set("Cookie", sessionCookie)
      .expect(200);
    expect(status.body).toEqual({ configured: true });
    expect(JSON.stringify(status.body)).not.toContain("secretToken");
  });
});
