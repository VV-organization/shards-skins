import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export type CreateHostedCheckoutCommand = {
  amountMinor: number; cancelUrl: string; description: string; externalId: string;
  failUrl: string; idempotencyKey: string; metadata?: Record<string, string>; successUrl: string;
  buyerEmail?: string;
};
export type HostedCheckoutResult = { providerSessionId: string; checkoutUrl: string };
export type ArcoPayPayment = { id: string; status: string; amount: number; currency: string; externalId: string; metadata: Record<string, string> };
export type ArcoPayClientOptions = {
  apiKeyFile: string; bearerTokenFile: string; shopId: string; callbackUrl: string;
  baseUrl?: string; paymentOrigin?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

export class ArcoPayRequestRejectedError extends Error {
  readonly code = "ARCO_PAY_REQUEST_REJECTED";
  constructor() { super("ARCO_PAY_REQUEST_REJECTED"); this.name = "ArcoPayRequestRejectedError"; }
}

const orderId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const merchantOrderId = z.string().min(1).max(50).refine(value => value === value.trim());
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const orderSchema = z.object({
  OrderId: orderId,
  MerchantOrderId: merchantOrderId,
  ShopId: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d*$/)]),
  Amount: minor,
  Currency: z.string().length(3),
  PaymentType: z.string().optional(),
  Status: z.enum([
    "CREATED", "AUTHORIZATION", "AUTHORIZED", "DECLINED", "CHARGE_IN_PROGRESS", "CHARGE_DECLINED", "CHARGED",
    "VOID_IN_PROGRESS", "VOID_DECLINED", "VOIDED", "REFUND_IN_PROGRESS", "REFUND_DECLINED", "REFUNDED",
    "PAYOUT_IN_PROGRESS", "PAID", "EXPIRED", "IN_PROCESS", "IPS_ACCEPTED", "QRCDATA_IN_PROGRESS", "QRCDATA_CREATED",
    "P2P_PAYOUT", "P2P_PAID", "PRE_AUTHORIZED_3DS",
  ]),
});

export function parseArcoPayPayment(payload: unknown, shopId: string): ArcoPayPayment {
  const parsed = z.object({ Response: z.object({ Success: z.literal(true) }), Order: orderSchema }).safeParse(payload);
  if (!parsed.success) throw new Error("ARCO_PAY_RESPONSE_INVALID");
  const order = parsed.data.Order;
  if (String(order.ShopId) !== shopId || order.Currency !== "RUB" ||
      (order.Status === "IPS_ACCEPTED" && order.PaymentType !== undefined && order.PaymentType !== "IPS") ||
      (order.Status === "CHARGED" && order.PaymentType !== undefined && order.PaymentType !== "CARD")) {
    throw new Error("ARCO_PAY_ORDER_MISMATCH");
  }
  return { id: order.OrderId, externalId: order.MerchantOrderId, amount: order.Amount, currency: order.Currency,
    status: order.Status === "IPS_ACCEPTED" || order.Status === "CHARGED" ? "captured" : order.Status.toLowerCase(), metadata: {} };
}

function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("ARCO_PAY_URL_INVALID"); }
  if (value !== value.trim() || url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("ARCO_PAY_URL_INVALID");
  return url;
}

export class ArcoPayClient {
  private readonly baseUrl: string;
  private readonly paymentOrigin: URL;

  constructor(private readonly options: ArcoPayClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.clickit.team/api/v1").replace(/\/$/, "");
    if (httpsUrl(this.baseUrl).search) throw new Error("ARCO_PAY_URL_INVALID");
    this.paymentOrigin = httpsUrl(options.paymentOrigin ?? "https://payment.paidlayer.com");
    if (this.paymentOrigin.pathname !== "/" || this.paymentOrigin.search) throw new Error("ARCO_PAY_URL_INVALID");
  }

  async createHostedCheckout(command: CreateHostedCheckoutCommand): Promise<HostedCheckoutResult> {
    if (!minor.positive().safeParse(command.amountMinor).success) throw new Error("ARCO_PAY_AMOUNT_INVALID");
    if (!z.uuid().safeParse(command.idempotencyKey).success || !merchantOrderId.safeParse(command.externalId).success ||
        !command.description.trim() || command.description.length > 500 ||
        (command.buyerEmail !== undefined && !z.email().safeParse(command.buyerEmail).success)) throw new Error("ARCO_PAY_REQUEST_INVALID");
    [command.successUrl, command.failUrl, command.cancelUrl, this.options.callbackUrl].forEach(httpsUrl);
    const payment = await this.request("/payments/create", {
      MerchantOrderId: command.externalId, Amount: command.amountMinor, Currency: "RUB", Type: "PayIn",
      PaymentTypes: ["CARD"], IsForm: true, LifeTime: 900, Description: command.description,
      CallbackUrl: this.options.callbackUrl,
      RedirectUrl: { SuccessUrl: command.successUrl, FailUrl: command.failUrl },
      ...(command.buyerEmail ? { Buyer: { Email: command.buyerEmail } } : {}),
    }, command.idempotencyKey);
    if (payment.externalId !== command.externalId || payment.amount !== command.amountMinor) throw new Error("ARCO_PAY_ORDER_MISMATCH");
    return { providerSessionId: payment.id, checkoutUrl: new URL(`/${payment.id}`, this.paymentOrigin).href };
  }

  async getPayment(paymentId: string): Promise<ArcoPayPayment> {
    if (!orderId.safeParse(paymentId).success) throw new Error("ARCO_PAY_ORDER_ID_INVALID");
    const payment = await this.request("/payments/status", { OrderId: paymentId }, randomUUID());
    if (payment.id !== paymentId) throw new Error("ARCO_PAY_ORDER_MISMATCH");
    return payment;
  }

  private async request(path: string, body: unknown, requestId: string): Promise<ArcoPayPayment> {
    if (!/^[1-9]\d*$/.test(this.options.shopId)) throw new Error("ARCO_PAY_SHOP_ID_INVALID");
    let apiKey: string, token: string;
    try {
      const credentials = await Promise.all([readFile(this.options.apiKeyFile, "utf8"), readFile(this.options.bearerTokenFile, "utf8")]);
      apiKey = credentials[0].trim(); token = credentials[1].trim();
      if (!apiKey || !token || /\s/.test(apiKey) || /\s/.test(token)) throw new Error();
    } catch { throw new Error("ARCO_PAY_CREDENTIALS_UNAVAILABLE"); }
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.baseUrl + path, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${token}`, "x-api-key": apiKey, "x-req-id": requestId, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { throw new Error("ARCO_PAY_TRANSPORT_UNAVAILABLE"); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`ARCO_PAY_HTTP_${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("ARCO_PAY_RESPONSE_INVALID");
    const chunks: Uint8Array[] = [];
    let size = 0;
    let payload: unknown;
    try {
      for (;;) {
        const chunk = await reader.read() as { done: true } | { done: false; value: Uint8Array };
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1048576) {
          await reader.cancel().catch(() => undefined);
          throw new Error("ARCO_PAY_RESPONSE_TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof Error && error.message === "ARCO_PAY_RESPONSE_TOO_LARGE") throw error;
      throw new Error("ARCO_PAY_RESPONSE_INVALID");
    } finally { reader.releaseLock(); }
    if (z.object({ Response: z.object({ Success: z.literal(false) }) }).safeParse(payload).success) throw new ArcoPayRequestRejectedError();
    return parseArcoPayPayment(payload, this.options.shopId);
  }
}
