import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const steamId64 = "76561198000000002";
const userId = `user_${steamId64}`;

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

describe.skipIf(!databaseUrl)("fulfillment trade history projection", () => {
  let app: INestApplication | null = null;
  let pool: Pool;
  let sessions: SessionsService;
  let users: UsersService;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    await app?.close();
    await pool.end();
  });

  beforeEach(async () => {
    if (app) await app.close();
    await pool.query(`
      TRUNCATE
        fulfillment_provider_attempts,
        fulfillment_commands,
        cart_items,
        carts,
        order_lines,
        orders,
        wallet_holds,
        wallet_ledger_entries,
        wallet_transactions,
        audit_events,
        steam_trade_credentials,
        steam_openid_assertions,
        steam_auth_attempts,
        user_sessions,
        users
      RESTART IDENTITY
    `);
    const currentApp = await createApp();
    app = currentApp;
    sessions = currentApp.get(SessionsService);
    users = currentApp.get(UsersService);
    await users.upsertSteamUser({
      claimedIdentifier: `https://steamcommunity.com/openid/id/${steamId64}`,
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-29T10:00:00Znonce",
      steamId64,
    });
    await users.upsertSteamUser({
      claimedIdentifier: "https://steamcommunity.com/openid/id/76561198000000003",
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-29T10:00:01Znonce",
      steamId64: "76561198000000003",
    });
  });

  it("projects current-user skin fulfillment events without provider secrets or refill rows", async () => {
    const orders = await pool.query<{ id: string }>(
      `
        INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots, created_at)
        VALUES
          ($1, 'trade-history-current', 'hash-current', 'partially_fulfilled', 393000, '[]'::jsonb, '2026-07-29T09:00:00.000Z'),
          ($2, 'trade-history-other', 'hash-other', 'fulfilled', 318000, '[]'::jsonb, '2026-07-29T09:01:00.000Z')
        RETURNING id
      `,
      [userId, "user_76561198000000003"],
    );
    const orderId = orders.rows[0]?.id;
    const otherOrderId = orders.rows[1]?.id;
    if (orderId === undefined || otherOrderId === undefined) throw new Error("Expected order ids");
    const lines = await pool.query<{ id: string }>(
      `
        INSERT INTO order_lines (order_id, line_index, product_id, product_slug, kind, title, unit_price_coin_minor, quantity, recipient_snapshot, status, created_at)
        VALUES
          ($1, 0, 'deagle', 'desert-eagle-printstream', 'skins', 'Desert Eagle | Printstream', 318000, 1, '{"kind":"steam-trade","steamId64":"76561198000000002","steamTradePartnerAccountId":"39734273","token":"secret"}'::jsonb, 'supplier_finished', '2026-07-29T09:10:00.000Z'),
          ($1, 1, 'steam-top-up-500', 'steam-top-up-500-rub', 'steam', 'Пополнение Steam на 500 RUB', 75000, 1, '{"kind":"steam-refill","steamLogin":"shards_sandbox_user"}'::jsonb, 'supplier_finished', '2026-07-29T09:11:00.000Z'),
          ($1, 2, 'ak47', 'ak-47-redline', 'skins', 'AK-47 | Redline', 220000, 1, '{"kind":"steam-trade","steamId64":"76561198000000002","steamTradePartnerAccountId":"39734273"}'::jsonb, 'supplier_sent', '2026-07-29T09:12:00.000Z'),
          ($2, 0, 'other-skin', 'other-skin', 'skins', 'Other User Skin', 318000, 1, '{"kind":"steam-trade","steamId64":"76561198000000003","steamTradePartnerAccountId":"39734274"}'::jsonb, 'supplier_finished', '2026-07-29T09:13:00.000Z')
        RETURNING id
      `,
      [orderId, otherOrderId],
    );
    const [finishedLine, steamLine, sentLine, otherLine] = lines.rows.map((line) => line.id);
    if (finishedLine === undefined || steamLine === undefined || sentLine === undefined || otherLine === undefined) throw new Error("Expected order line ids");
    await pool.query(
      `
        INSERT INTO fulfillment_commands (id, order_id, order_line_id, provider, command_type, status, idempotency_key, payload_snapshot, finished_at, created_at, updated_at)
        VALUES
          ('11111111-1111-4111-8111-111111111111', $1, $2, 'sih', 'sih_skin_purchase', 'completed', 'cmd-finished', '{"token":"secret"}'::jsonb, '2026-07-29T09:20:00.000Z', '2026-07-29T09:14:00.000Z', '2026-07-29T09:20:00.000Z'),
          ('22222222-2222-4222-8222-222222222222', $1, $3, 'sih', 'sih_steam_refill', 'completed', 'cmd-refill', '{}'::jsonb, '2026-07-29T09:21:00.000Z', '2026-07-29T09:15:00.000Z', '2026-07-29T09:21:00.000Z'),
          ('33333333-3333-4333-8333-333333333333', $1, $4, 'sih', 'sih_skin_purchase', 'submitted', 'cmd-sent', '{}'::jsonb, NULL, '2026-07-29T09:16:00.000Z', '2026-07-29T09:22:00.000Z'),
          ('44444444-4444-4444-8444-444444444444', $5, $6, 'sih', 'sih_skin_purchase', 'completed', 'cmd-other', '{}'::jsonb, '2026-07-29T09:23:00.000Z', '2026-07-29T09:17:00.000Z', '2026-07-29T09:23:00.000Z')
      `,
      [orderId, finishedLine, steamLine, sentLine, otherOrderId, otherLine],
    );
    await pool.query(
      `
        INSERT INTO fulfillment_provider_attempts (command_id, order_id, order_line_id, provider, operation, status, idempotency_key, provider_order_id, request_snapshot, response_snapshot, created_at, finished_at)
        VALUES
          ('11111111-1111-4111-8111-111111111111', $1, $2, 'sih', 'get_order', 'succeeded', 'attempt-finished', 'provider-finished', '{"token":"secret"}'::jsonb, '{"status":"finished","protection":{"status":"finished"},"secret":"hidden"}'::jsonb, '2026-07-29T09:20:00.000Z', '2026-07-29T09:20:01.000Z'),
          ('33333333-3333-4333-8333-333333333333', $1, $3, 'sih', 'get_order', 'succeeded', 'attempt-sent', 'provider-sent', '{}'::jsonb, '{"status":"finished","protection":{"status":"processing"}}'::jsonb, '2026-07-29T09:22:00.000Z', '2026-07-29T09:22:01.000Z')
      `,
      [orderId, finishedLine, sentLine],
    );
    const session = await sessions.createSession(userId, null);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/fulfillment/me/trades")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .expect(200)
      .expect(({ body }) => {
        const responseBody = body as unknown;
        expect(isRecord(responseBody)).toBe(true);
        if (!isRecord(responseBody)) throw new Error("Trade history body is not an object.");
        expect(isUnknownArray(responseBody.events)).toBe(true);
        if (!isUnknownArray(responseBody.events)) throw new Error("Trade history events are not an array.");
        expect(responseBody.events).toHaveLength(2);
        const [sent, finished] = responseBody.events;
        expect(isRecord(sent)).toBe(true);
        expect(isRecord(finished)).toBe(true);
        if (!isRecord(sent) || typeof sent.id !== "string") throw new Error("Sent event id is not a string.");
        if (!isRecord(finished) || typeof finished.id !== "string") throw new Error("Finished event id is not a string.");
        expect(responseBody).toEqual({
          events: [
            {
              createdAt: "2026-07-29T09:22:00.000Z",
              direction: "purchase",
              id: sent.id,
              itemId: sentLine,
              orderNumber: `VLT-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
              status: "trade_protection",
              title: "AK-47 | Redline",
            },
            {
              createdAt: "2026-07-29T09:20:00.000Z",
              direction: "purchase",
              id: finished.id,
              itemId: finishedLine,
              orderNumber: `VLT-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
              status: "completed",
              title: "Desert Eagle | Printstream",
            },
          ],
        });
        expect(JSON.stringify(responseBody)).not.toContain("secret");
        expect(JSON.stringify(responseBody)).not.toContain("provider-finished");
        expect(JSON.stringify(responseBody)).not.toContain("Пополнение Steam");
        expect(JSON.stringify(responseBody)).not.toContain("Other User Skin");
      });
  });
});
