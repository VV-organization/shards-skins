import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArcoPayClient, ArcoPayRequestRejectedError, parseArcoPayPayment } from "./arco-pay.client";

const id = "019eb86c-91b2-7ce0-99f1-0a89a8b7b981";
const command = { amountMinor: 10000, cancelUrl: "https://frags.test/cancel", failUrl: "https://frags.test/fail", successUrl: "https://frags.test/success", description: "Пополнение", externalId: "topup-1", idempotencyKey: id, buyerEmail: "buyer@example.test" };
const order = { OrderId: id, MerchantOrderId: "topup-1", ShopId: 1581, Amount: 10000, Currency: "RUB", Status: "CREATED" };
const payload = (patch = {}) => ({ Response: { Success: true }, Order: { ...order, ...patch } });
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("ArcoPayClient", () => {
  let directory: string;
  let options: { apiKeyFile: string; bearerTokenFile: string; shopId: string; callbackUrl: string };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "frags-arco-"));
    options = { apiKeyFile: join(directory, "key"), bearerTokenFile: join(directory, "token"), shopId: "1581", callbackUrl: "https://api.frags.test/payments/webhooks/arco-pay" };
    await writeFile(options.apiKeyFile, "fixture-api-key\n");
    await writeFile(options.bearerTokenFile, "fixture-bearer-token\n");
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("permits constructing a disabled adapter with no credentials but rejects real operations before network", async () => {
    let calls = 0;
    const client = new ArcoPayClient({ apiKeyFile: "", bearerTokenFile: "", shopId: "", callbackUrl: "", fetch: () => { calls++; return response(payload()); } });
    await expect(client.createHostedCheckout(command)).rejects.toThrow(/^ARCO_PAY_/);
    await expect(client.getPayment(id)).rejects.toThrow(/^ARCO_PAY_/);
    expect(calls).toBe(0);
  });

  it("creates only a CARD hosted payment and returns a Paidlayer form URL", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ArcoPayClient({ ...options, fetch: (url, init) => { requests.push({ url, ...(init ? { init } : {}) }); return response(payload()); } });
    await expect(client.createHostedCheckout(command)).resolves.toEqual({ providerSessionId: id, checkoutUrl: `https://payment.paidlayer.com/${id}` });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.clickit.team/api/v1/payments/create");
    expect(requests[0]?.init).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Bearer fixture-bearer-token", "x-api-key": "fixture-api-key", "x-req-id": id } });
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(requests[0]?.init?.body as string)).toEqual({ MerchantOrderId: "topup-1", Amount: 10000, Currency: "RUB", Type: "PayIn", PaymentTypes: ["CARD"], IsForm: true, LifeTime: 900, Description: "Пополнение", CallbackUrl: options.callbackUrl, RedirectUrl: { SuccessUrl: command.successUrl, FailUrl: command.failUrl }, Buyer: { Email: "buyer@example.test" } });
  });

  it.each([{ Amount: 9999 }, { MerchantOrderId: "other" }, { Currency: "USD" }, { ShopId: 9999 }])("rejects a mismatched create response %j", async patch => {
    const client = new ArcoPayClient({ ...options, fetch: () => response(payload(patch)) });
    await expect(client.createHostedCheckout(command)).rejects.toThrow("ARCO_PAY_ORDER_MISMATCH");
  });

  it("fetches authoritative status by exact provider order id", async () => {
    let request: RequestInit | undefined;
    const client = new ArcoPayClient({ ...options, fetch: (url, init) => { expect(url).toBe("https://api.clickit.team/api/v1/payments/status"); request = init; return response(payload({ Status: "IPS_ACCEPTED", PaymentType: "IPS" })); } });
    await expect(client.getPayment(id)).resolves.toEqual({ id, externalId: "topup-1", amount: 10000, currency: "RUB", status: "captured", metadata: {} });
    expect(JSON.parse(request?.body as string)).toEqual({ OrderId: id });
    expect(new Headers(request?.headers).get("x-req-id")).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("rejects authoritative status for a different order", async () => {
    const client = new ArcoPayClient({ ...options, fetch: () => response(payload({ OrderId: "other" })) });
    await expect(client.getPayment(id)).rejects.toThrow("ARCO_PAY_ORDER_MISMATCH");
  });

  it("exposes explicit provider refusal as a typed redacted error", async () => {
    const client = new ArcoPayClient({ ...options, fetch: () => response({ Response: { Success: false, Message: "sensitive provider details" } }) });
    await expect(client.createHostedCheckout(command)).rejects.toBeInstanceOf(ArcoPayRequestRejectedError);
    await expect(client.createHostedCheckout(command)).rejects.toMatchObject({ message: "ARCO_PAY_REQUEST_REJECTED", code: "ARCO_PAY_REQUEST_REJECTED" });
  });

  it.each([400, 401, 429, 500, 503])("does not mistake HTTP %s for deterministic rejection or leak its body", async status => {
    const client = new ArcoPayClient({ ...options, fetch: () => response({ Response: { Success: false }, secret: "fixture-bearer-token" }, status) });
    await expect(client.getPayment(id)).rejects.toThrow(new RegExp(`^ARCO_PAY_HTTP_${status}$`));
  });

  it("redacts transport errors and never retries creation", async () => {
    let calls = 0;
    const client = new ArcoPayClient({ ...options, fetch: () => { calls++; return Promise.reject(new Error("fixture-bearer-token")); } });
    await expect(client.createHostedCheckout(command)).rejects.toThrow(/^ARCO_PAY_TRANSPORT_UNAVAILABLE$/);
    expect(calls).toBe(1);
  });

  it("rejects oversized responses", async () => {
    const client = new ArcoPayClient({ ...options, fetch: () => Promise.resolve(new Response("x".repeat(1048577))) });
    await expect(client.getPayment(id)).rejects.toThrow("ARCO_PAY_RESPONSE_TOO_LARGE");
  });

  it("redacts malformed JSON and stream errors", async () => {
    for (const result of [new Response("secret-not-json"), new Response(new ReadableStream({ start(controller) { controller.error(new Error("secret-stream")); } }))]) {
      const client = new ArcoPayClient({ ...options, fetch: () => Promise.resolve(result) });
      await expect(client.getPayment(id)).rejects.toThrow(/^ARCO_PAY_RESPONSE_INVALID$/);
    }
  });

  it.each(["", "bad\nheader"]) ("rejects empty or multiline credentials without sending a request", async credential => {
    await writeFile(options.bearerTokenFile, credential);
    let calls = 0;
    const client = new ArcoPayClient({ ...options, fetch: () => { calls++; return response(payload()); } });
    await expect(client.createHostedCheckout(command)).rejects.toThrow("ARCO_PAY_CREDENTIALS_UNAVAILABLE");
    expect(calls).toBe(0);
  });

  it.each([
    { amountMinor: 0 }, { amountMinor: 1.5 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { idempotencyKey: "invalid" }, { externalId: "x".repeat(51) }, { externalId: " " },
    { description: " " }, { buyerEmail: "invalid" }, { successUrl: "http://frags.test" },
    { failUrl: "https://a:b@frags.test" }, { cancelUrl: "https://frags.test/#x" },
  ])("rejects invalid create inputs before the network %j", async patch => {
    let calls = 0;
    const client = new ArcoPayClient({ ...options, fetch: () => { calls++; return response(payload()); } });
    await expect(client.createHostedCheckout({ ...command, ...patch })).rejects.toThrow(/^ARCO_PAY_/);
    expect(calls).toBe(0);
  });

  it.each([
    { baseUrl: "http://api.test" }, { baseUrl: "https://api.test/?secret=x" },
    { paymentOrigin: "https://form.test/path" }, { paymentOrigin: "https://form.test/?x=1" },
    { paymentOrigin: "not a URL" }, { callbackUrl: "https://user:pass@api.test/callback" },
    { shopId: "01581" },
  ])("rejects invalid configuration before creating an order %j", async patch => {
    let calls = 0;
    await expect(async () => {
      const client = new ArcoPayClient({ ...options, ...patch, fetch: () => { calls++; return response(payload()); } });
      await client.createHostedCheckout(command);
    }).rejects.toThrow(/^ARCO_PAY_/);
    expect(calls).toBe(0);
  });
});

describe("parseArcoPayPayment", () => {
  it.each([
    ["IPS_ACCEPTED", "captured"], ["CHARGED", "captured"], ["AUTHORIZED", "authorized"],
    ["QRCDATA_CREATED", "qrcdata_created"], ["QRCDATA_IN_PROGRESS", "qrcdata_in_progress"],
    ["CREATED", "created"], ["EXPIRED", "expired"], ["PAID", "paid"], ["REFUNDED", "refunded"],
  ])("maps %s without inventing payment success", (status, expected) => {
    expect(parseArcoPayPayment(payload({ Status: status }), "1581").status).toBe(expected);
  });
  it.each(["captured", "CAPTURED", "SETTLED", "ips_accepted", "UNKNOWN"]) ("rejects unrecognized status %s", status => {
    expect(() => parseArcoPayPayment(payload({ Status: status }), "1581")).toThrow("ARCO_PAY_RESPONSE_INVALID");
  });
  it.each(["CARD", "", null])("rejects IPS acceptance paired with non-IPS payment type %j", PaymentType => {
    expect(() => parseArcoPayPayment(payload({ Status: "IPS_ACCEPTED", PaymentType }), "1581")).toThrow(/^ARCO_PAY_/);
  });
  it.each(["IPS", "", null])("rejects card charge paired with non-card payment type %j", PaymentType => {
    expect(() => parseArcoPayPayment(payload({ Status: "CHARGED", PaymentType }), "1581")).toThrow(/^ARCO_PAY_/);
  });
  it.each([{ Amount: "10000" }, { Amount: -1 }, { Amount: 1.5 }, { OrderId: "../other" }, { ShopId: "01581" }, { MerchantOrderId: " " }])("rejects malformed order identity or money %j", patch => {
    expect(() => parseArcoPayPayment(payload(patch), "1581")).toThrow("ARCO_PAY_RESPONSE_INVALID");
  });
  it("accepts shop id represented as a canonical string", () => {
    expect(parseArcoPayPayment(payload({ ShopId: "1581" }), "1581").id).toBe(id);
  });
});
