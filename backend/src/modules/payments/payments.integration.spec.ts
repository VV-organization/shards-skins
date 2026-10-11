import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { DatabaseService } from "../../common/database/database.service";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { EmailAuthService } from "../email-auth/email-auth.service";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";

import { PaymentsService } from "./payments.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const userId = "user_76561198000000004";
const steamId64 = "76561198000000004";
const fakeWebhookSecret = "local-fake-arc-pay-webhook-secret";

type CreatedTopUpResponse = {
  id: string;
  checkoutUrl: string;
};

type CreatedSteamRefillResponse = {
  id: string;
  checkoutUrl: string;
  amountRubMinor: number;
  feeRubMinor: number;
  fiatAmountMinor: number;
  userId: string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function fakeWebhookSignature(payload: unknown): string {
  return createHmac("sha256", fakeWebhookSecret).update(stableJson(payload), "utf8").digest("hex");
}

function requireCreatedTopUpResponse(value: unknown): CreatedTopUpResponse {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { checkoutUrl?: unknown }).checkoutUrl === "string"
  ) {
    return value as CreatedTopUpResponse;
  }
  throw new Error("Unexpected top-up response shape");
}

function requireCreatedSteamRefillResponse(value: unknown): CreatedSteamRefillResponse {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { checkoutUrl?: unknown }).checkoutUrl === "string"
  ) {
    return value as CreatedSteamRefillResponse;
  }
  throw new Error("Unexpected Steam refill response shape");
}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  // Keep one listener per app; per-request reopening can reuse a closed keep-alive socket.
  await app.listen(0, "127.0.0.1");
  return app;
}

