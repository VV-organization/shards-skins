import { BadRequestException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";
import { CheckoutInsufficientBalanceError, CheckoutPriceChangedError, CheckoutService } from "./checkout.service";
import { WalletService } from "../wallet/wallet.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const userId = "user_76561198000000002";
const steamId64 = "76561198000000002";

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("checkout PostgreSQL persistence", () => {
  let app: INestApplication | null = null;
  let pool: Pool;
  let checkout: CheckoutService;
  let wallet: WalletService;
  let users: UsersService;
  let sessions: SessionsService;

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
        notification_attempts,
        notification_outbox,
        vv_admin_integration_attempts,
        vv_admin_integration_outbox,
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
    await pool.query(
      "DELETE FROM supplier_listings WHERE supplier = 'sih' AND game = 'cs2' AND market_hash_name = 'Desert Eagle | Printstream (Minimal Wear)'",
    );
    await pool.query(
      "UPDATE catalog_products SET price_coin_minor = 318000 WHERE slug = 'desert-eagle-printstream'",
    );
    const currentApp = await createApp();
    app = currentApp;
    checkout = currentApp.get(CheckoutService);
    wallet = currentApp.get(WalletService);
    users = currentApp.get(UsersService);
    sessions = currentApp.get(SessionsService);
    await users.upsertSteamUser({
      claimedIdentifier: `https://steamcommunity.com/openid/id/${steamId64}`,
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T10:00:00Znonce",
      steamId64,
    });
  });

  it("creates independent order lines and an active Coins hold from posted wallet balance", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 636_000,
      idempotencyKey: "topup-credit-checkout-green",
      reason: "test-credit",
    });

    const order = await checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-skins-two-units",
      acceptedTotalCoinMinor: 636_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 2 }],
    });

    expect(order).toMatchObject({
      userId,
      status: "held",
      totalCoinMinor: 636_000,
      lines: [
        { productSlug: "desert-eagle-printstream", quantity: 1, unitPriceCoinMinor: 318_000 },
        { productSlug: "desert-eagle-printstream", quantity: 1, unitPriceCoinMinor: 318_000 },
      ],
    });
    expect(order.recipientSnapshots).toEqual([
      {
        kind: "steam-trade",
        steamId64,
        steamTradePartnerAccountId: "39734273",
      },
    ]);
    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 636_000,
      heldCoinMinor: 636_000,
      availableCoinMinor: 0,
    });

    const postedTransactionBalance = await pool.query<{ balance: string }>(
      `
        SELECT COALESCE(sum(amount_coin_minor), 0)::text AS balance
        FROM wallet_ledger_entries
        WHERE transaction_id IN (
          SELECT id
          FROM wallet_transactions
          WHERE idempotency_key = 'topup-credit-checkout-green'
        )
      `,
    );
    expect(postedTransactionBalance.rows[0]?.balance).toBe("0");

    const persisted = await pool.query<{ line_count: string; hold_count: string; slack_events: string; vv_admin_events: string }>(
      `
        SELECT
          (SELECT count(*) FROM order_lines WHERE order_id = $1) AS line_count,
          (SELECT count(*) FROM wallet_holds WHERE order_id = $1 AND status = 'active') AS hold_count,
          (SELECT count(*) FROM notification_outbox WHERE entity_id = $1::text AND channel = 'slack' AND event_type = 'order.slack-alert') AS slack_events,
          (SELECT count(*) FROM vv_admin_integration_outbox WHERE subject_external_id = $1::text AND event_type = 'order.created') AS vv_admin_events
      `,
      [order.id],
    );
    expect(persisted.rows[0]).toEqual({
      line_count: "2",
      hold_count: "1",
      slack_events: "1",
      vv_admin_events: "1",
    });
    const outbox = await pool.query<{ payload: unknown }>(
      "SELECT payload FROM vv_admin_integration_outbox WHERE subject_external_id = $1::text",
      [order.id],
    );
    expect(outbox.rows[0]?.payload).toMatchObject({
      schemaVersion: 2,
      eventType: "order.created",
      source: "customer",
      subject: { type: "order", externalId: order.id },
      data: {
        payment: {
          status: "paid",
          method: {
            type: "internal_balance",
            displayName: "Shards Coins",
            provider: null,
          },
        },
      },
    });
    expect(JSON.stringify(outbox.rows[0]?.payload)).not.toContain("secretToken");
  });

  it("creates pending SIH fulfillment commands atomically with order lines", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 318_000,
      idempotencyKey: "topup-credit-fulfillment-outbox",
      reason: "test-credit",
    });

    const order = await checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-fulfillment-outbox",
      acceptedTotalCoinMinor: 318_000,
      items: [
        { productSlug: "desert-eagle-printstream", quantity: 1 },
      ],
    });

    const commands = await pool.query<{
      provider: string;
      command_type: string;
      status: string;
      idempotency_key: string;
      payload_snapshot: {
        orderId: string;
        orderLineId: string;
        productSlug: string;
        recipientSnapshot: unknown;
      };
      product_slug: string;
    }>(
      `
        SELECT
          fulfillment_commands.provider,
          fulfillment_commands.command_type,
          fulfillment_commands.status,
          fulfillment_commands.idempotency_key,
          fulfillment_commands.payload_snapshot,
          order_lines.product_slug
        FROM fulfillment_commands
        JOIN order_lines ON order_lines.id = fulfillment_commands.order_line_id
        WHERE fulfillment_commands.order_id = $1
        ORDER BY order_lines.line_index ASC
      `,
      [order.id],
    );

    expect(commands.rows).toHaveLength(1);
    expect(commands.rows.map((command) => ({
      provider: command.provider,
      commandType: command.command_type,
      status: command.status,
      productSlug: command.product_slug,
    }))).toEqual([
      {
        provider: "sih",
        commandType: "sih_skin_purchase",
        status: "pending",
        productSlug: "desert-eagle-printstream",
      },
    ]);
    expect(new Set(commands.rows.map((command) => command.idempotency_key)).size).toBe(1);
    expect(commands.rows[0]?.idempotency_key).toContain(order.id);
    expect(commands.rows[0]?.payload_snapshot).toMatchObject({
      orderId: order.id,
      productSlug: "desert-eagle-printstream",
      recipientSnapshot: {
        kind: "steam-trade",
        steamId64,
        steamTradePartnerAccountId: "39734273",
      },
    });
    expect(JSON.stringify(commands.rows)).not.toContain("secretToken");
  });

  it("rejects Steam refill checkout from cart because Steam uses direct RUB payment", async () => {
    await wallet.creditUser({
      userId,
      amountCoinMinor: 75_000,
      idempotencyKey: "topup-credit-steam-refill-cart-rejected",
      reason: "test-credit",
    });

    await expect(checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-steam-refill-cart-rejected",
      acceptedTotalCoinMinor: 75_000,
      items: [{ productSlug: "steam-top-up-500-rub", quantity: 1, recipient: { steamLogin: "shards_sandbox_user" } }],
    })).rejects.toBeInstanceOf(BadRequestException);

    const persisted = await pool.query<{ holds: string; orders: string }>(
      `
        SELECT
          (SELECT count(*) FROM orders WHERE user_id = $1) AS orders,
          (SELECT count(*) FROM wallet_holds WHERE user_id = $1) AS holds
      `,
      [userId],
    );
    expect(persisted.rows[0]).toEqual({ holds: "0", orders: "0" });
  });

  it("does not create an order or hold when available Coins are insufficient", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 317_999,
      idempotencyKey: "topup-credit-too-small",
      reason: "test-credit",
    });

    await expect(checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-insufficient",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    })).rejects.toBeInstanceOf(CheckoutInsufficientBalanceError);

    const persisted = await pool.query<{ orders: string; holds: string }>(
      "SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM wallet_holds) AS holds",
    );
    expect(persisted.rows[0]).toEqual({ orders: "0", holds: "0" });
  });

  it("maps insufficient Coins to a client-visible 402 response", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    const session = await sessions.createSession(userId, null);
    const csrfToken = sessions.createCsrfToken(session.token);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/checkout")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "checkout-api-insufficient")
      .send({ acceptedTotalCoinMinor: 318_000, items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }] })
      .expect(402)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 402,
          code: "CHECKOUT_INSUFFICIENT_BALANCE",
        });
      });
  });

  it("requires explicit confirmation when the current checkout total increased", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 400_000,
      idempotencyKey: "topup-credit-checkout-price-increase",
      reason: "test-credit",
    });
    await pool.query("UPDATE catalog_products SET price_coin_minor = 400000 WHERE slug = 'desert-eagle-printstream'");

    await expect(checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-price-increase",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    })).rejects.toBeInstanceOf(CheckoutPriceChangedError);

    const persisted = await pool.query<{ orders: string; holds: string }>(
      "SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM wallet_holds) AS holds",
    );
    expect(persisted.rows[0]).toEqual({ orders: "0", holds: "0" });
  });

  it("rejects a malformed checkout body without creating a server error", async () => {
    const session = await sessions.createSession(userId, null);
    const csrfToken = sessions.createCsrfToken(session.token);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/checkout")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "checkout-api-malformed")
      .send({})
      .expect(400);
  });

  it("requires a saved Steam Trade URL before skin checkout", async () => {
    await wallet.creditUser({
      userId,
      amountCoinMinor: 318_000,
      idempotencyKey: "topup-credit-no-trade-url",
      reason: "test-credit",
    });

    await expect(checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-no-trade-url",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    })).rejects.toMatchObject({ code: "STEAM_TRADE_URL_REQUIRED" });
  });

  it("returns the existing order for the same idempotency key without duplicating holds", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 636_000,
      idempotencyKey: "topup-credit-idempotent-checkout",
      reason: "test-credit",
    });

    const first = await checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-idempotent",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    });
    const second = await checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-idempotent",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    });

    expect(second.id).toBe(first.id);
    const holds = await pool.query<{ count: string; total: string }>(
      "SELECT count(*) AS count, COALESCE(sum(amount_coin_minor), 0)::text AS total FROM wallet_holds WHERE user_id = $1",
      [userId],
    );
    expect(holds.rows[0]).toEqual({ count: "1", total: "318000" });
  });

  it("lists only the current user's orders newest first without internal request fields", async () => {
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "secretToken" });
    await wallet.creditUser({
      userId,
      amountCoinMinor: 954_000,
      idempotencyKey: "topup-credit-order-history-owner",
      reason: "test-credit",
    });
    const olderOrder = await checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-history-older",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    });
    const newerOrder = await checkout.checkoutFromCart({
      userId,
      idempotencyKey: "checkout-history-newer",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    });
    await pool.query("UPDATE orders SET created_at = $1 WHERE id = $2", ["2026-07-28T07:00:00.000Z", olderOrder.id]);
    await pool.query("UPDATE orders SET created_at = $1 WHERE id = $2", ["2026-07-28T08:00:00.000Z", newerOrder.id]);
    const newerFulfillment = await pool.query<{ command_id: string; line_id: string }>(
      `
        SELECT fulfillment_commands.id AS command_id, order_lines.id AS line_id
        FROM fulfillment_commands
        JOIN order_lines ON order_lines.id = fulfillment_commands.order_line_id
        WHERE fulfillment_commands.order_id = $1
      `,
      [newerOrder.id],
    );
    const newerFulfillmentRow = newerFulfillment.rows[0];
    if (newerFulfillmentRow === undefined) throw new Error("Expected newer fulfillment command");
    await pool.query("UPDATE order_lines SET status = 'supplier_sent' WHERE id = $1", [newerFulfillmentRow.line_id]);
    await pool.query(
      `
        INSERT INTO fulfillment_provider_attempts (
          command_id,
          order_id,
          order_line_id,
          provider,
          operation,
          status,
          idempotency_key,
          provider_order_id,
          request_snapshot,
          response_snapshot,
          created_at,
          finished_at
        )
        VALUES ($1, $2, $3, 'sih', 'get_order', 'succeeded', 'checkout-history-newer-protection', '42', '{}'::jsonb, $4::jsonb, '2026-07-28T08:01:00.000Z', '2026-07-28T08:01:01.000Z')
      `,
      [
        newerFulfillmentRow.command_id,
        newerOrder.id,
        newerFulfillmentRow.line_id,
        JSON.stringify({
          status: "finished",
          offerId: "9272838196",
          protection: { status: "processing", error: null },
          providerOrderId: "42",
        }),
      ],
    );

    const otherSteamId64 = "76561198000000003";
    const otherUserId = `user_${otherSteamId64}`;
    await users.upsertSteamUser({
      claimedIdentifier: `https://steamcommunity.com/openid/id/${otherSteamId64}`,
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T10:00:01Znonce",
      steamId64: otherSteamId64,
    });
    await users.saveSteamTradeCredential(otherUserId, { partner: "39734274", token: "otherSecretToken" });
    await wallet.creditUser({
      userId: otherUserId,
      amountCoinMinor: 318_000,
      idempotencyKey: "topup-credit-order-history-other",
      reason: "test-credit",
    });
    await checkout.checkoutFromCart({
      userId: otherUserId,
      idempotencyKey: "checkout-history-other",
      acceptedTotalCoinMinor: 318_000,
      items: [{ productSlug: "desert-eagle-printstream", quantity: 1 }],
    });

    const session = await sessions.createSession(userId, null);
    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/orders/me")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .expect(200)
      .expect(({ body }) => {
        const responseBody = body as { orders: Array<{ id: string }> };
        expect(responseBody.orders).toHaveLength(2);
        expect(responseBody.orders.map((order) => order.id)).toEqual([newerOrder.id, olderOrder.id]);
        expect(responseBody.orders[0]).toMatchObject({
          id: newerOrder.id,
          userId,
          status: "held",
          totalCoinMinor: 318_000,
          createdAt: "2026-07-28T08:00:00.000Z",
          lines: [
            {
              productSlug: "desert-eagle-printstream",
              kind: "skins",
              title: "Desert Eagle | Printstream",
              quantity: 1,
              unitPriceCoinMinor: 318_000,
              fulfillmentStage: "trade_protection",
              recipientSnapshot: {
                kind: "steam-trade",
                steamId64,
                steamTradePartnerAccountId: "39734273",
              },
            },
          ],
        });
        expect(JSON.stringify(body)).not.toContain("checkout-history-newer");
        expect(JSON.stringify(body)).not.toContain("secretToken");
        expect(JSON.stringify(body)).not.toContain(otherUserId);
      });
  });
});
