import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("admin operations read models", () => {
  let app: INestApplication | null = null;
  let pool: Pool;
  let tempDir: string | null = null;
  let originalFetch: typeof globalThis.fetch;
  const adminToken = "shards-admin-token-for-tests";

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
    originalFetch = globalThis.fetch;
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.ADMIN_API_TOKEN_FILE;
    delete process.env.ARC_PAY_PROVIDER_MODE;
    delete process.env.ARC_PAY_SECRET_KEY_FILE;
    delete process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE;
    delete process.env.ARC_PAY_PUBLIC_ORIGIN;
    delete process.env.SIH_API_KEY_FILE;
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
    delete process.env.ARC_PAY_PROVIDER_MODE;
    delete process.env.ARC_PAY_SECRET_KEY_FILE;
    delete process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE;
    delete process.env.ARC_PAY_PUBLIC_ORIGIN;
    delete process.env.SIH_API_KEY_FILE;
    globalThis.fetch = originalFetch;
    tempDir = await mkdtemp(join(tmpdir(), "shards-admin-"));
    const adminTokenFile = join(tempDir, "admin-token");
    await writeFile(adminTokenFile, `${adminToken}\n`, "utf8");
    process.env.ADMIN_API_TOKEN_FILE = adminTokenFile;
    await pool.query(`
      TRUNCATE
        payment_webhook_events,
        payment_provider_attempts,
        top_up_payments,
        steam_refill_payments,
        fulfillment_provider_attempts,
        fulfillment_commands,
        cart_items,
        carts,
        order_lines,
        orders,
        wallet_holds,
        wallet_ledger_entries,
        wallet_transactions,
        idempotency_keys,
        audit_events,
        steam_trade_credentials,
        steam_openid_assertions,
        steam_auth_attempts,
        user_sessions,
        users
      RESTART IDENTITY
    `);
    await pool.query(
      `
        INSERT INTO users (id, steam_id64, display_name)
        VALUES ('user_76561198000000011', '76561198000000011', 'Ops User')
      `,
    );
    await pool.query(
      `
        INSERT INTO top_up_payments (
          id,
          user_id,
          idempotency_key,
          request_hash,
          provider,
          status,
          coin_amount_minor,
          fiat_amount_minor,
          fiat_currency,
          rate_fiat_minor,
          rate_coin_minor,
          provider_session_id,
          provider_status,
          metadata
        )
        VALUES (
          '019facdb-b116-7434-b27c-debea8fb1c30',
          'user_76561198000000011',
          'topup-admin-review',
          'request-hash',
          'arc_pay',
          'manual_review',
          150000,
          100000,
          'RUB',
          100,
          150,
          '019facd9-9e3f-730f-9180-8a43c1499df7',
          'refunded',
          '{"manualReviewReason":"arc_pay_refunded_after_credit","rawSecret":"must-not-leak"}'::jsonb
        )
      `,
    );
    await pool.query(
      `
        INSERT INTO orders (
          id,
          user_id,
          idempotency_key,
          request_hash,
          status,
          total_coin_minor,
          recipient_snapshots
        )
        VALUES (
          '019facdb-b116-7434-b27c-debea8fb1c31',
          'user_76561198000000011',
          'checkout-admin-review',
          'order-request-hash',
          'manual_review',
          200000,
          '[{"kind":"steam-trade","steamId64":"76561198000000011","steamTradePartnerAccountId":"39734273","token":"must-not-leak"}]'::jsonb
        )
      `,
    );
    await pool.query(
      `
        INSERT INTO order_lines (
          id,
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
        VALUES (
          '019facdb-b116-7434-b27c-debea8fb1c32',
          '019facdb-b116-7434-b27c-debea8fb1c31',
          1,
          'ak-redline',
          'ak-redline',
          'skins',
          'AK-47 | Redline',
          200000,
          1,
          '{"kind":"steam-trade","steamId64":"76561198000000011","steamTradePartnerAccountId":"39734273","token":"must-not-leak"}'::jsonb,
          'protection_failed'
        )
      `,
    );
    await pool.query(
      `
        INSERT INTO fulfillment_commands (
          id,
          order_id,
          order_line_id,
          provider,
          command_type,
          status,
          idempotency_key,
          payload_snapshot,
          last_error_code
        )
        VALUES (
          '019facdb-b116-7434-b27c-debea8fb1c33',
          '019facdb-b116-7434-b27c-debea8fb1c31',
          '019facdb-b116-7434-b27c-debea8fb1c32',
          'sih',
          'sih_skin_purchase',
          'manual_review',
          'fulfillment-admin-review',
          '{"steamToken":"must-not-leak","marketHashName":"AK-47 | Redline"}'::jsonb,
          'SIH_PROTECTION_ROLLBACK'
        )
      `,
    );
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
          error_code
        )
        VALUES (
          '019facdb-b116-7434-b27c-debea8fb1c33',
          '019facdb-b116-7434-b27c-debea8fb1c31',
          '019facdb-b116-7434-b27c-debea8fb1c32',
          'sih',
          'get_order',
          'succeeded',
          'attempt-admin-review',
          'sih-order-1',
          '{"apikey":"must-not-leak"}'::jsonb,
          '{"token":"must-not-leak"}'::jsonb,
          null
        )
      `,
    );
    await pool.query(
      `
        INSERT INTO payment_webhook_events (
          provider,
          provider_event_id,
          status,
          signature_status,
          payload_snapshot,
          processed_at
        )
        VALUES (
          'arc_pay',
          'evt-admin-rejected',
          'rejected_amount_mismatch',
          'verified',
          '{"token":"must-not-leak","event_type":"payment.captured"}'::jsonb,
          now()
        )
      `,
    );
    app = await createApp();
  });

  it("requires an admin token and returns redacted operational problem rows without mutation endpoints", async () => {
    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/admin/operations/overview")
      .expect(401);
    await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/overview")
      .set("x-admin-token", adminToken)
      .expect(404);

    const response = await request(app?.getHttpServer() as Parameters<typeof request>[0])
      .get("/admin/operations/overview")
      .set("x-admin-token", adminToken)
      .expect(200);

    expect(response.body).toMatchObject({
      payments: {
        manualReview: [{
          id: "019facdb-b116-7434-b27c-debea8fb1c30",
          userId: "user_76561198000000011",
          status: "manual_review",
          provider: "arc_pay",
          providerStatus: "refunded",
          coinAmountMinor: 150000,
          fiatAmountMinor: 100000,
          fiatCurrency: "RUB",
          manualReviewReason: "arc_pay_refunded_after_credit",
        }],
      },
      orders: {
        problem: [{
          id: "019facdb-b116-7434-b27c-debea8fb1c31",
          userId: "user_76561198000000011",
          status: "manual_review",
          totalCoinMinor: 200000,
          lineCount: 1,
          openLineCount: 1,
        }],
      },
      fulfillment: {
        commands: [{
          id: "019facdb-b116-7434-b27c-debea8fb1c33",
          orderId: "019facdb-b116-7434-b27c-debea8fb1c31",
          orderLineId: "019facdb-b116-7434-b27c-debea8fb1c32",
          provider: "sih",
          commandType: "sih_skin_purchase",
          status: "manual_review",
          lastErrorCode: "SIH_PROTECTION_ROLLBACK",
          lastAttemptOperation: "get_order",
          lastAttemptStatus: "succeeded",
        }],
      },
      webhooks: {
        problem: [{
          provider: "arc_pay",
          providerEventId: "evt-admin-rejected",
          status: "rejected_amount_mismatch",
          signatureStatus: "verified",
        }],
      },
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("payloadSnapshot");
    expect(serialized).not.toContain("requestSnapshot");
    expect(serialized).not.toContain("responseSnapshot");
  });

  it("runs payment provider top-up reconciliation once behind admin auth, idempotency, reason, and durable audit", async () => {
    await app?.close();
    const arcPaySecretKeyFile = join(tempDir ?? tmpdir(), "arc-pay-secret");
    await writeFile(arcPaySecretKeyFile, "sk_test_admin_reconcile\n", "utf8");
    process.env.ARC_PAY_PROVIDER_MODE = "real";
    process.env.ARC_PAY_SECRET_KEY_FILE = arcPaySecretKeyFile;
    process.env.ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE = arcPaySecretKeyFile;
    process.env.ARC_PAY_PUBLIC_ORIGIN = "https://shards.example";

    const topUpId = "019facdb-b116-7434-b27c-debea8fb1c40";
    let providerListRequests = 0;
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const payment = {
        id: "019facdb-b116-7434-b27c-debea8fb1c43", external_id: topUpId,
        status: "captured", amount: 100000, currency: "RUB", metadata: {},
      };
      if (url === `https://api.arcpay.space/v1/payments?search=${topUpId}&page_size=5`) {
        expect(init?.method).toBe("GET");
        providerListRequests += 1;
        return Promise.resolve(new Response(JSON.stringify({
          payments: [payment], total: 1, page_size: 5, next_cursor: null,
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (url === `https://api.arcpay.space/v1/payments/${payment.id}`) {
        expect(init?.method).toBe("GET");
        return Promise.resolve(new Response(JSON.stringify(payment), {
          status: 200, headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "unexpected request" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }));
    };

    await pool.query(
      `
        INSERT INTO top_up_payments (
          id,
          user_id,
          idempotency_key,
          request_hash,
          provider,
          status,
          coin_amount_minor,
          fiat_amount_minor,
          fiat_currency,
          rate_fiat_minor,
          rate_coin_minor,
          provider_session_id,
          metadata
        )
        VALUES (
          $1,
          'user_76561198000000011',
          'topup-admin-reconcile',
          'topup-admin-reconcile-hash',
          'arc_pay',
          'checkout_pending',
          160000,
          100000,
          'RUB',
          100,
          160,
          '019facdb-b116-7434-b27c-debea8fb1c42',
          '{"environment":"sandbox","purpose":"wallet_topup"}'::jsonb
        )
      `,
      [topUpId],
    );
    app = await createApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/payments/reconcile")
      .set("x-admin-token", adminToken)
      .send({ reason: "recover missing payment provider webhook", limit: 10 })
      .expect(400);

    const first = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/payments/reconcile")
      .set("x-admin-token", adminToken)
      .set("idempotency-key", "admin-reconcile-arc-pay-1")
      .send({ reason: "recover missing payment provider webhook", limit: 10 })
      .expect(200);

    expect(first.body).toEqual({
      status: "processed",
      idempotencyKey: "admin-reconcile-arc-pay-1",
      result: {
        checked: 1,
        credited: 1,
        errors: 0,
        failed: 0,
        ignored: 0,
        manualReview: 0,
        steamRefillsCreated: 0,
        unmatched: 0,
      },
    });

    const second = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/payments/reconcile")
      .set("x-admin-token", adminToken)
      .set("idempotency-key", "admin-reconcile-arc-pay-1")
      .send({ reason: "recover missing payment provider webhook", limit: 10 })
      .expect(200);

    expect(second.body).toEqual({
      status: "duplicate",
      idempotencyKey: "admin-reconcile-arc-pay-1",
      result: null,
    });
    expect(providerListRequests).toBe(1);

    const persisted = await pool.query<{
      audit_metadata: Record<string, unknown>;
      audit_rows: string;
      idempotency_rows: string;
      payment_status: string;
      provider_status: string;
      wallet_transactions: string;
    }>(
      `
        SELECT
          (SELECT status FROM top_up_payments WHERE id = $1) AS payment_status,
          (SELECT provider_status FROM top_up_payments WHERE id = $1) AS provider_status,
          (SELECT count(*) FROM wallet_transactions WHERE user_id = 'user_76561198000000011' AND type = 'top_up_credit') AS wallet_transactions,
          (SELECT count(*) FROM idempotency_keys WHERE scope = 'admin:payments:reconcile' AND id = 'admin-reconcile-arc-pay-1' AND status = 'completed') AS idempotency_rows,
          (SELECT count(*) FROM audit_events WHERE action = 'admin.payments.reconcile' AND target_id = 'admin-reconcile-arc-pay-1') AS audit_rows,
          (SELECT metadata FROM audit_events WHERE action = 'admin.payments.reconcile' AND target_id = 'admin-reconcile-arc-pay-1' LIMIT 1) AS audit_metadata
      `,
      [topUpId],
    );
    expect(persisted.rows[0]).toMatchObject({
      payment_status: "paid",
      provider_status: "captured",
      wallet_transactions: "1",
      idempotency_rows: "1",
      audit_rows: "1",
    });
    expect(persisted.rows[0]?.audit_metadata).toEqual({
      idempotencyKey: "admin-reconcile-arc-pay-1",
      limit: 10,
      reason: "recover missing payment provider webhook",
      result: {
        checked: 1,
        credited: 1,
        errors: 0,
        failed: 0,
        ignored: 0,
        manualReview: 0,
        steamRefillsCreated: 0,
        unmatched: 0,
      },
      status: "processed",
    });
  });

  it("runs submitted SIH skin reconciliation once behind admin auth, idempotency, reason, and durable audit", async () => {
    await app?.close();
    const sihApiKeyFile = join(tempDir ?? tmpdir(), "sih-api-key");
    await writeFile(sihApiKeyFile, "test-sih-admin-reconcile\n", "utf8");
    process.env.SIH_API_KEY_FILE = sihApiKeyFile;

    const orderId = "019facdb-b116-7434-b27c-debea8fb1c50";
    const orderLineId = "019facdb-b116-7434-b27c-debea8fb1c51";
    const commandId = "019facdb-b116-7434-b27c-debea8fb1c52";
    const createAttemptId = "019facdb-b116-7434-b27c-debea8fb1c53";
    let providerGetOrderRequests = 0;
    globalThis.fetch = (input, init) => {
      const url = input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
      if (url.href === `https://api.sih.market/api/v1/get-order?customId=${createAttemptId}`) {
        providerGetOrderRequests += 1;
        expect(new Headers(init?.headers).get("apikey")).toBe("test-sih-admin-reconcile");
        return Promise.resolve(new Response(JSON.stringify({
          order: {
            amount: 1.011,
            customId: createAttemptId,
            expectedAmount: 1.011,
            id: 42,
            item: "Desert Eagle | Printstream (Minimal Wear)",
            sender: {
              offerId: 123456,
            },
            status: "sent",
            steamId: "76561198000000011",
          },
          success: true,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "unexpected request" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }));
    };

    await pool.query(
      `
        INSERT INTO orders (
          id,
          user_id,
          idempotency_key,
          request_hash,
          status,
          total_coin_minor,
          recipient_snapshots
        )
        VALUES (
          $1,
          'user_76561198000000011',
          'checkout-admin-sih-reconcile',
          'checkout-admin-sih-reconcile-hash',
          'processing',
          200000,
          '[{"kind":"steam-trade","steamId64":"76561198000000011","steamTradePartnerAccountId":"39734273","token":"must-not-leak"}]'::jsonb
        )
      `,
      [orderId],
    );
    await pool.query(
      `
        INSERT INTO order_lines (
          id,
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
        VALUES (
          $1,
          $2,
          1,
          'desert-eagle-printstream',
          'desert-eagle-printstream',
          'skins',
          'Desert Eagle | Printstream',
          200000,
          1,
          '{"kind":"steam-trade","steamId64":"76561198000000011","steamTradePartnerAccountId":"39734273","token":"must-not-leak"}'::jsonb,
          'supplier_submitted'
        )
      `,
      [orderLineId, orderId],
    );
    await pool.query(
      `
        INSERT INTO fulfillment_commands (
          id,
          order_id,
          order_line_id,
          provider,
          command_type,
          status,
          idempotency_key,
          payload_snapshot
        )
        VALUES (
          $1,
          $2,
          $3,
          'sih',
          'sih_skin_purchase',
          'submitted',
          'fulfillment-admin-sih-reconcile',
          '{"steamToken":"must-not-leak","marketHashName":"Desert Eagle | Printstream (Minimal Wear)"}'::jsonb
        )
      `,
      [commandId, orderId, orderLineId],
    );
    await pool.query(
      `
        INSERT INTO fulfillment_provider_attempts (
          id,
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
          finished_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'sih',
          'create_order',
          'succeeded',
          $5,
          '42',
          '{"token":"must-not-leak"}'::jsonb,
          '{"projection":"create_acknowledgement","providerOrderId":"42"}'::jsonb,
          now()
        )
      `,
      [createAttemptId, commandId, orderId, orderLineId, createAttemptId],
    );
    await pool.query("UPDATE fulfillment_commands SET available_at=now()+interval '1 day' WHERE id<>$1",[commandId]);
    await pool.query(`UPDATE fulfillment_commands SET provider_operation_id=$2,payload_snapshot=$3::jsonb,dispatched_at=now() WHERE id=$1`,[commandId,createAttemptId,JSON.stringify({schemaVersion:1,game:'cs2',marketHashName:'Desert Eagle | Printstream (Minimal Wear)',supplierCostCapMicrousd:'1011000',recipientSnapshot:{steamId64:'76561198000000011'}})]);
    app = await createApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/fulfillment/reconcile")
      .set("x-admin-token", adminToken)
      .send({ reason: "recover submitted SIH skin command", limit: 10 })
      .expect(400);

    const first = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/fulfillment/reconcile")
      .set("x-admin-token", adminToken)
      .set("idempotency-key", "admin-reconcile-sih-skins-1")
      .send({ reason: "recover submitted SIH skin command", limit: 10 })
      .expect(200);

    expect(first.body).toEqual({
      status: "processed",
      idempotencyKey: "admin-reconcile-sih-skins-1",
      result: {
        checked: 1,
        commands: [{
          commandId,
          status: "submitted",
        }],
        errors: 0,
        reconciled: 1,
      },
    });

    const second = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/admin/operations/fulfillment/reconcile")
      .set("x-admin-token", adminToken)
      .set("idempotency-key", "admin-reconcile-sih-skins-1")
      .send({ reason: "recover submitted SIH skin command", limit: 10 })
      .expect(200);

    expect(second.body).toEqual({
      status: "duplicate",
      idempotencyKey: "admin-reconcile-sih-skins-1",
      result: null,
    });
    expect(providerGetOrderRequests).toBe(1);

    const persisted = await pool.query<{
      audit_metadata: Record<string, unknown>;
      audit_rows: string;
      command_status: string;
      get_order_attempts: string;
      idempotency_rows: string;
      line_status: string;
      response_snapshot: Record<string, unknown>;
    }>(
      `
        SELECT
          (SELECT status FROM fulfillment_commands WHERE id = $1) AS command_status,
          (SELECT status FROM order_lines WHERE id = $2) AS line_status,
          (SELECT count(*) FROM fulfillment_provider_attempts WHERE command_id = $1 AND operation = 'review') AS get_order_attempts,
          (SELECT response_snapshot FROM fulfillment_provider_attempts WHERE command_id = $1 AND operation = 'review' LIMIT 1) AS response_snapshot,
          (SELECT count(*) FROM idempotency_keys WHERE scope = 'admin:fulfillment:reconcile' AND id = 'admin-reconcile-sih-skins-1' AND status = 'completed') AS idempotency_rows,
          (SELECT count(*) FROM audit_events WHERE action = 'admin.fulfillment.reconcile' AND target_id = 'admin-reconcile-sih-skins-1') AS audit_rows,
          (SELECT metadata FROM audit_events WHERE action = 'admin.fulfillment.reconcile' AND target_id = 'admin-reconcile-sih-skins-1' LIMIT 1) AS audit_metadata
      `,
      [commandId, orderLineId],
    );
    expect(persisted.rows[0]).toMatchObject({
      command_status: "submitted",
      get_order_attempts: "1",
      idempotency_rows: "1",
      line_status: "supplier_submitted",
      audit_rows: "1",
    });
    expect(persisted.rows[0]?.response_snapshot).toMatchObject({
      offerId: "123456",
      providerOrderId: "42",
      status: "sent",
    });
    expect(persisted.rows[0]?.audit_metadata).toEqual({
      idempotencyKey: "admin-reconcile-sih-skins-1",
      limit: 10,
      reason: "recover submitted SIH skin command",
      result: {
        checked: 1,
        commands: [{
          commandId,
          status: "submitted",
        }],
        errors: 0,
        reconciled: 1,
      },
      status: "processed",
    });
    expect(JSON.stringify(persisted.rows)).not.toContain("must-not-leak");
  });
});