describe.skipIf(!databaseUrl)("payments PostgreSQL persistence", () => {
  let app: INestApplication | null = null;
  let pool: Pool;
  let sessions: SessionsService;
  let users: UsersService;
  let wallet: WalletService;
  let tempDir: string | null = null;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
    originalFetch = globalThis.fetch;
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.ARC_PAY_PROVIDER_MODE;
    delete process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL;
    delete process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE;
    delete process.env.ARC_PAY_SECRET_KEY_FILE;
    delete process.env.ARC_PAY_PUBLIC_ORIGIN;
    globalThis.fetch = originalFetch;
    await app?.close();
    await pool.end();
    if (tempDir !== null) await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    await pool.query(`
      TRUNCATE
        payment_webhook_events,
        payment_provider_attempts,
        steam_refill_payments,
        top_up_payments,
        cart_items,
        carts,
        order_lines,
        orders,
        wallet_holds,
        wallet_ledger_entries,
        wallet_transactions,
        audit_events,
        email_verification_challenges,
        email_identities,
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
    wallet = currentApp.get(WalletService);
    await users.upsertSteamUser({
      claimedIdentifier: `https://steamcommunity.com/openid/id/${steamId64}`,
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T11:00:00Znonce",
      steamId64,
    });
  });

  it("creates an idempotent top-up intent with immutable displayed terms without crediting Coins", async () => {
    const session = await sessions.createSession(userId, null);
    const csrfToken = sessions.createCsrfToken(session.token);

    const first = await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/top-up/sessions")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "topup-session-1500")
      .send({ coinAmountMinor: 150_000 })
      .expect(200);

    const firstBody = first.body as { id: string };
    expect(firstBody).toMatchObject({
      status: "provider_configuration_required",
      userId,
      coinAmountMinor: 150_000,
      fiatAmountMinor: 100_000,
      fiatCurrency: "RUB",
      rate: {
        fiatMinor: 100,
        coinMinor: 150,
      },
      provider: "arc_pay",
      checkoutUrl: null,
    });

    const second = await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/top-up/sessions")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "topup-session-1500")
      .send({ coinAmountMinor: 150_000 })
      .expect(200);

    const secondBody = second.body as { id: string };
    expect(secondBody.id).toBe(firstBody.id);
    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/top-up/sessions")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "topup-session-1500")
      .send({ coinAmountMinor: 300_000 })
      .expect(409);

    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 0,
      heldCoinMinor: 0,
      availableCoinMinor: 0,
    });

    const persisted = await pool.query<{
      payments: string;
      attempts: string;
      webhook_events: string;
      coin_amount_minor: number;
      fiat_amount_minor: number;
      status: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM top_up_payments WHERE user_id = $1) AS payments,
          (SELECT count(*) FROM payment_provider_attempts WHERE top_up_payment_id = $2) AS attempts,
          (SELECT count(*) FROM payment_webhook_events) AS webhook_events,
          coin_amount_minor,
          fiat_amount_minor,
          status
        FROM top_up_payments
        WHERE id = $2
      `,
      [userId, firstBody.id],
    );
    expect(persisted.rows[0]).toEqual({
      payments: "1",
      attempts: "1",
      webhook_events: "0",
      coin_amount_minor: 150_000,
      fiat_amount_minor: 100_000,
      status: "provider_configuration_required",
    });
  });

  it("credits Coins only from a verified captured fake payment provider webhook and deduplicates retries", async () => {
    await app?.close();
    app = null;
    tempDir = await mkdtemp(join(tmpdir(), "shards-arc-pay-"));
    const secretFile = join(tempDir, "webhook-secret");
    await writeFile(secretFile, fakeWebhookSecret, "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "fake";
    process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL = "http://localhost:3999";
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = secretFile;
    const currentApp = await createApp();
    app = currentApp;
    sessions = currentApp.get(SessionsService);
    users = currentApp.get(UsersService);
    wallet = currentApp.get(WalletService);
    await users.upsertSteamUser({
      claimedIdentifier: `https://steamcommunity.com/openid/id/${steamId64}`,
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-28T11:05:00Znonce",
      steamId64,
    });
    const session = await sessions.createSession(userId, null);
    const csrfToken = sessions.createCsrfToken(session.token);

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/top-up/sessions")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .set("x-csrf-token", csrfToken)
      .set("idempotency-key", "topup-session-fake-1500")
      .send({ coinAmountMinor: 150_000 })
      .expect(200);

    const createdBody = requireCreatedTopUpResponse(created.body);
    expect(created.body).toMatchObject({
      status: "checkout_pending",
      provider: "arc_pay",
      coinAmountMinor: 150_000,
      fiatAmountMinor: 100_000,
    });
    expect(createdBody.checkoutUrl).toContain("http://localhost:3999/checkout/fake_arc_pay_");
    expect(createdBody.checkoutUrl).toContain(createdBody.id);
    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 0,
      heldCoinMinor: 0,
      availableCoinMinor: 0,
    });

    const providerSession = await pool.query<{ provider_session_id: string }>(
      "SELECT provider_session_id FROM top_up_payments WHERE id = $1",
      [createdBody.id],
    );
    const webhookPayload = {
      eventId: "evt_fake_arc_pay_1500_captured",
      type: "payment.captured",
      checkoutSessionId: providerSession.rows[0]?.provider_session_id,
      status: "captured",
      amount: 100_000,
      currency: "RUB",
    };

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arc-pay")
      .set("webhook-id", webhookPayload.eventId)
      .set("x-arc-pay-signature", "bad-signature")
      .send(webhookPayload)
      .expect(401);
    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 0,
      heldCoinMinor: 0,
      availableCoinMinor: 0,
    });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arc-pay")
      .set("webhook-id", webhookPayload.eventId)
      .set("x-arc-pay-signature", fakeWebhookSignature(webhookPayload))
      .send(webhookPayload)
      .expect(200);

    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 150_000,
      heldCoinMinor: 0,
      availableCoinMinor: 150_000,
    });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arc-pay")
      .set("webhook-id", webhookPayload.eventId)
      .set("x-arc-pay-signature", fakeWebhookSignature(webhookPayload))
      .send(webhookPayload)
      .expect(200);
    await expect(wallet.getBalance(userId)).resolves.toEqual({
      postedCoinMinor: 150_000,
      heldCoinMinor: 0,
      availableCoinMinor: 150_000,
    });

    const persisted = await pool.query<{
      payment_status: string;
      webhook_status: string;
      wallet_transactions: string;
      liability_entries: string;
      vv_admin_completed_events: string;
    }>(
      `
        SELECT
          (SELECT status FROM top_up_payments WHERE id = $1) AS payment_status,
          (SELECT status FROM payment_webhook_events WHERE provider_event_id = $2) AS webhook_status,
          (SELECT count(*) FROM wallet_transactions WHERE user_id = $3 AND type = 'top_up_credit') AS wallet_transactions,
          (SELECT count(*) FROM wallet_ledger_entries WHERE account_key = 'shards:coins-liability') AS liability_entries,
          (SELECT count(*) FROM vv_admin_integration_outbox WHERE subject_external_id = $1::text AND event_type = 'top_up.completed') AS vv_admin_completed_events
      `,
      [createdBody.id, webhookPayload.eventId, userId],
    );
    expect(persisted.rows[0]).toEqual({
      payment_status: "paid",
      webhook_status: "processed",
      wallet_transactions: "1",
      liability_entries: "1",
      vv_admin_completed_events: "1",
    });
    const outbox = await pool.query<{ payload: { data?: Record<string, unknown> } }>(
      "SELECT payload FROM vv_admin_integration_outbox WHERE subject_external_id = $1::text AND event_type = 'top_up.completed'",
      [createdBody.id],
    );
    expect(outbox.rows[0]?.payload).toMatchObject({
      schemaVersion: 2,
      eventType: "top_up.completed",
      subject: { type: "top_up", externalId: createdBody.id },
      data: {
        paymentMethod: {
          type: "sbp",
          displayName: "СБП",
          provider: "ArcPay",
        },
      },
    });
    expect(outbox.rows[0]?.payload.data).not.toHaveProperty("payment");
  });

  it("creates a direct RUB Steam refill checkout for an existing email user without cart or Coins state", async () => {
    await app?.close();
    app = null;
    tempDir = await mkdtemp(join(tmpdir(), "shards-arc-pay-steam-refill-"));
    const secretFile = join(tempDir, "webhook-secret");
    await writeFile(secretFile, fakeWebhookSecret, "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "fake";
    process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL = "http://localhost:3999";
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = secretFile;
    const currentApp = await createApp();
    app = currentApp;
    users = currentApp.get(UsersService);

    const emailUser = await users.upsertEmailUser("direct-steam-refill@example.com");

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "steam-refill-rub-direct-500")
      .send({ amountRub: 500, steamLogin: "  shards_sandbox_user  ", email: " direct-steam-refill@example.com " })
      .expect(200);

    const createdBody = requireCreatedSteamRefillResponse(created.body);
    expect(created.body).toMatchObject({
      status: "checkout_pending",
      provider: "arc_pay",
      amountRubMinor: 50_000,
      feeRubMinor: 2_500,
      fiatAmountMinor: 52_500,
      fiatCurrency: "RUB",
      steamLogin: "shards_sandbox_user",
      userId: emailUser.id,
      checkoutUrl: `http://localhost:3999/checkout/fake_arc_pay_steam_refill_${createdBody.id}`,
    });

    const second = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "steam-refill-rub-direct-500")
      .send({ amountRub: 500, steamLogin: "shards_sandbox_user", email: "direct-steam-refill@example.com" })
      .expect(200);
    expect((second.body as { id: string }).id).toBe(createdBody.id);

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "steam-refill-rub-direct-500")
      .send({ amountRub: 1000, steamLogin: "shards_sandbox_user", email: "direct-steam-refill@example.com" })
      .expect(409);

    const persisted = await pool.query<{
      carts: string;
      holds: string;
      ledger_entries: string;
      payment_status: string;
      amount_rub_minor: number;
      fee_rub_minor: number;
      fiat_amount_minor: number;
      steam_login: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM carts WHERE user_id = $1) AS carts,
          (SELECT count(*) FROM wallet_holds WHERE user_id = $1) AS holds,
          (SELECT count(*) FROM wallet_ledger_entries WHERE user_id = $1) AS ledger_entries,
          status AS payment_status,
          amount_rub_minor,
          fee_rub_minor,
          fiat_amount_minor,
          steam_login
        FROM steam_refill_payments
        WHERE id = $2
      `,
      [emailUser.id, createdBody.id],
    );
    expect(persisted.rows[0]).toEqual({
      carts: "0",
      holds: "0",
      ledger_entries: "0",
      payment_status: "checkout_pending",
      amount_rub_minor: 50_000,
      fee_rub_minor: 2_500,
      fiat_amount_minor: 52_500,
      steam_login: "shards_sandbox_user",
    });
  });

  it("creates guest direct RUB Steam refill checkout by upserting the submitted email user", async () => {
    await app?.close();
    app = null;
    tempDir = await mkdtemp(join(tmpdir(), "shards-arc-pay-guest-steam-refill-"));
    const secretFile = join(tempDir, "webhook-secret");
    await writeFile(secretFile, fakeWebhookSecret, "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "fake";
    process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL = "http://localhost:3999";
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = secretFile;
    const currentApp = await createApp();
    app = currentApp;

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "guest-steam-refill-rub-direct-500")
      .send({ amountRub: 500, steamLogin: "guest_steam_user", email: " Buyer@Example.com " })
      .expect(200);

    const createdBody = requireCreatedSteamRefillResponse(created.body);
    expect(created.body).toMatchObject({
      status: "checkout_pending",
      provider: "arc_pay",
      amountRubMinor: 50_000,
      feeRubMinor: 2_500,
      fiatAmountMinor: 52_500,
      fiatCurrency: "RUB",
      steamLogin: "guest_steam_user",
      checkoutUrl: `http://localhost:3999/checkout/fake_arc_pay_steam_refill_${createdBody.id}`,
    });

    const persisted = await pool.query<{
      email: string;
      identity_user_id: string;
      payment_user_id: string;
      sessions: string;
      steam_id64: string | null;
    }>(
      `
        SELECT
          email_identities.email,
          email_identities.user_id AS identity_user_id,
          steam_refill_payments.user_id AS payment_user_id,
          users.steam_id64,
          (SELECT count(*) FROM user_sessions WHERE user_id = users.id) AS sessions
        FROM steam_refill_payments
        JOIN users ON users.id = steam_refill_payments.user_id
        JOIN email_identities ON email_identities.user_id = users.id
        WHERE steam_refill_payments.id = $1
      `,
      [createdBody.id],
    );
    expect(persisted.rows[0]).toEqual({
      email: "buyer@example.com",
      identity_user_id: createdBody.userId,
      payment_user_id: createdBody.userId,
      sessions: "0",
      steam_id64: null,
    });
  });

  it.each([false, true])("keeps guest Steam refill history after email login (another session: %s)", async (withAnotherSession) => {
    await app?.close();
    app = null;
    tempDir = await mkdtemp(join(tmpdir(), "shards-arc-pay-existing-email-steam-refill-"));
    const secretFile = join(tempDir, "webhook-secret");
    await writeFile(secretFile, fakeWebhookSecret, "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "fake";
    process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL = "http://localhost:3999";
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = secretFile;
    const currentApp = await createApp();
    app = currentApp;
    users = currentApp.get(UsersService);

    const existingUser = await users.upsertSteamUser({
      claimedIdentifier: "https://steamcommunity.com/openid/id/76561198000000999",
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-09-10T10:00:00Znonce",
      steamId64: "76561198000000999",
    });
    await users.upsertEmailUser("existing-steam-owner@example.com", existingUser.id);

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "guest-steam-refill-existing-email-owner")
      .send({ amountRub: 500, steamLogin: "existing_owner_refill", email: " Existing-Steam-Owner@Example.com " })
      .expect(200);

    const createdBody = requireCreatedSteamRefillResponse(created.body);
    expect(createdBody.userId).toBe(existingUser.id);

    const persisted = await pool.query<{
      email: string;
      identity_user_id: string;
      payment_user_id: string;
      steam_id64: string | null;
    }>(
      `
        SELECT
          email_identities.email,
          email_identities.user_id AS identity_user_id,
          steam_refill_payments.user_id AS payment_user_id,
          users.steam_id64
        FROM steam_refill_payments
        JOIN users ON users.id = steam_refill_payments.user_id
        JOIN email_identities ON email_identities.user_id = users.id
        WHERE steam_refill_payments.id = $1
      `,
      [createdBody.id],
    );
    expect(persisted.rows[0]).toEqual({
      email: "existing-steam-owner@example.com",
      identity_user_id: existingUser.id,
      payment_user_id: existingUser.id,
      steam_id64: "76561198000000999",
    });

    const currentSessions = currentApp.get(SessionsService);
    const emailAuth = new EmailAuthService(currentApp.get(DatabaseService), users, currentSessions, {
      createCode: () => "123456",
      now: () => new Date(),
    }, undefined);
    const otherSession = withAnotherSession ? await currentSessions.createSession(userId, null) : null;
    const challenge = await emailAuth.requestChallenge("existing-steam-owner@example.com");
    const login = await emailAuth.verifyChallenge({
      challengeId: challenge.id,
      code: "123456",
      presentedSessionToken: otherSession?.token ?? null,
    });
    const history = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/orders/me")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${login.sessionToken}`)
      .expect(200);

    expect(history.body).toMatchObject({ orders: [expect.objectContaining({ id: createdBody.id })] });
    expect(login.userId).toBe(existingUser.id);
    expect((await pool.query<{ user_id: string }>(
      "SELECT user_id FROM email_identities WHERE email = $1", ["existing-steam-owner@example.com"],
    )).rows).toEqual([{ user_id: existingUser.id }]);
  });

  it("creates a Steam refill order and fulfillment command from a captured direct RUB payment without wallet holds", async () => {
    await app?.close();
    app = null;
    tempDir = await mkdtemp(join(tmpdir(), "shards-arc-pay-steam-refill-capture-"));
    const secretFile = join(tempDir, "webhook-secret");
    await writeFile(secretFile, fakeWebhookSecret, "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "fake";
    process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL = "http://localhost:3999";
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = secretFile;
    const currentApp = await createApp();
    app = currentApp;
    users = currentApp.get(UsersService);

    const emailUser = await users.upsertEmailUser("direct-steam-refill-capture@example.com");

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "steam-refill-rub-direct-capture-500")
      .send({ amountRub: 500, steamLogin: "shards_sandbox_user", email: "direct-steam-refill-capture@example.com" })
      .expect(200);

    const createdBody = requireCreatedSteamRefillResponse(created.body);
    expect(createdBody).toMatchObject({
      amountRubMinor: 50_000,
      feeRubMinor: 2_500,
      fiatAmountMinor: 52_500,
    });
    const providerSession = await pool.query<{ provider_session_id: string }>(
      "SELECT provider_session_id FROM steam_refill_payments WHERE id = $1",
      [createdBody.id],
    );
    const webhookPayload = {
      eventId: "evt_fake_arc_pay_steam_refill_500_captured",
      type: "payment.captured",
      checkoutSessionId: providerSession.rows[0]?.provider_session_id,
      status: "captured",
      amount: 52_500,
      currency: "RUB",
    };

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arc-pay")
      .set("webhook-id", webhookPayload.eventId)
      .set("x-arc-pay-signature", fakeWebhookSignature(webhookPayload))
      .send(webhookPayload)
      .expect(200, { status: "processed" });
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arc-pay")
      .set("webhook-id", webhookPayload.eventId)
      .set("x-arc-pay-signature", fakeWebhookSignature(webhookPayload))
      .send(webhookPayload)
      .expect(200, { status: "duplicate" });

    const persisted = await pool.query<{
      payment_status: string;
      order_id: string;
      order_status: string;
      order_total_coin_minor: number;
      line_count: string;
      line_title: string;
      line_price_coin_minor: number;
      recipient_steam_login: string;
      command_type: string;
      command_status: string;
      holds: string;
      wallet_transactions: string;
    }>(
      `
        SELECT
          steam_refill_payments.status AS payment_status,
          steam_refill_payments.order_id::text AS order_id,
          orders.status AS order_status,
          orders.total_coin_minor AS order_total_coin_minor,
          (SELECT count(*) FROM order_lines WHERE order_id = orders.id) AS line_count,
          order_lines.title AS line_title,
          order_lines.unit_price_coin_minor AS line_price_coin_minor,
          order_lines.recipient_snapshot ->> 'steamLogin' AS recipient_steam_login,
          fulfillment_commands.command_type,
          fulfillment_commands.status AS command_status,
          (SELECT count(*) FROM wallet_holds WHERE order_id = orders.id) AS holds,
          (SELECT count(*) FROM wallet_transactions WHERE user_id = $1) AS wallet_transactions
        FROM steam_refill_payments
        JOIN orders ON orders.id = steam_refill_payments.order_id
        JOIN order_lines ON order_lines.order_id = orders.id
        JOIN fulfillment_commands ON fulfillment_commands.order_line_id = order_lines.id
        WHERE steam_refill_payments.id = $2
      `,
      [emailUser.id, createdBody.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      payment_status: "paid",
      order_status: "held",
      order_total_coin_minor: 0,
      line_count: "1",
      line_title: "Пополнение Steam на 500 RUB",
      line_price_coin_minor: 0,
      recipient_steam_login: "shards_sandbox_user",
      command_type: "sih_steam_refill",
      command_status: "pending",
      holds: "0",
      wallet_transactions: "0",
    });
    expect(persisted.rows[0]?.order_id).toMatch(/^[0-9a-f-]{36}$/);

    await pool.query("UPDATE orders SET status = 'failed' WHERE id = $1", [persisted.rows[0]?.order_id]);
    const ownerSession = await currentApp.get(SessionsService).createSession(emailUser.id, null);
    const history = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/payments/me/history")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${ownerSession.token}`)
      .expect(200);
    expect(history.body).toEqual({ payments: [{
      id: createdBody.id,
      kind: "steam_refill",
      status: "paid",
      amountMinor: 52_500,
      currency: "RUB",
      orderId: persisted.rows[0]?.order_id,
      fulfillmentStatus: "failed",
      createdAt: expect.any(String) as unknown,
    }] });
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/payments/me/history").expect(401);
    const otherSession = await currentApp.get(SessionsService).createSession(userId, null);
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/payments/me/history")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${otherSession.token}`)
      .expect(200, { payments: [] });

    const topUp = await currentApp.get(PaymentsService).createTopUpSession({
      userId: emailUser.id, coinAmountMinor: 15000, idempotencyKey: "history-topup",
    });
    const combined = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/payments/me/history")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${ownerSession.token}`)
      .expect(200);
    expect(combined.body).toMatchObject({ payments: [
      { id: topUp.id, kind: "coins_top_up", status: "checkout_pending", amountMinor: 10000, currency: "RUB", orderId: null, fulfillmentStatus: null },
      { id: createdBody.id, kind: "steam_refill", status: "paid", amountMinor: 52500 },
    ] });
  });

  it("projects pending and failed direct RUB Steam refill attempts into order history without Coins state", async () => {
    await app?.close();
    app = null;
    tempDir = await mkdtemp(join(tmpdir(), "shards-arc-pay-steam-refill-history-"));
    const secretFile = join(tempDir, "webhook-secret");
    await writeFile(secretFile, fakeWebhookSecret, "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "fake";
    process.env.ARC_PAY_FAKE_CHECKOUT_BASE_URL = "http://localhost:3999";
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = secretFile;
    const currentApp = await createApp();
    app = currentApp;
    sessions = currentApp.get(SessionsService);
    users = currentApp.get(UsersService);

    const emailUser = await users.upsertEmailUser("direct-steam-refill-history@example.com");
    const session = await sessions.createSession(emailUser.id, null);

    const pending = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "steam-refill-rub-history-pending")
      .send({ amountRub: 500, steamLogin: "pending_user", email: "direct-steam-refill-history@example.com" })
      .expect(200);
    const pendingBody = requireCreatedSteamRefillResponse(pending.body);

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/orders/me")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          orders: [
            {
              id: pendingBody.id,
              status: "held",
              totalCoinMinor: 0,
              recipientSnapshots: [{ kind: "steam-refill", steamLogin: "pending_user" }],
              lines: [{
                id: pendingBody.id,
                fulfillmentStage: "pending",
                productSlug: "steam-top-up-500-rub",
                kind: "steam",
                title: "Пополнение Steam на 500 RUB",
                quantity: 1,
                unitPriceCoinMinor: 0,
                recipientSnapshot: { kind: "steam-refill", steamLogin: "pending_user" },
              }],
            },
          ],
        });
      });

    const failed = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/steam-refill/sessions")
      .set("idempotency-key", "steam-refill-rub-history-failed")
      .send({ amountRub: 1000, steamLogin: "failed_user", email: "direct-steam-refill-history@example.com" })
      .expect(200);
    const failedBody = requireCreatedSteamRefillResponse(failed.body);
    const providerSession = await pool.query<{ provider_session_id: string }>(
      "SELECT provider_session_id FROM steam_refill_payments WHERE id = $1",
      [failedBody.id],
    );
    const webhookPayload = {
      eventId: "evt_fake_arc_pay_steam_refill_history_failed",
      type: "payment.failed",
      checkoutSessionId: providerSession.rows[0]?.provider_session_id,
      status: "failed",
      amount: 105_000,
      currency: "RUB",
    };

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arc-pay")
      .set("webhook-id", webhookPayload.eventId)
      .set("x-arc-pay-signature", fakeWebhookSignature(webhookPayload))
      .send(webhookPayload)
      .expect(200, { status: "processed" });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/orders/me")
      .set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          orders: [
            {
              id: failedBody.id,
              status: "failed",
              totalCoinMinor: 0,
              recipientSnapshots: [{ kind: "steam-refill", steamLogin: "failed_user" }],
              lines: [{
                id: failedBody.id,
                fulfillmentStage: "failed",
                productSlug: "steam-top-up-1000-rub",
                kind: "steam",
                title: "Пополнение Steam на 1000 RUB",
                quantity: 1,
                unitPriceCoinMinor: 0,
                recipientSnapshot: { kind: "steam-refill", steamLogin: "failed_user" },
              }],
            },
            {
              id: pendingBody.id,
              status: "held",
              totalCoinMinor: 0,
            },
          ],
        });
      });

    const sideEffects = await pool.query<{
      orders: string;
      commands: string;
      holds: string;
      wallet_transactions: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM orders WHERE user_id = $1)::text AS orders,
          (
            SELECT count(*)
            FROM fulfillment_commands
            JOIN orders ON orders.id = fulfillment_commands.order_id
            WHERE orders.user_id = $1
          )::text AS commands,
          (SELECT count(*) FROM wallet_holds WHERE user_id = $1)::text AS holds,
          (SELECT count(*) FROM wallet_transactions WHERE user_id = $1)::text AS wallet_transactions
      `,
      [emailUser.id],
    );
    expect(sideEffects.rows[0]).toEqual({
      orders: "0",
      commands: "0",
      holds: "0",
      wallet_transactions: "0",
    });
  });

});
