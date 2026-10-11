import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { OPENID_NAMESPACE, STEAM_OPENID_ENDPOINT } from "./steam-openid";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;

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

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("auth PostgreSQL persistence", () => {
  let pool: Pool;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_BASE_URL = "https://shards.example";
    process.env.STEAM_OPENID_TEST_NOW = "2026-07-27T10:01:00Z";
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.STEAM_OPENID_TEST_NOW;
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE
        audit_events,
        steam_trade_credentials,
        steam_openid_assertions,
        steam_auth_attempts,
        user_sessions,
        users
      RESTART IDENTITY
    `);
  });

  it("persists Steam attempts, users, sessions, and write-only Trade URL across app instances", async () => {
    const firstApp = await createApp();
    const start = await request(firstApp.getHttpServer() as Parameters<typeof request>[0])
      .get("/auth/steam/start")
      .query({ returnTo: "/checkout" })
      .expect(302);
    const authCookie = setCookie(start, "__Host-shards_steam_auth");
    await firstApp.close();

    const secondApp = await createApp();
    const callback = await request(secondApp.getHttpServer() as Parameters<typeof request>[0])
      .get(`/auth/steam/callback?${callbackQuery(start.headers.location as string)}`)
      .set("Cookie", authCookie)
      .expect(302);
    expect(callback.headers.location).toBe("/checkout");
    const sessionCookie = setCookie(callback, "__Host-shards_session");

    const csrf = await request(secondApp.getHttpServer() as Parameters<typeof request>[0])
      .get("/session/csrf")
      .set("Cookie", sessionCookie)
      .expect(200);
    const csrfBody = csrf.body as { token: string };

    await request(secondApp.getHttpServer() as Parameters<typeof request>[0])
      .put("/me/steam-trade-url")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfBody.token)
      .send({ tradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=39734273&token=secretToken" })
      .expect(200, { configured: true });
    await secondApp.close();

    const thirdApp = await createApp();
    await request(thirdApp.getHttpServer() as Parameters<typeof request>[0])
      .get("/session/me")
      .set("Cookie", sessionCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "user_76561198000000001",
          steam: {
            connected: true,
            steamId64: "76561198000000001",
          },
        });
        expect(JSON.stringify(body)).not.toContain("secretToken");
      });
    await request(thirdApp.getHttpServer() as Parameters<typeof request>[0])
      .get("/me/steam-trade-url/status")
      .set("Cookie", sessionCookie)
      .expect(200, { configured: true });
    await thirdApp.close();

    const persisted = await pool.query<{ count: string }>(
      "SELECT count(*) FROM users UNION ALL SELECT count(*) FROM user_sessions UNION ALL SELECT count(*) FROM steam_auth_attempts UNION ALL SELECT count(*) FROM steam_trade_credentials",
    );
    expect(persisted.rows.map((row) => Number(row.count))).toEqual([1, 1, 1, 1]);
  });
});
