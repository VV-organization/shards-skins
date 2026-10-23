import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
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
import { PaymentQuotesService } from "./payment-quotes.service";
import { PaymentHistoryService } from "./payment-history.service";
import { SessionsService } from "../sessions/sessions.service";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { IntegrationHealthService } from '../integration/integration-health.service';

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
type Kind = "coins" | "steam";
type ProviderOrder = {
  OrderId: string;
  MerchantOrderId: string;
  ShopId: number;
  Amount: number;
  Currency: string;
  Status: string;
  PaymentType: string;
};
const kinds = ["coins", "steam"] as const;
const tableFor = (kind: Kind) => kind === "coins" ? "top_up_payments" : "steam_refill_payments";

describe.skipIf(!databaseUrl)("ArcoPay CARD hosted checkout and Shards settlement", () => {
  let app: INestApplication;
  let pool: Pool;
  let directory: string;
  let payments: PaymentsService;
  let wallet: WalletService;
  let userId: string;
  const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const originalFetch = globalThis.fetch;
  const orders = new Map<string, ProviderOrder>();
  let rejectCreation = false;
  let creationRequests = 0;
  const statusRequests: string[] = [];
  const statusFailures = new Set<string>();
  let beforeCreateResponse: ((order: ProviderOrder) => Promise<void>) | undefined;
  const envNames = [
    "DATABASE_URL", "ARCO_PAY_PROVIDER_MODE", "ARCO_PAY_ENVIRONMENT", "ARCO_PAY_API_KEY_FILE",
    "ARCO_PAY_BEARER_TOKEN_FILE", "ARCO_PAY_PUBLIC_KEY_FILE", "ARCO_PAY_SHOP_ID",
    "ARCO_PAY_CALLBACK_URL", "ARCO_PAY_PUBLIC_ORIGIN",
  ];
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));

  beforeAll(async () => {
    if (new URL(databaseUrl ?? "").pathname !== "/shards_test") throw new Error("Test database required");
    directory = await mkdtemp(join(tmpdir(), "shards-arco-pay-http-"));
    await writeFile(join(directory, "api-key"), "fixture-api-key");
    await writeFile(join(directory, "bearer-token"), "fixture-bearer-token");
    await writeFile(join(directory, "public-key"), signingKeys.publicKey.export({ type: "spki", format: "pem" }));
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      ARCO_PAY_PROVIDER_MODE: "real",
      ARCO_PAY_ENVIRONMENT: "sandbox",
      ARCO_PAY_API_KEY_FILE: join(directory, "api-key"),
      ARCO_PAY_BEARER_TOKEN_FILE: join(directory, "bearer-token"),
      ARCO_PAY_PUBLIC_KEY_FILE: join(directory, "public-key"),
      ARCO_PAY_SHOP_ID: "1581",
      ARCO_PAY_CALLBACK_URL: "https://shards.example/payments/webhooks/arco-pay",
      ARCO_PAY_PUBLIC_ORIGIN: "https://shards.example",
    });
    globalThis.fetch = async (url, init) => {
      const endpoint = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      expect(endpoint.origin).toBe("https://api.clickit.team");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-bearer-token");
      const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
      if (endpoint.pathname === "/api/v1/payments/create") {
        creationRequests++;
        if (rejectCreation) return Response.json({ Response: { Success: false, Error: "Fixture rejection" } });
        expect(payload.PaymentTypes).toEqual(["CARD"]);
        expect(payload.IsForm).toBe(true);
        expect(payload.Currency).toBe("RUB");
        expect(payload.Type).toBe("PayIn");
        expect(payload.CallbackUrl).toBe("https://shards.example/payments/webhooks/arco-pay");
        const redirect = payload.RedirectUrl as { SuccessUrl: string; FailUrl: string };
        for (const url of [redirect.SuccessUrl, redirect.FailUrl]) {
          expect(new URL(url).origin).toBe("https://shards.example");
          expect(new URL(url).pathname).toBe("/payments/return");
        }
        const order: ProviderOrder = {
          OrderId: randomUUID(),
          MerchantOrderId: String(payload.MerchantOrderId),
          ShopId: 1581,
          Amount: Number(payload.Amount),
          Currency: "RUB",
          Status: "CREATED",
          PaymentType: "CARD",
        };
        orders.set(order.OrderId, order);
        await beforeCreateResponse?.(order);
        return Response.json({ Response: { Success: true }, Order: order });
      }
      expect(endpoint.pathname).toBe("/api/v1/payments/status");
      const id = String(payload.OrderId);
      statusRequests.push(id);
      expect(orders.has(id)).toBe(true);
      if (statusFailures.has(id)) throw new Error("Fixture status unavailable");
      return Response.json({ Response: { Success: true }, Order: orders.get(id) });
    };
    pool = new Pool({ connectionString: databaseUrl });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true });
    await app.init();
    payments = app.get(PaymentsService);
    wallet = app.get(WalletService);
  });

  beforeEach(async () => {
    orders.clear();
    rejectCreation = false;
    creationRequests = 0;
    statusRequests.length = 0;
    statusFailures.clear();
    beforeCreateResponse = undefined;
    await pool.query("DELETE FROM payment_webhook_events; DELETE FROM payment_provider_attempts; DELETE FROM steam_refill_payments; DELETE FROM top_up_payments;");
    userId = (await app.get(UsersService).upsertEmailUser(`arco-pay-${randomUUID()}@example.test`)).id;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    await pool.end();
    if (directory) await rm(directory, { recursive: true, force: true });
    for (const name of envNames) {
      if (savedEnv[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = savedEnv[name];
    }
  });

  function createPayment(kind: Kind, idempotencyKey = randomUUID()) {
    return kind === "coins"
      ? payments.createTopUpSession({ userId, coinAmountMinor: 160000, idempotencyKey })
      : payments.createSteamRefillSession({ userId, amountRub: 500, steamLogin: "shards_test_login", idempotencyKey });
  }

  async function create(kind: Kind, idempotencyKey = randomUUID()) {
    const session = await createPayment(kind, idempotencyKey);
    const order = [...orders.values()].find(candidate => candidate.MerchantOrderId === session.id);
    if (!order) throw new Error("Expected created provider order");
    expect(session).toMatchObject({
      status: "checkout_pending", provider: "arco_pay",
      fiatAmountMinor: kind === "coins" ? 100000 : 52500,
    });
    expect(order.Amount).toBe(kind === "coins" ? 100000 : 52500);
    expect(session.checkoutUrl).toBe(`https://payment.paidlayer.com/${order.OrderId}`);
    return { session, order };
  }

  function notify(order: ProviderOrder, validSignature = true, tamperRawBody = false) {
    const body = JSON.stringify({ Response: { Success: true }, Order: order });
    const signature = sign("RSA-SHA1", Buffer.from(body), signingKeys.privateKey).toString("base64");
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/payments/webhooks/arco-pay")
      .set("Content-Type", "application/json")
      .set("Payment-Sign", validSignature ? signature : Buffer.from("invalid signature").toString("base64"))
      .send(tamperRawBody ? `${body}\n` : body);
  }

  async function paymentRow(kind: Kind) {
    const result = await pool.query<{
      id: string; status: string; provider_session_id: string | null; order_id?: string;
      metadata: Record<string, unknown>;
    }>(`SELECT * FROM ${tableFor(kind)} WHERE user_id=$1`, [userId]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    if (!row) throw new Error("Expected persisted payment");
    return row;
  }

  async function expectUnsettled() {
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
  }

  async function expectSettledExactlyOnce(kind: Kind) {
    const row = await paymentRow(kind);
    expect(row.status).toBe("paid");
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(kind === "coins" ? 160000 : 0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id=$1", [userId])).rows[0]?.n).toBe(kind === "coins" ? 1 : 0);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [userId])).rows[0]?.n).toBe(kind === "steam" ? 1 : 0);
    if (kind === "steam") {
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM fulfillment_commands WHERE order_id=$1", [row.order_id])).rows[0]?.n).toBe(1);
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_holds WHERE user_id=$1", [userId])).rows[0]?.n).toBe(0);
    }
  }

  it.each(kinds)("settles %s exactly once across callback, duplicate receipt and reconciliation", async kind => {
    const { order } = await create(kind);
    await expectUnsettled();
    order.Status = "CHARGED";
    if (kind === "coins") expect((await notify(order)).status).toBe(200);
    await payments.reconcilePendingTopUps({ limit: 100 });
    expect((await notify(order)).status).toBe(200);
    const duplicate = await notify(order);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ status: "duplicate" });
    await payments.reconcilePendingTopUps({ limit: 100 });
    await expectSettledExactlyOnce(kind);
    expect(statusRequests.every(id => id === order.OrderId)).toBe(true);
    expect(creationRequests).toBe(1);
  });

  it.each(kinds)("returns one %s intent for simultaneous requests with the same key", async kind => {
    const key = randomUUID();
    const sessions = await Promise.all(Array.from({length: 6}, () => createPayment(kind, key)));
    expect(new Set(sessions.map(session => session.id)).size).toBe(1);
    expect(creationRequests).toBe(1);
    await expectUnsettled();
  });

  it.each(kinds)("creates independent %s payments while an earlier one is unpaid", async kind => {
    const one = await create(kind), two = await create(kind);
    expect(two.session.id).not.toBe(one.session.id);
    expect(two.order.OrderId).not.toBe(one.order.OrderId);
    expect(creationRequests).toBe(2);
    const rows = await pool.query<{ lifetime: number; status: string }>(`SELECT extract(epoch FROM expires_at-created_at)::int lifetime,status FROM ${tableFor(kind)} WHERE user_id=$1`, [userId]);
    expect(rows.rows).toEqual([{ lifetime: 900, status: "checkout_pending" }, { lifetime: 900, status: "checkout_pending" }]);
  });

  async function check(id: string, owner = userId, csrf = true) {
    const sessions = app.get(SessionsService);
    const session = await sessions.createSession(owner, null);
    const req = request(app.getHttpServer() as Parameters<typeof request>[0])
      .post(`/payments/sessions/${id}/check`).set("Cookie", `${CUSTOMER_SESSION_COOKIE}=${session.token}`);
    if (csrf) req.set("x-csrf-token", sessions.createCsrfToken(session.token));
    return req.send({});
  }

  it.each(kinds)("checks only the selected %s payment before allowing checkout", async kind => {
    const one = await create(kind), two = await create(kind);
    const res = await check(one.session.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({id:one.session.id,paymentStatus:"checkout_pending",canPay:true,checkoutUrl:one.session.checkoutUrl,failureReason:null});
    expect(statusRequests).toEqual([one.order.OrderId]);
    expect(creationRequests).toBe(2);
    expect((await app.get(PaymentQuotesService).getSession(userId,two.session.id)).paymentStatus).toBe("checkout_pending");
  });

  it.each(kinds)("checks %s ownership and CSRF before contacting the provider", async kind => {
    const {session} = await create(kind);
    const other = (await app.get(UsersService).upsertEmailUser(`${randomUUID()}@example.test`)).id;
    expect((await check(session.id, other)).status).toBe(404);
    expect((await check(session.id, userId, false)).status).toBe(403);
    expect(statusRequests).toEqual([]);
  });

  it.each(kinds)("rechecks an expired %s payment and exposes the reason in its history", async kind => {
    const {session,order} = await create(kind);order.Status="EXPIRED";
    const res = await check(session.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({paymentStatus:"failed",failureReason:"expired",canPay:false,checkoutUrl:null});
    expect((await app.get(PaymentHistoryService).listForUser(userId)).payments[0]).toMatchObject({id:session.id,status:"failed",failureReason:"expired",canPay:false});
    await expectUnsettled();
  });

  it.each(kinds)("settles an already charged %s payment on check without reopening checkout", async kind => {
    const {session,order} = await create(kind);order.Status="CHARGED";
    for (let i=0;i<2;i++) expect((await check(session.id)).body).toMatchObject({paymentStatus:"paid",canPay:false,checkoutUrl:null});
    await notify(order);await expectSettledExactlyOnce(kind);
    expect(creationRequests).toBe(1);
  });

  it.each(kinds)("never offers a %s checkout when provider verification fails", async kind => {
    const {session,order} = await create(kind);statusFailures.add(order.OrderId);
    const res = await check(session.id);
    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty("checkoutUrl");
    expect((await paymentRow(kind)).status).toBe("checkout_pending");
    await expectUnsettled();
  });

  it.each(kinds)("moves overdue %s to review and recovers a late charge exactly once", async kind => {
    const {session,order} = await create(kind);
    await pool.query(`UPDATE ${tableFor(kind)} SET expires_at=now()-interval '6 minutes' WHERE id=$1`,[session.id]);
    statusFailures.add(order.OrderId);
    await payments.reconcilePendingTopUps({limit:100});
    expect(await paymentRow(kind)).toMatchObject({status:"manual_review",metadata:{paymentStatusUnresolved:true}});
    expect(await app.get(IntegrationHealthService).operations()).toMatchObject({status:'degraded',unresolved_payments:1});
    await expectUnsettled();
    statusFailures.clear();order.Status="CHARGED";
    await payments.reconcilePendingTopUps({limit:100});await notify(order);
    await expectSettledExactlyOnce(kind);
    expect(await app.get(IntegrationHealthService).operations()).toMatchObject({unresolved_payments:0});
  });

  it.each(kinds)("does not offer %s checkout while a charge is already in progress", async kind => {
    const {session,order}=await create(kind);order.Status='CHARGE_IN_PROGRESS';
    expect((await check(session.id)).body).toMatchObject({paymentStatus:'checkout_pending',canPay:false,checkoutUrl:null});
    await expectUnsettled();
  });

  it.each(kinds)("does not reopen %s after local expiry even if provider still reports CREATED", async kind => {
    const {session} = await create(kind);
    await pool.query(`UPDATE ${tableFor(kind)} SET expires_at=now()-interval '1 second' WHERE id=$1`,[session.id]);
    expect((await check(session.id)).body).toMatchObject({paymentStatus:"checkout_pending",canPay:false,checkoutUrl:null});
    await expectUnsettled();
  });

  it.each(kinds)("handles CHARGE_DECLINED for %s instead of leaving it pending", async kind => {
    const {order} = await create(kind);order.Status="CHARGE_DECLINED";
    await payments.reconcilePendingTopUps({limit:100});
    expect((await paymentRow(kind)).status).toBe("failed");
    await expectUnsettled();
  });

  it("ignores a valid callback belonging to another site in the same shop", async () => {
    const foreign: ProviderOrder = {
      OrderId: randomUUID(), MerchantOrderId: randomUUID(), ShopId: 1581,
      Amount: 100000, Currency: "RUB", Status: "CHARGED", PaymentType: "CARD",
    };
    orders.set(foreign.OrderId, foreign);
    expect((await notify(foreign)).body).toEqual({status:"unmatched"});
    await expectUnsettled();
  });

  it.each(kinds)("ignores another provider order for an already bound %s payment", async kind => {
    const { order } = await create(kind);
    const other = { ...order, OrderId: randomUUID(), Status: "CHARGED" };
    orders.set(other.OrderId, other);
    expect((await notify(other)).body).toEqual({ status: "rejected" });
    await expectUnsettled();
    expect(await paymentRow(kind)).toMatchObject({
      status: "checkout_pending", provider_session_id: order.OrderId,
    });
  });

  it.each(kinds)("preserves the first %s order binding when create returns a different id", async kind => {
    let boundId = "";
    beforeCreateResponse = async order => {
      const other = { ...order, OrderId: randomUUID(), Status: "CHARGED" };
      boundId = other.OrderId;
      orders.set(other.OrderId, other);
      expect((await notify(other)).body).toEqual({ status: "processed" });
    };
    const session = await createPayment(kind);
    expect(session.checkoutUrl).toBeNull();
    expect(await paymentRow(kind)).toMatchObject({ status: "paid", provider_session_id: boundId });
    await expectSettledExactlyOnce(kind);
  });

  it.each(kinds)("still settles existing %s IPS orders after switching new checkouts to cards", async kind => {
    const { order } = await create(kind);
    await pool.query(`UPDATE ${tableFor(kind)} SET metadata=metadata - 'providerPaymentMethod' WHERE user_id=$1`, [userId]);
    order.PaymentType = "IPS";
    order.Status = "IPS_ACCEPTED";
    expect((await notify(order)).body).toEqual({ status: "processed" });
    await expectSettledExactlyOnce(kind);
  });

  it("reports the card method in newly created and paid top-up events", async () => {
    const { session, order } = await create("coins");
    order.Status = "CHARGED";
    await notify(order);
    const events = await pool.query<{ payload: { data: { paymentMethod: { type: string } } } }>(
      "SELECT payload FROM vv_admin_integration_outbox WHERE subject_external_id=$1 ORDER BY event_type", [session.id],
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows.every(row => row.payload.data.paymentMethod.type === "card")).toBe(true);
  });

  it.each(kinds)("rejects invalid signatures and any change to signed raw %s callback bytes", async kind => {
    const { order } = await create(kind);
    order.Status = "CHARGED";
    expect((await notify(order, false)).status).toBe(401);
    expect((await notify(order, true, true)).status).toBe(401);
    expect(statusRequests).toHaveLength(0);
    await expectUnsettled();
    expect((await paymentRow(kind)).status).toBe("checkout_pending");
  });

  it.each(kinds)("does not credit %s when a signed success callback disagrees with provider status", async kind => {
    const { order } = await create(kind);
    expect((await notify({ ...order, Status: "CHARGED" })).status).toBe(503);
    await expectUnsettled();
    expect((await paymentRow(kind)).status).toBe("checkout_pending");
    order.Status = "CHARGED";
    expect((await notify(order)).status).toBe(200);
    await expectSettledExactlyOnce(kind);
  });

  it.each(kinds)("rejects wrong %s callback shop, amount, currency and external identity", async kind => {
    const { order } = await create(kind);
    order.Status = "CHARGED";
    for (const changed of [
      { ShopId: 1582 }, { Amount: order.Amount + 1 }, { Currency: "USD" }, { MerchantOrderId: randomUUID() },
    ]) {
      expect((await notify({ ...order, ...changed })).status).toBe(400);
    }
    expect((await paymentRow(kind)).status).toBe("checkout_pending");
    await expectUnsettled();
  });

  it.each(kinds)("does not settle %s from authoritative amount that differs from the local payment", async kind => {
    const { order } = await create(kind);
    order.Status = "CHARGED";
    order.Amount += 1;
    await notify(order);
    await payments.reconcilePendingTopUps({ limit: 100 });
    await expectUnsettled();
    expect((await paymentRow(kind)).status).not.toBe("paid");
  });

  for (const status of ["CREATED", "QRCDATA_CREATED", "AUTHORIZED", "CHARGE_IN_PROGRESS"]) {
    it.each(kinds)(`never treats ${status} as a successful %s CARD payment`, async kind => {
      const { order } = await create(kind);
      order.Status = status;
      expect((await notify(order)).status).toBe(200);
      await payments.reconcilePendingTopUps({ limit: 100 });
      await expectUnsettled();
      expect((await paymentRow(kind)).status).not.toBe("paid");
    });
  }

  it.each(kinds)("preserves %s settlement when the callback arrives before create returns", async kind => {
    beforeCreateResponse = async order => {
      order.Status = "CHARGED";
      expect((await notify(order)).status).toBe(200);
    };
    const session = await createPayment(kind);
    expect(session.status).toBe("paid");
    await expectSettledExactlyOnce(kind);
  });

  it.each(kinds)("preserves %s settlement when create times out after an early callback", async kind => {
    let callbackResult: {status:number; body:unknown} | undefined;
    beforeCreateResponse = async order => {
      order.Status = "CHARGED";
      callbackResult = await notify(order);
      throw new Error("Fixture connection lost after successful callback");
    };
    await createPayment(kind).catch(() => undefined);
    expect(callbackResult).toMatchObject({status:200,body:{status:"processed"}});
    await expectSettledExactlyOnce(kind);
    expect(creationRequests).toBe(1);
  });

  it.each(kinds)("keeps ambiguous %s creation in manual review without retrying or guessing a provider id", async kind => {
    beforeCreateResponse = () => Promise.reject(new Error("Fixture connection lost before response"));
    const idempotencyKey = randomUUID();
    await expect(createPayment(kind, idempotencyKey)).rejects.toThrow("checkout creation failed");
    expect(await paymentRow(kind)).toMatchObject({
      status: "manual_review", provider_session_id: null, metadata: { providerCreationAmbiguous: true },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await createPayment(kind, idempotencyKey)).status).toBe("manual_review");
      await payments.reconcilePendingTopUps({ limit: 100 });
    }
    expect(creationRequests).toBe(1);
    expect(statusRequests).toHaveLength(0);
    await expectUnsettled();
    const order = [...orders.values()][0];
    if (!order) throw new Error("Expected provider order after lost response");
    order.Status = "CHARGED";
    expect((await notify(order)).status).toBe(200);
    expect((await paymentRow(kind)).provider_session_id).toBe(order.OrderId);
    expect((await notify(order)).body).toEqual({ status: "duplicate" });
    await payments.reconcilePendingTopUps({ limit: 100 });
    await expectSettledExactlyOnce(kind);
    expect(creationRequests).toBe(1);
  });

  it.each(kinds)("does not create another %s order after a process crash before provider id persistence", async kind => {
    const idempotencyKey = randomUUID();
    const { session } = await create(kind, idempotencyKey);
    await pool.query(`UPDATE ${tableFor(kind)} SET status='provider_creation_pending', provider_session_id=NULL, provider_checkout_url=NULL, created_at=now() - interval '2 minutes' WHERE id=$1`, [session.id]);
    const replay = await createPayment(kind, idempotencyKey);
    expect(replay.id).toBe(session.id);
    expect(replay.checkoutUrl).toBeNull();
    await payments.reconcilePendingTopUps({ limit: 100 });
    expect((await paymentRow(kind)).status).toBe("manual_review");
    expect(creationRequests).toBe(1);
    expect(statusRequests).toHaveLength(0);
    await expectUnsettled();
  });

  it.each(kinds)("leaves fresh %s creation pending when reconciliation races the create request", async kind => {
    beforeCreateResponse = async () => {
      await payments.reconcilePendingTopUps({ limit: 100 });
      expect((await paymentRow(kind)).status).toBe("provider_creation_pending");
      expect(statusRequests).toHaveLength(0);
      await expectUnsettled();
    };
    await create(kind);
    expect((await paymentRow(kind)).status).toBe("checkout_pending");
    expect(creationRequests).toBe(1);
  });

  it.each(kinds)("binds a signed CREATED callback after lost %s creation and reconciles later card charge", async kind => {
    beforeCreateResponse = () => Promise.reject(new Error("Fixture lost create response"));
    await expect(createPayment(kind)).rejects.toThrow("checkout creation failed");
    const order = [...orders.values()][0];
    if (!order) throw new Error("Expected provider order after lost response");
    expect((await notify(order)).status).toBe(200);
    expect((await paymentRow(kind)).provider_session_id).toBe(order.OrderId);
    await expectUnsettled();
    order.Status = "CHARGED";
    await payments.reconcilePendingTopUps({ limit: 100 });
    await expectSettledExactlyOnce(kind);
    expect(statusRequests).toEqual([order.OrderId, order.OrderId]);
    expect(creationRequests).toBe(1);
  });

  it.each(kinds)("marks %s creation failed after an explicit provider refusal", async kind => {
    rejectCreation = true;
    await expect(createPayment(kind)).rejects.toThrow("checkout creation failed");
    expect((await paymentRow(kind)).status).toBe("failed");
    await expectUnsettled();
  });

  it.each(["pending", "error"] as const)("reconciles Steam and newer top-ups without starvation behind an older %s top-up", async oldestState => {
    const oldest = await create("coins");
    const steam = await create("steam");
    const newer = await create("coins");
    await pool.query("UPDATE top_up_payments SET created_at=now() - interval '3 minutes' WHERE id=$1", [oldest.session.id]);
    await pool.query("UPDATE steam_refill_payments SET created_at=now() - interval '2 minutes' WHERE id=$1", [steam.session.id]);
    await pool.query("UPDATE top_up_payments SET created_at=now() - interval '1 minute' WHERE id=$1", [newer.session.id]);
    if (oldestState === "error") statusFailures.add(oldest.order.OrderId);
    steam.order.Status = "CHARGED";
    newer.order.Status = "CHARGED";

    expect(await payments.reconcilePendingTopUps({ limit: 1 })).toMatchObject({
      checked: 1, errors: oldestState === "error" ? 1 : 0, credited: 0, steamRefillsCreated: 0,
    });
    expect(await payments.reconcilePendingTopUps({ limit: 1 })).toMatchObject({
      checked: 1, errors: 0, credited: 0, steamRefillsCreated: 1,
    });
    await expectSettledExactlyOnce("steam");
    expect(await payments.reconcilePendingTopUps({ limit: 1 })).toMatchObject({
      checked: 1, errors: 0, credited: 1, steamRefillsCreated: 0,
    });
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(160000);
    expect((await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM top_up_payments WHERE user_id=$1 ORDER BY created_at", [userId],
    )).rows).toEqual([
      { id: oldest.session.id, status: "checkout_pending" },
      { id: newer.session.id, status: "paid" },
    ]);
    expect(statusRequests).toEqual([oldest.order.OrderId, steam.order.OrderId, newer.order.OrderId]);

    statusFailures.clear();
    oldest.order.Status = "CHARGED";
    expect(await payments.reconcilePendingTopUps({ limit: 1 })).toMatchObject({ checked: 1, credited: 1 });
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(320000);
    expect(creationRequests).toBe(3);
  });

  it("rotates previously attempted pending payments across both products", async () => {
    const oldest = await create("coins");
    const steam = await create("steam");
    const newer = await create("coins");
    await pool.query("UPDATE top_up_payments SET created_at=now() - interval '3 minutes' WHERE id=$1", [oldest.session.id]);
    await pool.query("UPDATE steam_refill_payments SET created_at=now() - interval '2 minutes' WHERE id=$1", [steam.session.id]);
    await pool.query("UPDATE top_up_payments SET created_at=now() - interval '1 minute' WHERE id=$1", [newer.session.id]);
    for (let cycle = 0; cycle < 3; cycle++) {
      expect(await payments.reconcilePendingTopUps({ limit: 1 })).toMatchObject({
        checked: 1, credited: 0, steamRefillsCreated: 0,
      });
    }
    newer.order.Status = "CHARGED";
    for (let cycle = 0; cycle < 3; cycle++) {
      expect(await payments.reconcilePendingTopUps({ limit: 1 })).toMatchObject({
        checked: 1, credited: cycle === 2 ? 1 : 0, steamRefillsCreated: 0,
      });
    }
    expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(160000);
    expect((await paymentRow("steam")).status).toBe("checkout_pending");
    expect(statusRequests).toEqual([
      oldest.order.OrderId, steam.order.OrderId, newer.order.OrderId,
      oldest.order.OrderId, steam.order.OrderId, newer.order.OrderId,
    ]);
    expect(creationRequests).toBe(3);
  });
});
