import { readFile } from "node:fs/promises";
import { z } from "zod";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type CreateHostedCheckoutCommand = {
  amountMinor: number; cancelUrl: string; description: string; externalId: string;
  failUrl: string; idempotencyKey: string; metadata?: Record<string, string>; successUrl: string;
  buyerEmail?: string;
};
export type HostedCheckoutResult = { providerSessionId: string; checkoutUrl: string };
export type ArcPayPayment = { id: string; status: string; amount: number; currency: string; externalId: string | null; metadata: Record<string, string> };
export type ArcPayPaymentList = { nextCursor: string | null; pageSize: number; payments: ArcPayPayment[]; total: number };
export type ArcPayClientOptions = { allowedCheckoutOrigins?: string[]; apiKeyFile: string; baseUrl?: string; environment?: "sandbox" | "live"; fetch?: FetchLike; timeoutMs?: number };
const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const paymentSchema = z.object({
  id: uuid, amount: minor, currency: z.enum(["RUB", "KZT", "UZS"]),
  status: z.enum(["created", "pending", "pending_3ds", "authorized", "captured", "settled", "voided", "expired", "refunded", "chargeback", "declined", "failed", "timeout"]),
  external_id: z.string().max(255).optional(), metadata: z.record(z.string(), z.string()).optional(),
});
const methodsSchema = z.array(z.object({ method: z.string(), payment_mode: z.enum(["h2h", "redirect"]), display_name: z.string(), is_active: z.boolean(), supported_currencies: z.array(z.string()).optional(), min_amount: minor.optional(), max_amount: minor.optional() }));
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("ARC_PAY_RESPONSE_INVALID");
  return parsed.data;
}
function assertHttpsUrl(name: string, value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name}_INVALID`); }
  if (value !== value.trim() || url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`${name}_INVALID`);
  return url;
}
function paymentFromBody(body: unknown): ArcPayPayment {
  const value = parse(paymentSchema, body);
  return { id: value.id, amount: value.amount, currency: value.currency, status: value.status, externalId: value.external_id ?? null, metadata: value.metadata ?? {} };
}
export class ArcPayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  constructor(private readonly options: ArcPayClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.arcpay.space/v1").replace(/\/$/, "");
    const url = assertHttpsUrl("ARC_PAY_BASE_URL", this.baseUrl);
    if (url.search) throw new Error("ARC_PAY_BASE_URL_INVALID");
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000) throw new Error("ARC_PAY_TIMEOUT_INVALID");
  }
  private async credentials(): Promise<{ apiKey: string; environment: "sandbox" | "live" }> {
    let apiKey: string;
    try { apiKey = (await readFile(this.options.apiKeyFile, "utf8")).trim(); } catch { throw new Error("ARC_PAY_CREDENTIALS_UNAVAILABLE"); }
    const environment = apiKey.startsWith("sk_test_") ? "sandbox" : apiKey.startsWith("sk_live_") ? "live" : null;
    if (!environment || /\s/.test(apiKey)) throw new Error("ARC_PAY_CREDENTIALS_UNAVAILABLE");
    if (this.options.environment && this.options.environment !== environment) throw new Error("ARC_PAY_ENVIRONMENT_MISMATCH");
    return { apiKey, environment };
  }
  async createHostedCheckout(command: CreateHostedCheckoutCommand): Promise<HostedCheckoutResult> {
    if(this.options.allowedCheckoutOrigins?.length===0)throw new Error("ARC_PAY_CHECKOUT_ORIGINS_REQUIRED");
    if (!minor.positive().safeParse(command.amountMinor).success) throw new Error("ARC_PAY_AMOUNT_INVALID");
    if (!uuid.safeParse(command.idempotencyKey).success) throw new Error("ARC_PAY_IDEMPOTENCY_KEY_INVALID");
    if (!command.description.trim() || command.description.length > 500 || !command.externalId.trim() || command.externalId.length > 255) throw new Error("ARC_PAY_REQUEST_INVALID");
    assertHttpsUrl("ARC_PAY_SUCCESS_URL", command.successUrl);
    assertHttpsUrl("ARC_PAY_FAIL_URL", command.failUrl);
    assertHttpsUrl("ARC_PAY_CANCEL_URL", command.cancelUrl);
    if (command.buyerEmail !== undefined && !z.email().safeParse(command.buyerEmail).success) throw new Error("ARC_PAY_REQUEST_INVALID");
    if (command.metadata && (!z.record(z.string(), z.string()).safeParse(command.metadata).success || Object.keys(command.metadata).length > 20)) throw new Error("ARC_PAY_REQUEST_INVALID");
    const { apiKey, environment } = await this.credentials();
    const methods = parse(methodsSchema, await this.request(`/payment-methods/available?environment=${environment}`, apiKey));
    const available = methods.some((method) => method.method === "sbp" && method.payment_mode === "h2h" && method.is_active && (!method.supported_currencies || method.supported_currencies.includes("RUB")) && (method.min_amount === undefined || command.amountMinor >= method.min_amount) && (method.max_amount === undefined || command.amountMinor <= method.max_amount));
    if (!available) throw new Error("ARC_PAY_SBP_UNAVAILABLE");
    const checkout = parse(z.object({ id: uuid, url: z.string() }), await this.request("/checkout/sessions", apiKey, {
      amount: command.amountMinor, currency: "RUB", capture_mode: "one_stage", locale: "ru",
      payment_methods: [{ method: "sbp", payment_mode: "h2h" }], description: command.description,
      external_id: command.externalId, metadata: command.metadata ?? { shards_top_up_id: command.externalId },
      success_url: command.successUrl, fail_url: command.failUrl, cancel_url: command.cancelUrl,
      ...(command.buyerEmail ? { customer_email: command.buyerEmail } : {}),
    }, command.idempotencyKey));
    const hosted=assertHttpsUrl("ARC_PAY_CHECKOUT_URL", checkout.url);
    if(this.options.allowedCheckoutOrigins&&!this.options.allowedCheckoutOrigins.includes(hosted.origin))throw new Error("ARC_PAY_CHECKOUT_URL_INVALID");
    return { providerSessionId: checkout.id, checkoutUrl: checkout.url };
  }
  async getPayment(paymentId: string): Promise<ArcPayPayment> {
    if (!uuid.safeParse(paymentId).success) throw new Error("ARC_PAY_PAYMENT_ID_INVALID");
    const { apiKey } = await this.credentials();
    const payment = paymentFromBody(await this.request(`/payments/${paymentId}`, apiKey));
    if (payment.id !== paymentId) throw new Error("ARC_PAY_PAYMENT_MISMATCH");
    return payment;
  }
  async listPayments(command: { pageSize?: number; search: string }): Promise<ArcPayPaymentList> {
    if (!command.search.trim()) throw new Error("ARC_PAY_PAYMENT_SEARCH_REQUIRED");
    const pageSize = command.pageSize ?? 5;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("ARC_PAY_PAGE_SIZE_INVALID");
    const { apiKey } = await this.credentials();
    const query = new URLSearchParams({ search: command.search, page_size: String(pageSize) });
    const result = parse(z.object({ payments: z.array(paymentSchema), total: minor, page_size: z.number().int().min(1).max(100), next_cursor: z.union([uuid, z.literal("")]).nullish() }), await this.request(`/payments?${query.toString()}`, apiKey));
    return { payments: result.payments.map(paymentFromBody), total: result.total, pageSize: result.page_size, nextCursor: result.next_cursor || null };
  }
  private async request(path: string, apiKey: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.baseUrl + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error("ARC_PAY_TRANSPORT_UNAVAILABLE"); }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`ARC_PAY_HTTP_${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("ARC_PAY_RESPONSE_INVALID");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read() as { done: true } | { done: false; value: Uint8Array };
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1048576) { await reader.cancel(); throw new Error("ARC_PAY_RESPONSE_TOO_LARGE"); }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof Error && error.message === "ARC_PAY_RESPONSE_TOO_LARGE") throw error;
      throw new Error("ARC_PAY_RESPONSE_INVALID");
    } finally { reader.releaseLock(); }
  }
}
