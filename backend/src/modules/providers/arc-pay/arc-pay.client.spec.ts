import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArcPayClient } from "./arc-pay.client";

const id = "019eb86c-91b2-7ce0-99f1-0a89a8b7b981";
const command = { amountMinor: 10000, cancelUrl: "https://shards.test/cancel", failUrl: "https://shards.test/fail", successUrl: "https://shards.test/success", description: "Пополнение", externalId: "topup-1", idempotencyKey: id, buyerEmail: "buyer@example.test" };
const method = { method: "sbp", payment_mode: "h2h", display_name: "СБП", is_active: true, supported_currencies: ["RUB"], min_amount: 100, max_amount: 100000 };
const payment = { id, status: "captured", amount: 10000, currency: "RUB", external_id: "topup-1", metadata: { shards_top_up_id: "topup-1" } };
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
describe("ArcPayClient", () => {
  let tempDir: string, keyFile: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "shards-arc-")); keyFile = join(tempDir, "key"); await writeFile(keyFile, "sk_test_fixture\n"); });
  afterEach(async () => { await rm(tempDir, { recursive: true, force: true }); });
  it("discovers the exact active SBP h2h pair before creating Arc Pay hosted checkout", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ArcPayClient({ apiKeyFile: keyFile, environment: "sandbox", fetch: (url, init) => { requests.push({ url, ...(init === undefined ? {} : { init }) }); return response(url.includes("available") ? [method] : { id, url: "https://checkout.arcpay.space/session/fixture" }); } });
    await expect(client.createHostedCheckout(command)).resolves.toEqual({ providerSessionId: id, checkoutUrl: "https://checkout.arcpay.space/session/fixture" });
    expect(requests[0]?.url).toBe("https://api.arcpay.space/v1/payment-methods/available?environment=sandbox");
    expect(requests[1]?.init).toMatchObject({ redirect: "error", headers: { authorization: "Bearer sk_test_fixture", "idempotency-key": id } });
    expect(JSON.parse(requests[1]?.init?.body as string)).toMatchObject({ payment_methods: [{ method: "sbp", payment_mode: "h2h" }], capture_mode: "one_stage", locale: "ru", currency: "RUB", customer_email: command.buyerEmail });
  });
  it.each([[], [{ ...method, method: "bank_card" }], [{ ...method, payment_mode: "redirect" }], [{ ...method, is_active: false }], [{ ...method, supported_currencies: ["KZT"] }], [{ ...method, min_amount: 20000 }]].map((methods) => ({ methods })))("does not create when discovery cannot enable requested SBP (%j)", async ({ methods }) => {
    let calls = 0;
    const client = new ArcPayClient({ apiKeyFile: keyFile, fetch: () => { calls++; return response(methods); } });
    await expect(client.createHostedCheckout(command)).rejects.toThrow("ARC_PAY_SBP_UNAVAILABLE"); expect(calls).toBe(1);
  });
  it("rejects configured/key environment mismatch before network", async () => {
    const client = new ArcPayClient({ apiKeyFile: keyFile, environment: "live", fetch: () => { throw new Error("should not fetch"); } });
    await expect(client.createHostedCheckout(command)).rejects.toThrow("ARC_PAY_ENVIRONMENT_MISMATCH");
  });
  it.each(["http://checkout.test/a", "https://user:pass@checkout.test/a", "javascript:alert(1)", "https://checkout.test/#a"])("rejects unsafe checkout URL %s", async (url) => {
    const client = new ArcPayClient({ apiKeyFile: keyFile, fetch: (path) => response(path.includes("available") ? [method] : { id, url }) });
    await expect(client.createHostedCheckout(command)).rejects.toThrow("ARC_PAY_CHECKOUT_URL_INVALID");
  });
  it("rejects an HTTPS checkout outside the configured provider origins", async () => {
    const client=new ArcPayClient({apiKeyFile:keyFile,allowedCheckoutOrigins:['https://approved.example'],fetch:path=>response(path.includes('available')?[method]:{id,url:'https://untrusted.example/checkout'})});
    await expect(client.createHostedCheckout(command)).rejects.toThrow('ARC_PAY_CHECKOUT_URL_INVALID');
  });
  it("matches the authoritative payment id", async () => {
    const client = new ArcPayClient({ apiKeyFile: keyFile, fetch: () => response({ ...payment, id: "019eb86c-91b2-7ce0-99f1-0a89a8b7b982" }) });
    await expect(client.getPayment(id)).rejects.toThrow("ARC_PAY_PAYMENT_MISMATCH");
  });
  it("returns authoritative identity and list pagination", async () => {
    const client = new ArcPayClient({ apiKeyFile: keyFile, fetch: (url) => response(url.includes("?") ? { payments: [payment], total: 1, page_size: 5 } : payment) });
    await expect(client.getPayment(id)).resolves.toMatchObject({ id, externalId: "topup-1", status: "captured", amount: 10000 });
    await expect(client.listPayments({ search: "topup-1" })).resolves.toMatchObject({ total: 1, nextCursor: null, payments: [{ id }] });
  });
  it("does not leak provider error response", async () => {
    const client = new ArcPayClient({ apiKeyFile: keyFile, fetch: () => Promise.resolve(new Response("sensitive provider payload", { status: 503 })) });
    await expect(client.getPayment(id)).rejects.toThrow(/^ARC_PAY_HTTP_503$/);
  });
  it("aborts a timed out request without retry", async () => {
    let calls = 0;
    const client = new ArcPayClient({ apiKeyFile: keyFile, timeoutMs: 10, fetch: (_url, init) => { calls++; return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => { reject(new Error("credential leak")); }, { once: true })); } });
    await expect(client.getPayment(id)).rejects.toThrow(/^ARC_PAY_TRANSPORT_UNAVAILABLE$/); expect(calls).toBe(1);
  });
  it("rejects oversized response bodies", async () => {
    const client = new ArcPayClient({ apiKeyFile: keyFile, fetch: () => Promise.resolve(new Response("x".repeat(1048577))) });
    await expect(client.getPayment(id)).rejects.toThrow("ARC_PAY_RESPONSE_TOO_LARGE");
  });
});
