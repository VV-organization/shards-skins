import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { DatabaseService } from "../../common/database/database.service";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";
import { WalletIdempotencyConflictError, WalletService } from "./wallet.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const userId = "user_76561198000000003";

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

describe.skipIf(!databaseUrl)("wallet PostgreSQL persistence", () => {
  let app: INestApplication | null = null;
  let pool: Pool;
  let database: DatabaseService;
  let sessions: SessionsService;
  let wallet: WalletService;
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
    database = currentApp.get(DatabaseService);
    sessions = currentApp.get(SessionsService);
    wallet = currentApp.get(WalletService);
    users = currentApp.get(UsersService);
    await users.upsertSteamUser({
      claimedIdentifier: "https://steamcommunity.com/openid/id/76561198000000003",
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T10:00:00Znonce",
      steamId64: "76561198000000003",
    });
    await users.upsertSteamUser({
      claimedIdentifier: "https://steamcommunity.com/openid/id/76561198000000004",
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T10:00:01Znonce",
      steamId64: "76561198000000004",
    });
  });

  it("projects the current user's posted Coins operation history without internal metadata", async () => {
    await wallet.creditUser({
      userId,
      amountCoinMinor: 100_000,
      idempotencyKey: "topup-wallet-history",
      reason: "arc_pay_top_up_capture",
    });
    const order = await pool.query<{ id: string }>(
      `
        INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots)
        VALUES ($1, 'checkout-wallet-history', 'hash-wallet-history', 'fulfilled', 35_000, '[]'::jsonb)
        RETURNING id
      `,
      [userId],
    );
    const orderId = order.rows[0]?.id;
    if (orderId === undefined) throw new Error("Expected order id");
    await database.transaction(async (client) => {
      await wallet.createHold(client, {
        userId,
        orderId,
        amountCoinMinor: 35_000,
        reason: "checkout",
      });
    });
    await wallet.settleOrderHold({
      userId,
      orderId,
      captureCoinMinor: 35_000,
      idempotencyKey: "settle-wallet-history",
      reason: "fulfillment_terminal",
    });
    await wallet.creditUser({
      userId: "user_76561198000000004",
      amountCoinMinor: 999_000,
      idempotencyKey: "other-user-history",
      reason: "test",
    });
    await pool.query(
      `
        UPDATE wallet_transactions
        SET created_at = CASE idempotency_key
          WHEN 'topup-wallet-history' THEN '2026-07-29T08:00:00.000Z'::timestamptz
          WHEN 'settle-wallet-history' THEN '2026-07-29T09:00:00.000Z'::timestamptz
          ELSE created_at
        END
      `,
    );

    const session = await sessions.createSession(userId, null);

    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/wallet/me/transactions")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .expect(200)
      .expect(({ body }) => {
        const responseBody = body as unknown;
        expect(isRecord(responseBody)).toBe(true);
        if (!isRecord(responseBody)) throw new Error("Wallet transactions response body is not an object.");
        expect(isUnknownArray(responseBody.transactions)).toBe(true);
        if (!isUnknownArray(responseBody.transactions)) throw new Error("Wallet transactions are not an array.");
        expect(responseBody.transactions).toHaveLength(2);
        const [purchase, topUp] = responseBody.transactions;
        expect(isRecord(purchase)).toBe(true);
        expect(isRecord(topUp)).toBe(true);
        if (!isRecord(purchase) || typeof purchase.id !== "string") throw new Error("Purchase transaction id is not a string.");
        if (!isRecord(topUp) || typeof topUp.id !== "string") throw new Error("Top-up transaction id is not a string.");
        expect(purchase.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(topUp.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(responseBody).toEqual({
          transactions: [
            {
              amountCoinMinor: 35_000,
              balanceAfterCoinMinor: 65_000,
              createdAt: "2026-07-29T09:00:00.000Z",
              direction: "debit",
              id: purchase.id,
              orderId,
              reason: "purchase",
              status: "completed",
            },
            {
              amountCoinMinor: 100_000,
              balanceAfterCoinMinor: 100_000,
              createdAt: "2026-07-29T08:00:00.000Z",
              direction: "credit",
              id: topUp.id,
              reason: "top_up",
              status: "completed",
            },
          ],
        });
        expect(JSON.stringify(responseBody)).not.toContain("idempotency");
        expect(JSON.stringify(responseBody)).not.toContain("request");
        expect(JSON.stringify(responseBody)).not.toContain("999000");
      });
  });

  it("rejects an idempotent credit replay with different financial terms", async () => {
    await wallet.creditUser({
      userId,
      amountCoinMinor: 100_000,
      idempotencyKey: "topup-credit-conflict",
      reason: "test-credit",
    });

    await expect(wallet.creditUser({
      userId,
      amountCoinMinor: 200_000,
      idempotencyKey: "topup-credit-conflict",
      reason: "test-credit",
    })).rejects.toBeInstanceOf(WalletIdempotencyConflictError);

    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 100_000,
      heldCoinMinor: 0,
      availableCoinMinor: 100_000,
    });
  });

  it("captures or releases an active order hold with idempotent balanced settlement", async () => {
    await wallet.creditUser({
      userId,
      amountCoinMinor: 100_000,
      idempotencyKey: "topup-credit-settlement",
      reason: "test-credit",
    });
    const order = await pool.query<{ id: string }>(
      `
        INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots)
        VALUES ($1, 'checkout-wallet-settlement', 'hash-wallet-settlement', 'held', 60_000, '[]'::jsonb)
        RETURNING id
      `,
      [userId],
    );
    const orderId = order.rows[0]?.id;
    if (orderId === undefined) throw new Error("Expected order id");
    await database.transaction(async (client) => {
      await wallet.createHold(client, {
        userId,
        orderId,
        amountCoinMinor: 60_000,
        reason: "checkout",
      });
    });

    await wallet.settleOrderHold({
      userId,
      orderId,
      captureCoinMinor: 35_000,
      idempotencyKey: "settle-wallet-partial",
      reason: "fulfillment_terminal",
    });
    await wallet.settleOrderHold({
      userId,
      orderId,
      captureCoinMinor: 35_000,
      idempotencyKey: "settle-wallet-partial",
      reason: "fulfillment_terminal",
    });

    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 65_000,
      heldCoinMinor: 0,
      availableCoinMinor: 65_000,
    });
    const persisted = await pool.query<{
      customer_entries: string;
      hold_status: string;
      captured: string;
      released: string;
      settlement_entries_total: string;
      settlement_transactions: string;
    }>(
      `
        SELECT
          (SELECT count(*)
           FROM wallet_ledger_entries
           WHERE account_key = $1 AND amount_coin_minor = -35000)::text AS customer_entries,
          (SELECT status FROM wallet_holds WHERE order_id = $2) AS hold_status,
          (SELECT (captured_at IS NOT NULL)::text FROM wallet_holds WHERE order_id = $2) AS captured,
          (SELECT (released_at IS NOT NULL)::text FROM wallet_holds WHERE order_id = $2) AS released,
          (SELECT COALESCE(sum(amount_coin_minor), 0)::text
           FROM wallet_ledger_entries
           WHERE transaction_id IN (
             SELECT id
             FROM wallet_transactions
             WHERE user_id = $3 AND idempotency_key = 'settle-wallet-partial'
           )) AS settlement_entries_total,
          (SELECT count(*)::text
           FROM wallet_transactions
           WHERE user_id = $3 AND idempotency_key = 'settle-wallet-partial') AS settlement_transactions
      `,
      [`customer:${userId}`, orderId, userId],
    );
    expect(persisted.rows[0]).toEqual({
      customer_entries: "1",
      hold_status: "partially_captured",
      captured: "true",
      released: "true",
      settlement_entries_total: "0",
      settlement_transactions: "1",
    });

    await expect(wallet.settleOrderHold({
      userId,
      orderId,
      captureCoinMinor: 40_000,
      idempotencyKey: "settle-wallet-partial",
      reason: "fulfillment_terminal",
    })).rejects.toBeInstanceOf(WalletIdempotencyConflictError);

    await expect(wallet.settleOrderHold({
      userId,
      orderId,
      captureCoinMinor: 10_000,
      idempotencyKey: "settle-wallet-after-closed",
      reason: "fulfillment_terminal_retry",
    })).rejects.toThrow("WALLET_HOLD_ALREADY_SETTLED");
    const finalBalance = await wallet.getBalance(userId);
    expect(finalBalance).toEqual({
      postedCoinMinor: 65_000,
      heldCoinMinor: 0,
      availableCoinMinor: 65_000,
    });
  });

  it("reports wallet invariant violations without mutating money state", async () => {
    await pool.query(
      `
        INSERT INTO wallet_transactions (id, user_id, idempotency_key, type, status, metadata, created_at)
        VALUES (
          '11111111-1111-4111-8111-111111111111',
          $1,
          'wallet-reconcile-unbalanced',
          'top_up_credit',
          'posted',
          '{}'::jsonb,
          '2026-07-29T10:00:00.000Z'::timestamptz
        )
      `,
      [userId],
    );
    await pool.query(
      `
        INSERT INTO orders (id, user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots, created_at)
        VALUES (
          '22222222-2222-4222-8222-222222222222',
          $1,
          'wallet-reconcile-terminal-hold',
          'hash-wallet-reconcile-terminal-hold',
          'fulfilled',
          5000,
          '[]'::jsonb,
          '2026-07-29T10:01:00.000Z'::timestamptz
        )
      `,
      [userId],
    );
    await pool.query(
      `
        INSERT INTO wallet_holds (id, user_id, order_id, amount_coin_minor, status, reason, created_at)
        VALUES
          (
            '33333333-3333-4333-8333-333333333333',
            $1,
            '22222222-2222-4222-8222-222222222222',
            5000,
            'active',
            'checkout',
            '2026-07-29T10:02:00.000Z'::timestamptz
          ),
          (
            '44444444-4444-4444-8444-444444444444',
            $1,
            '55555555-5555-4555-8555-555555555555',
            1000,
            'active',
            'checkout',
            '2026-07-29T10:03:00.000Z'::timestamptz
          ),
          (
            '66666666-6666-4666-8666-666666666666',
            $1,
            '77777777-7777-4777-8777-777777777777',
            0,
            'active',
            'corrupt_fixture',
            '2026-07-29T10:04:00.000Z'::timestamptz
          )
      `,
      [userId],
    );

    const before = await pool.query<{ holds: string; transactions: string }>(
      `
        SELECT
          (SELECT count(*)::text FROM wallet_holds) AS holds,
          (SELECT count(*)::text FROM wallet_transactions) AS transactions
      `,
    );

    await expect(wallet.reconcileWallet({ limit: 10 })).resolves.toMatchObject({
      status: "issues_found",
      summary: {
        invalidAmountRows: 1,
        orphanHolds: 2,
        terminalOrderActiveHolds: 1,
        unbalancedTransactions: 1,
      },
      issues: [
        {
          entryCount: 0,
          id: "11111111-1111-4111-8111-111111111111",
          kind: "unbalanced_transaction",
          transactionTotalCoinMinor: 0,
          userId,
        },
        {
          amountCoinMinor: 5000,
          id: "33333333-3333-4333-8333-333333333333",
          kind: "terminal_order_active_hold",
          orderId: "22222222-2222-4222-8222-222222222222",
          orderStatus: "fulfilled",
          userId,
        },
        {
          amountCoinMinor: 1000,
          id: "44444444-4444-4444-8444-444444444444",
          kind: "orphan_hold",
          orderId: "55555555-5555-4555-8555-555555555555",
          userId,
        },
        {
          amountCoinMinor: 0,
          id: "66666666-6666-4666-8666-666666666666",
          kind: "orphan_hold",
          orderId: "77777777-7777-4777-8777-777777777777",
          userId,
        },
        {
          amountCoinMinor: 0,
          id: "66666666-6666-4666-8666-666666666666",
          kind: "invalid_amount",
          table: "wallet_holds",
          userId,
        },
      ],
    });

    await expect(wallet.reconcileWallet({ limit: 0 })).rejects.toThrow("WALLET_RECONCILIATION_LIMIT_INVALID");
    await expect(pool.query("SELECT count(*)::text AS holds FROM wallet_holds")).resolves.toMatchObject({
      rows: [{ holds: before.rows[0]?.holds }],
    });
    await expect(pool.query("SELECT count(*)::text AS transactions FROM wallet_transactions")).resolves.toMatchObject({
      rows: [{ transactions: before.rows[0]?.transactions }],
    });
  });
});
