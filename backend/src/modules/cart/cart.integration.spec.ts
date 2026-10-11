import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const userId = "user_76561198000000004";
const steamId64 = "76561198000000004";

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("cart PostgreSQL persistence", () => {
  let app: INestApplication | null = null;
  let pool: Pool;
  let sessions: SessionsService;
  let users: UsersService;
  let wallet: WalletService;
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.query(
      "UPDATE catalog_products SET price_coin_minor = 318000 WHERE slug = 'desert-eagle-printstream'",
    );
    delete process.env.DATABASE_URL;
    await app?.close();
    await pool.end();
  });

  beforeEach(async () => {
    if (app) await app.close();
    await pool.query(`
      TRUNCATE
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
    await pool.query(
      "UPDATE catalog_products SET price_coin_minor = 318000 WHERE slug = 'desert-eagle-printstream'",
    );
    const currentApp = await createApp();
    app = currentApp;
    sessions = currentApp.get(SessionsService);
    users = currentApp.get(UsersService);
    wallet = currentApp.get(WalletService);
    await users.upsertSteamUser({
      claimedIdentifier: `https://steamcommunity.com/openid/id/${steamId64}`,
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T11:00:00Znonce",
      steamId64,
    });
    const session = await sessions.createSession(userId, null);
    sessionCookie = `${CUSTOMER_SESSION_COOKIE}=${session.token}`;
    csrfToken = sessions.createCsrfToken(session.token);
  });

  it("persists an authenticated cart and refreshes quotes from the current backend catalog", async () => {
    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .put("/cart/items/desert-eagle-printstream")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfToken)
      .send({ quantity: 2 })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          totalCoinMinor: 636_000,
          items: [
            {
              productSlug: "desert-eagle-printstream",
              quantity: 2,
              unitPriceCoinMinor: 318_000,
              lineTotalCoinMinor: 636_000,
            },
          ],
        });
      });

    await pool.query(
      "UPDATE catalog_products SET price_coin_minor = 321000 WHERE slug = 'desert-eagle-printstream'",
    );

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/cart")
      .set("Cookie", sessionCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          totalCoinMinor: 642_000,
          items: [
            {
              productSlug: "desert-eagle-printstream",
              quantity: 2,
              unitPriceCoinMinor: 321_000,
              lineTotalCoinMinor: 642_000,
            },
          ],
        });
      });
  });

  it("rejects Steam refill items because Steam is paid through direct RUB checkout", async () => {
    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .put("/cart/items/steam-top-up-500-rub")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfToken)
      .send({ quantity: 1, recipient: { steamLogin: "shards_sandbox_user" } })
      .expect(400);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/cart")
      .set("Cookie", sessionCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ totalCoinMinor: 0, items: [] });
      });
  });

  it("removes stale Steam refill items from an existing server cart", async () => {
    const cart = await pool.query<{ id: string }>(
      `
        INSERT INTO carts (user_id, status)
        VALUES ($1, 'active')
        ON CONFLICT (user_id, status) DO UPDATE
        SET updated_at = clock_timestamp()
        RETURNING id
      `,
      [userId],
    );
    await pool.query(
      `
        INSERT INTO cart_items (cart_id, product_slug, quantity, recipient)
        VALUES ($1, 'steam-top-up-500-rub', 1, '{"steamLogin":"shards_sandbox_user"}'::jsonb)
      `,
      [cart.rows[0]?.id],
    );

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/cart")
      .set("Cookie", sessionCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ totalCoinMinor: 0, items: [] });
      });

    await expect(pool.query("SELECT count(*)::text AS count FROM cart_items WHERE cart_id = $1", [cart.rows[0]?.id]))
      .resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("removes stale dynamic Steam refill items that were never seeded in the catalog table", async () => {
    const cart = await pool.query<{ id: string }>(
      `
        INSERT INTO carts (user_id, status)
        VALUES ($1, 'active')
        ON CONFLICT (user_id, status) DO UPDATE
        SET updated_at = clock_timestamp()
        RETURNING id
      `,
      [userId],
    );
    await pool.query(
      `
        INSERT INTO cart_items (cart_id, product_slug, quantity, recipient)
        VALUES ($1, 'steam-top-up-750-rub', 1, '{"steamLogin":"shards_sandbox_user"}'::jsonb)
      `,
      [cart.rows[0]?.id],
    );

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/cart")
      .set("Cookie", sessionCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ totalCoinMinor: 0, items: [] });
      });

    await expect(pool.query("SELECT count(*)::text AS count FROM cart_items WHERE cart_id = $1", [cart.rows[0]?.id]))
      .resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("checks out the current server cart quote and clears the cart after creating an order", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 321_000,
      idempotencyKey: "topup-credit-server-cart",
      reason: "test-credit",
    });

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .put("/cart/items/desert-eagle-printstream")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfToken)
      .send({ quantity: 1 })
      .expect(200);
    await pool.query(
      "UPDATE catalog_products SET price_coin_minor = 321000 WHERE slug = 'desert-eagle-printstream'",
    );

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/checkout/cart")
      .set("Cookie", sessionCookie)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "checkout-from-server-cart")
      .send({ acceptedTotalCoinMinor: 321_000 })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: "held",
          totalCoinMinor: 321_000,
          lines: [
            {
              productSlug: "desert-eagle-printstream",
              unitPriceCoinMinor: 321_000,
            },
          ],
        });
      });

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/cart")
      .set("Cookie", sessionCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ totalCoinMinor: 0, items: [] });
      });
  });
});
