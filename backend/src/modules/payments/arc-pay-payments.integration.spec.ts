import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";
import { PaymentsService } from "./payments.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const signingSecret = "sandbox-webhook-fixture-secret";
type ProviderOrder = { id: string; sessionId: string; external_id: string; amount: number; currency: string; status: string; metadata: Record<string, string> };

describe.skipIf(!databaseUrl)("Arc Pay SBP hosted checkout with existing Shards settlement", () => {
  let app: INestApplication;
  let pool: Pool;
  let directory: string;
  let payments: PaymentsService;
  let wallet: WalletService;
  let userId: string;
  const originalFetch = globalThis.fetch;
  const orders = new Map<string, ProviderOrder>();
  let rejectCreation = false;
  let creationRequests = 0;
  let incompletePage: "cursor" | "total" | null = null;
  let beforeCreateResponse: ((order: ProviderOrder) => Promise<void>) | undefined;
  const envNames = ["DATABASE_URL", "ARC_PAY_PROVIDER_MODE", "ARC_PAY_ENVIRONMENT", "ARC_PAY_SECRET_KEY_FILE", "ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE", "ARC_PAY_PUBLIC_ORIGIN"];
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));

  beforeAll(async () => {
    if (new URL(databaseUrl ?? "").pathname !== "/shards_test") throw new Error("Test database required");
    directory = await mkdtemp(join(tmpdir(), "shards-arc-pay-http-"));
    await writeFile(join(directory, "key"), "sk_test_fixture");
    await writeFile(join(directory, "webhook"), signingSecret);
    Object.assign(process.env, { DATABASE_URL: databaseUrl, ARC_PAY_PROVIDER_MODE: "real", ARC_PAY_ENVIRONMENT: "sandbox",
      ARC_PAY_SECRET_KEY_FILE: join(directory, "key"), ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE: join(directory, "webhook"),
      ARC_PAY_PUBLIC_ORIGIN: "https://shards.example" });
    globalThis.fetch = async (url, init) => {
      const endpoint = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      expect(endpoint.origin).toBe("https://api.arcpay.space");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_test_fixture");
      if (endpoint.pathname === "/v1/payment-methods/available") {
        expect(endpoint.searchParams.get("environment")).toBe("sandbox");
        return Response.json([{ method: "sbp", payment_mode: "h2h", display_name: "СБП", is_active: true, supported_currencies: ["RUB"], min_amount: 100, max_amount: 10000000 }]);
      }
      if (endpoint.pathname === "/v1/checkout/sessions") {
        creationRequests++;
        if (rejectCreation) return new Response("{}", { status: 422 });
        expect(init?.method).toBe("POST");
        const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { payment_methods: unknown; external_id: string; amount: number; currency: string; metadata: Record<string, string>; success_url: string; fail_url: string; cancel_url: string };
        expect(payload.payment_methods).toEqual([{ method: "sbp", payment_mode: "h2h" }]);
        expect(payload.currency).toBe("RUB");
        for (const returnUrl of [payload.success_url, payload.fail_url, payload.cancel_url]) expect(new URL(returnUrl).origin).toBe("https://shards.example");
        const order: ProviderOrder = { id: randomUUID(), sessionId: randomUUID(), external_id: payload.external_id, amount: payload.amount, currency: "RUB", status: "pending", metadata: payload.metadata };
        orders.set(order.id, order);
        await beforeCreateResponse?.(order);
        return Response.json({ id: order.sessionId, url: `https://pay.arcpay.space/checkout/${order.sessionId}` });
      }
      expect(init?.method).toBe("GET");
      if (endpoint.pathname === "/v1/payments") {
        expect(endpoint.searchParams.get("page_size")).toBe("5");
        const matching = [...orders.values()].filter(order => order.external_id === endpoint.searchParams.get("search"));
        return Response.json({ payments: matching, total: matching.length + (incompletePage === "total" ? 1 : 0), page_size: 5, next_cursor: incompletePage === "cursor" ? "another-page" : null });
      }
      const id = endpoint.pathname.replace("/v1/payments/", "");
      expect(endpoint.pathname).toBe(`/v1/payments/${id}`);
      expect(orders.has(id)).toBe(true);
      return Response.json(orders.get(id));
    };
    pool = new Pool({ connectionString: databaseUrl });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true });
    await app.init();
    payments = app.get(PaymentsService); wallet = app.get(WalletService);
  });
  beforeEach(async () => {
    orders.clear(); rejectCreation = false; creationRequests = 0; incompletePage = null;
    beforeCreateResponse = undefined;
    await pool.query("DELETE FROM payment_webhook_events; DELETE FROM payment_provider_attempts; DELETE FROM steam_refill_payments; DELETE FROM top_up_payments;");
    userId = (await app.get(UsersService).upsertEmailUser(`arc-pay-${randomUUID()}@example.test`)).id;
  });
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close(); await pool.end();
    if (directory) await rm(directory, { recursive: true, force: true });
    for (const name of envNames) { if (savedEnv[name] === undefined) Reflect.deleteProperty(process.env, name); else process.env[name] = savedEnv[name]; }
  });

  async function create(kind: "coins" | "steam", idempotencyKey = randomUUID()) {
    const session = kind === "coins"
      ? await payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey })
      : await payments.createSteamRefillSession({ userId, amountRub: 500, steamLogin: "shards_test_login", idempotencyKey });
    const order = [...orders.values()].find(o => o.external_id === session.id);
    if (!order) throw new Error("Expected created provider order");
    expect(session).toMatchObject({ status: "checkout_pending", provider: "arc_pay", fiatAmountMinor: kind === "coins" ? 100000 : 52500 });
    expect(order.id).not.toBe(order.sessionId);
    expect(session.checkoutUrl).toBe(`https://pay.arcpay.space/checkout/${order.sessionId}`);
    return { session, order };
  }
  async function notify(order: ProviderOrder, signatureValid = true, eventId = randomUUID(), sparse = false) {
    const body = JSON.stringify({ id: eventId, event_type: `payment.${order.status}`, data: sparse ? { payment_id: order.id } : { payment_id: order.id, amount: order.amount, currency: order.currency, external_id: order.external_id } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", signingSecret).update(`${eventId}.${timestamp}.${body}`).digest("hex");
    return request(app.getHttpServer() as Parameters<typeof request>[0]).post("/payments/webhooks/arc-pay")
      .set("Content-Type", "application/json").set("Webhook-Id", eventId).set("Webhook-Timestamp", timestamp)
      .set("Webhook-Signature", `t=${timestamp},v1=${signatureValid ? signature : "0".repeat(64)}`).send(body);
  }

  it.each(["coins", "steam"] as const)("settles %s exactly once through signed notifications and reconciliation", async kind => {
    const { session, order } = await create(kind);
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
    expect((await notify({ ...order, status: "captured" }, false)).status).toBe(401);
    // A signed charged notification cannot override the authoritative pending status.
    expect((await notify({ ...order, status: "captured" })).status).toBe(503);
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
    order.status = "captured";
    if (kind === "coins") expect((await notify(order)).status).toBe(200);
    await payments.reconcilePendingTopUps({ limit: 100 });
    const eventId = randomUUID();
    expect((await notify(order, true, eventId)).status).toBe(200);
    const duplicate = await notify(order, true, eventId);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ status: "duplicate" });
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    const row = (await pool.query<{ status: string; order_id: string }>(`SELECT * FROM ${table} WHERE id=$1`, [session.id])).rows[0];
    if (!row) throw new Error("Expected persisted payment");
    expect(row.status).toBe("paid");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
    if (kind === "coins") {
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id=$1", [userId])).rows[0]?.n).toBe(1);
    } else {
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(1);
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM fulfillment_commands WHERE order_id=$1", [row.order_id])).rows[0]?.n).toBe(1);
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_holds WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
    }
    order.status = "refunded";
    expect((await notify(order)).status).toBe(200);
    expect((await pool.query<{ status: string; order_id: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("manual_review");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
  });

  it.each(["coins", "steam"] as const)("rejects mismatched %s callback identity, amount and currency without settlement", async kind => {
    const { session, order } = await create(kind);
    order.status = "captured";
    for (const changed of [{ external_id: randomUUID() }, { amount: order.amount + 1 }, { currency: "USD" }]) {
      expect((await notify({ ...order, ...changed })).status).toBe(400);
    }
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("checkout_pending");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
  });

  it.each(["coins", "steam"] as const)("marks declined %s payments failed without fulfillment or Coins", async kind => {
    const { session, order } = await create(kind); order.status = "failed";
    expect((await notify(order)).status).toBe(200);
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    expect((await pool.query<{ status: string; order_id: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("failed");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
  });

  it.each(["coins", "steam"] as const)("preserves %s settlement when a callback precedes the create response", async kind => {
    beforeCreateResponse = async order => {
      order.status = "captured";
      expect((await notify(order)).status).toBe(200);
    };
    const session = kind === "coins"
      ? await payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey: randomUUID() })
      : await payments.createSteamRefillSession({ userId, amountRub: 500, steamLogin: "shards_test_login", idempotencyKey: randomUUID() });
    expect(session.status).toBe("paid");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
  });

  it.each(["coins", "steam"] as const)("preserves %s settlement when the create connection fails after a callback", async kind => {
    beforeCreateResponse = async order => {
      order.status = "captured";
      expect((await notify(order)).status).toBe(200);
      throw new Error("Connection interrupted after provider created the order");
    };
    const operation = kind === "coins"
      ? payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey: randomUUID() })
      : payments.createSteamRefillSession({ userId, amountRub: 500, steamLogin: "shards_test_login", idempotencyKey: randomUUID() });
    await operation.catch(() => undefined);
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE user_id=$1`, [userId])).rows[0]?.status).toBe("paid");
  });

  it.each(["coins", "steam"] as const)("reconciles a lost %s create response without callback or a second creation", async kind => {
    beforeCreateResponse = () => Promise.reject(new Error("Connection lost after provider creation"));
    const idempotencyKey = randomUUID();
    const createPayment = () => kind === "coins"
      ? payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey })
      : payments.createSteamRefillSession({ userId, amountRub: 500, steamLogin: "shards_test_login", idempotencyKey });
    await expect(createPayment()).rejects.toThrow("checkout creation failed");
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    const row = (await pool.query<{ id: string; status: string; metadata: Record<string, unknown> }>(`SELECT id, status, metadata FROM ${table} WHERE user_id=$1`, [userId])).rows[0];
    expect(row).toMatchObject({ status: "manual_review", metadata: { providerCreationAmbiguous: true } });
    expect((await createPayment()).status).toBe("manual_review");
    expect(creationRequests).toBe(1);
    const order = [...orders.values()][0];
    if (!order) throw new Error("Expected provider payment after lost response");
    expect(order.external_id).toBe(row?.id);
    order.status = "captured";
    await payments.reconcilePendingTopUps({ limit: 100 });
    expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [row?.id])).rows[0]?.status).toBe("paid");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
    expect(creationRequests).toBe(1);
  });

  it.each(["coins", "steam"] as const)("keeps authoritative %s timeout nonterminal and reconciles a later capture", async kind => {
    const { session, order } = await create(kind);
    order.status = "timeout";
    expect((await notify(order)).status).toBe(200);
    await payments.reconcilePendingTopUps({ limit: 100 });
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("checkout_pending");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
    order.status = "captured";
    await payments.reconcilePendingTopUps({ limit: 100 });
    expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("paid");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
  });

  it.each(["coins", "steam"] as const)("settles %s from a signed sparse event using authoritative payment fields", async kind => {
    const { session, order } = await create(kind);
    order.status = "captured";
    expect((await notify(order, true, randomUUID(), true)).status).toBe(200);
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("paid");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
  });

  it.each(["coins", "steam"] as const)("never creates a second %s checkout when replaying a crashed creation", async kind => {
    const idempotencyKey = randomUUID();
    const { session } = await create(kind, idempotencyKey);
    const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
    await pool.query(`UPDATE ${table} SET status='provider_creation_pending', provider_session_id=NULL, provider_checkout_url=NULL WHERE id=$1`, [session.id]);
    const replay = kind === "coins"
      ? await payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey })
      : await payments.createSteamRefillSession({ userId, amountRub: 500, steamLogin: "shards_test_login", idempotencyKey });
    expect(replay.id).toBe(session.id);
    expect(replay.status).toBe("provider_creation_pending");
    expect(replay.checkoutUrl).toBeNull();
    expect(creationRequests).toBe(1);
    expect(orders.size).toBe(1);
  });

  for (const pagination of ["cursor", "total"] as const) {
    it.each(["coins", "steam"] as const)(`does not settle %s from incomplete payment search indicated by ${pagination}`, async kind => {
      const { session, order } = await create(kind);
      order.status = "captured";
      incompletePage = pagination;
      await payments.reconcilePendingTopUps({ limit: 100 });
      const table = kind === "coins" ? "top_up_payments" : "steam_refill_payments";
      expect((await pool.query<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [session.id])).rows[0]?.status).toBe("checkout_pending");
      expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
    });
  }

  it("preserves failed creation handling when the provider rejects the request", async () => {
    rejectCreation = true;
    await expect(payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey: randomUUID() })).rejects.toThrow("checkout creation failed");
    expect((await pool.query<{ status: string }>("SELECT status FROM top_up_payments WHERE user_id=$1", [userId])).rows[0]?.status).toBe("failed");
  });
});
