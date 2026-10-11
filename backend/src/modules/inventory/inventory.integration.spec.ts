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

describe.skipIf(!databaseUrl)("inventory projection", () => {
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

  it("lists only the current user's finished skin lines as read-only inventory items", async () => {
    const order = await pool.query<{ id: string }>(
      `
        INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots, updated_at)
        VALUES ($1, 'checkout-inventory-owner', 'hash-inventory-owner', 'fulfilled', 350000, '[]'::jsonb, '2026-07-29T09:15:00.000Z')
        RETURNING id
      `,
      [userId],
    );
    const orderId = order.rows[0]?.id;
    if (orderId === undefined) throw new Error("Expected owner order id");
    await pool.query(
      `
        INSERT INTO order_lines (
          order_id,
          line_index,
          product_id,
          product_slug,
          kind,
          title,
          unit_price_coin_minor,
          quantity,
          recipient_snapshot,
          status,
          created_at
        )
        VALUES
          ($1, 0, 'desert-eagle-printstream', 'desert-eagle-printstream', 'skins', 'Desert Eagle | Printstream', 318000, 1, '{"kind":"steam-trade","steamId64":"76561198000000002","steamTradePartnerAccountId":"39734273","token":"secret"}'::jsonb, 'supplier_finished', '2026-07-29T09:10:00.000Z'),
          ($1, 1, 'steam-top-up-500', 'steam-top-up-500-rub', 'steam', 'Пополнение Steam на 500 RUB', 75000, 1, '{"kind":"steam-refill","steamLogin":"shards_sandbox_user"}'::jsonb, 'supplier_finished', '2026-07-29T09:11:00.000Z'),
          ($1, 2, 'ak-redline', 'ak-redline', 'skins', 'AK-47 | Redline', 200000, 1, '{"kind":"steam-trade","steamId64":"76561198000000002","steamTradePartnerAccountId":"39734273"}'::jsonb, 'supplier_failed', '2026-07-29T09:12:00.000Z')
      `,
      [orderId],
    );
    await pool.query(
      `
        INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots)
        VALUES ('user_76561198000000003', 'checkout-inventory-other', 'hash-inventory-other', 'fulfilled', 318000, '[]'::jsonb)
        RETURNING id
      `,
    );
    await pool.query(
      `
        INSERT INTO order_lines (
          order_id,
          line_index,
          product_id,
          product_slug,
          kind,
          title,
          unit_price_coin_minor,
          quantity,
          recipient_snapshot,
          status
        )
        SELECT id, 0, 'desert-eagle-printstream', 'desert-eagle-printstream', 'skins', 'Other User Skin', 318000, 1, '{}'::jsonb, 'supplier_finished'
        FROM orders
        WHERE user_id = 'user_76561198000000003'
      `,
    );

    const session = await sessions.createSession(userId, null);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/inventory/me")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .expect(200)
      .expect(({ body }) => {
        const responseBody = body as unknown;
        expect(isRecord(responseBody)).toBe(true);
        if (!isRecord(responseBody)) throw new Error("Inventory response body is not an object.");
        expect(isUnknownArray(responseBody.items)).toBe(true);
        if (!isUnknownArray(responseBody.items)) throw new Error("Inventory response items are not an array.");
        const items = responseBody.items;
        expect(items).toHaveLength(1);
        const [item] = items;
        expect(isRecord(item)).toBe(true);
        if (!isRecord(item) || typeof item.id !== "string") throw new Error("Inventory item id is not a string.");
        expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(responseBody).toEqual({
          items: [
            {
              actions: {
                sellToSite: { enabled: false, reason: "not_supported" },
                withdrawToSteam: { enabled: false, reason: "steam_trade_url_required" },
              },
              acquiredAt: "2026-07-29T09:10:00.000Z",
              id: item.id,
              orderId,
              productSlug: "desert-eagle-printstream",
              status: "owned",
              title: "Desert Eagle | Printstream",
              unitPriceCoinMinor: 318000,
            },
          ],
        });
        expect(JSON.stringify(body)).not.toContain("secret");
        expect(JSON.stringify(body)).not.toContain("steamTradePartnerAccountId");
        expect(JSON.stringify(body)).not.toContain("Other User Skin");
        expect(JSON.stringify(body)).not.toContain("Пополнение Steam");
      });
  });

  it("does not expose a second withdrawal for an already delivered skin", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    const order = await pool.query<{ id: string }>(
      `
        INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots, updated_at)
        VALUES ($1, 'checkout-withdraw-owner', 'hash-withdraw-owner', 'fulfilled', 318000, '[]'::jsonb, '2026-07-29T09:15:00.000Z')
        RETURNING id
      `,
      [userId],
    );
    const orderId = order.rows[0]?.id;
    if (orderId === undefined) throw new Error("Expected owner order id");
    const line = await pool.query<{ id: string }>(
      `
        INSERT INTO order_lines (
          order_id,
          line_index,
          product_id,
          product_slug,
          kind,
          title,
          unit_price_coin_minor,
          quantity,
          recipient_snapshot,
          status,
          created_at
        )
        VALUES ($1, 0, 'desert-eagle-printstream', 'desert-eagle-printstream', 'skins', 'Desert Eagle | Printstream', 318000, 1, '{"kind":"steam-trade","steamId64":"76561198000000002","steamTradePartnerAccountId":"39734273","token":"secret"}'::jsonb, 'supplier_finished', '2026-07-29T09:10:00.000Z')
        RETURNING id
      `,
      [orderId],
    );
    const itemId = line.rows[0]?.id;
    if (itemId === undefined) throw new Error("Expected item id");
    await pool.query(
      `
        INSERT INTO fulfillment_commands (order_id, order_line_id, provider, command_type, status, idempotency_key, payload_snapshot, finished_at)
        VALUES ($1, $2, 'sih', 'sih_skin_purchase', 'completed', 'purchase-command', '{"token":"secret"}'::jsonb, '2026-07-29T09:12:00.000Z')
      `,
      [orderId, itemId],
    );
    const session = await sessions.createSession(userId, null);
    const sessionCookie = `${CUSTOMER_SESSION_COOKIE}=${session.token}`;
    const csrfToken = sessions.createCsrfToken(session.token);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post(`/inventory/me/items/${itemId}/withdrawals`).set("Cookie",sessionCookie).set("x-csrf-token",csrfToken).set("idempotency-key","removed-withdrawal").send({}).expect(404);
    const commands=await pool.query<{command_type:string}>('SELECT command_type FROM fulfillment_commands WHERE order_line_id=$1',[itemId]);
    expect(commands.rows).toEqual([{command_type:'sih_skin_purchase'}]);
  });
});
