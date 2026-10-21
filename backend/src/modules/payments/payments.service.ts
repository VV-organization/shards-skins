import {QuotesService} from "../quotes/quotes.service";
import {WALLET_TERMS_VERSION,STEAM_TERMS_VERSION,type PaymentTerms,type PaymentPurpose,type PaymentQuoteBinding} from "./payment-quote.types";
import { topUpFiatMinor } from "../../common/money/shards";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import { DatabaseService } from "../../common/database/database.service";
import { normalizeIdempotencyKey } from "../../common/idempotency/idempotency-key";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { ArcPayClient } from "../providers/arc-pay/arc-pay.client";
import { verifyFakeArcPayWebhookSignature } from "../providers/arc-pay/arc-pay-fake-webhook";
import { verifyArcPayWebhookSignature } from "../providers/arc-pay/arc-pay-webhook-signature";
import { STEAM_REFILL_MAX_RUB, STEAM_REFILL_MIN_RUB } from "../catalog/steam-refill-product";
import type { CheckoutRecipientSnapshot } from "../checkout/checkout.service";
import { FulfillmentService, type FulfillmentOrderLineInput } from "../fulfillment/fulfillment.service";
import { WalletService } from "../wallet/wallet.service";

type Queryable = {
  query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>>;
};

const TOP_UP_MIN_COIN_MINOR = 10_000;
const TOP_UP_MAX_COIN_MINOR = 10_000_000;
const COIN_RATE_FIAT_MINOR = 100;
const COIN_RATE_COIN_MINOR = 160;
const TOP_UP_PROVIDER = "arc_pay";
const STEAM_REFILL_PROVIDER = "arc_pay";
const STEAM_REFILL_FEE_BASIS_POINTS = 500;
const BASIS_POINTS_DENOMINATOR = 10_000;

export type CreateTopUpSessionCommand = {
  quoteBinding?: PaymentQuoteBinding;
  userId: string;
  idempotencyKey: string;
  coinAmountMinor: number;
};

export type TopUpSessionDto = {
  id: string;
  userId: string;
  status: "provider_configuration_required" | "provider_creation_pending" | "checkout_pending" | "paid" | "failed" | "manual_review";
  provider: "arc_pay";
  coinAmountMinor: number;
  fiatAmountMinor: number;
  fiatCurrency: "RUB";
  rate: {
    fiatMinor: 100;
    coinMinor: number;
  };
  checkoutUrl: string | null;
};

export type CreateSteamRefillSessionCommand = {
  quoteBinding?: PaymentQuoteBinding;
  userId: string;
  idempotencyKey: string;
  amountRub: number;
  steamLogin: string;
};

export type SteamRefillSessionDto = {
  id: string;
  userId: string;
  status: "provider_configuration_required" | "provider_creation_pending" | "checkout_pending" | "paid" | "failed" | "manual_review";
  provider: "arc_pay";
  amountRubMinor: number;
  feeRubMinor: number;
  fiatAmountMinor: number;
  fiatCurrency: "RUB";
  steamLogin: string;
  checkoutUrl: string | null;
};

export type HandleArcPayWebhookCommand = {
  providerEventId?: string;
  rawBody?: Buffer;
  signature?: string;
  timestamp?: string;
  payload: unknown;
};

export type PaymentWebhookResultDto = {
  status: "processed" | "duplicate" | "ignored" | "unmatched" | "rejected";
};

export type PaymentReconciliationResultDto = {
  checked: number;
  credited: number;
  errors: number;
  failed: number;
  ignored: number;
  manualReview: number;
  steamRefillsCreated: number;
  unmatched: number;
};

type TopUpPaymentRow = {
  id: string;
  user_id: string;
  status: TopUpSessionDto["status"];
  provider: TopUpSessionDto["provider"];
  coin_amount_minor: number;
  fiat_amount_minor: number;
  fiat_currency: TopUpSessionDto["fiatCurrency"];
  rate_fiat_minor: 100;
  rate_coin_minor: number;
  provider_checkout_url: string | null;
  request_hash: string;
};

type SteamRefillPaymentRow = {
  id: string;
  user_id: string;
  status: SteamRefillSessionDto["status"];
  provider: SteamRefillSessionDto["provider"];
  amount_rub_minor: number;
  fee_rub_minor: number;
  fiat_amount_minor: number;
  fiat_currency: SteamRefillSessionDto["fiatCurrency"];
  steam_login: string;
  provider_checkout_url: string | null;
  request_hash: string;
};

type TopUpPaymentWebhookRow = {
  id: string;
  user_id: string;
  status: TopUpSessionDto["status"];
  coin_amount_minor: number;
  fiat_amount_minor: number;
  fiat_currency: TopUpSessionDto["fiatCurrency"];
};

type SteamRefillPaymentWebhookRow = {
  id: string;
  user_id: string;
  status: SteamRefillSessionDto["status"];
  amount_rub_minor: number;
  fee_rub_minor: number;
  fiat_amount_minor: number;
  fiat_currency: SteamRefillSessionDto["fiatCurrency"];
  steam_login: string;
  order_id: string | null;
};

type VvAdminTopUpEventType = "top_up.created" | "top_up.completed" | "top_up.failed";

type TopUpPaymentReconciliationRow = TopUpPaymentWebhookRow & {
  request_hash: string;
  provider_session_id: string | null;
};

type SteamRefillPaymentReconciliationRow = SteamRefillPaymentWebhookRow & {
  request_hash: string;
  provider_session_id: string | null;
};

type PaymentReconciliationTarget = {
  id: string;
  kind: "steam_refill" | "top_up";
  request_hash: string;
};

type NormalizedArcPayWebhook = {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  providerSessionId: string;
  topUpPaymentId: string | null;
  providerStatus: string;
  amountMinor: number;
  currency: string;
  payloadSnapshot: Record<string, unknown>;
};

type ParsedArcPayWebhook = Omit<NormalizedArcPayWebhook, "amountMinor" | "currency"> & {
  amountMinor: number | undefined;
  currency: string | undefined;
};

function requestHash(command: Pick<CreateTopUpSessionCommand, "coinAmountMinor" | "userId" | "quoteBinding">): string {
  return createHash("sha256").update(JSON.stringify({
    coinAmountMinor: command.coinAmountMinor,
    ...(command.quoteBinding?{quoteBinding:command.quoteBinding}:{}),
    userId: command.userId,
  }), "utf8").digest("hex");
}

function steamRefillRequestHash(command: Pick<CreateSteamRefillSessionCommand, "amountRub" | "steamLogin" | "userId" | "quoteBinding">): string {
  return createHash("sha256").update(JSON.stringify({
    amountRub: command.amountRub,
    steamLogin: normalizeSteamLogin(command.steamLogin),
    ...(command.quoteBinding?{quoteBinding:command.quoteBinding}:{}),
    userId: command.userId,
  }), "utf8").digest("hex");
}

function requireIdempotencyKey(value: string): string {
  const normalized = normalizeIdempotencyKey(value);
  if (normalized === undefined) throw new BadRequestException("Idempotency key is required");
  return normalized;
}

function assertCoinAmountMinor(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < TOP_UP_MIN_COIN_MINOR ||
    value > TOP_UP_MAX_COIN_MINOR ||
    value % 100 !== 0
  ) {
    throw new BadRequestException("Top-up amount must be a whole Shards amount between 100 and 100000 Shards");
  }
}

function assertSteamRefillAmountRub(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < STEAM_REFILL_MIN_RUB ||
    value > STEAM_REFILL_MAX_RUB
  ) {
    throw new BadRequestException(`Steam refill amount must be a whole RUB amount between ${STEAM_REFILL_MIN_RUB} and ${STEAM_REFILL_MAX_RUB}`);
  }
}

function normalizeSteamLogin(value: string): string {
  const steamLogin = value.trim();
  if (steamLogin.length < 3 || steamLogin.length > 64) {
    throw new BadRequestException("Steam login must be between 3 and 64 characters");
  }
  return steamLogin;
}

function fiatMinorForCoinMinor(coinAmountMinor: number): number {
  return topUpFiatMinor(coinAmountMinor);
}

function steamRefillPaymentTerms(amountRub: number): { amountRubMinor: number; feeRubMinor: number; fiatAmountMinor: number } {
  const amountRubMinor = amountRub * 100;
  const feeRubMinor = Math.ceil((amountRubMinor * STEAM_REFILL_FEE_BASIS_POINTS) / BASIS_POINTS_DENOMINATOR);
  return {
    amountRubMinor,
    feeRubMinor,
    fiatAmountMinor: amountRubMinor + feeRubMinor,
  };
}

function topUpReturnUrls(publicOrigin: string,sessionId:string): { cancelUrl: string; failUrl: string; successUrl: string } {
  const base = new URL("payments/return", publicOrigin.endsWith("/") ? publicOrigin : `${publicOrigin}/`);
  base.searchParams.set("session",sessionId);
  const success = new URL(base);
  success.searchParams.set("payment", "success");
  const fail = new URL(base);
  fail.searchParams.set("payment", "failed");
  const cancel = new URL(base);
  cancel.searchParams.set("payment", "cancelled");
  return {
    cancelUrl: cancel.href,
    failUrl: fail.href,
    successUrl: success.href,
  };
}

function steamRefillReturnUrls(publicOrigin: string,sessionId:string): { cancelUrl: string; failUrl: string; successUrl: string } {
  const base = new URL("payments/return", publicOrigin.endsWith("/") ? publicOrigin : `${publicOrigin}/`);
  base.searchParams.set("session",sessionId);
  const success = new URL(base);
  success.searchParams.set("payment", "success");
  const fail = new URL(base);
  fail.searchParams.set("payment", "failed");
  const cancel = new URL(base);
  cancel.searchParams.set("payment", "cancelled");
  return {
    cancelUrl: cancel.href,
    failUrl: fail.href,
    successUrl: success.href,
  };
}

function ambiguousCheckoutCreation(errorCode: string): boolean {
  return errorCode === "ARC_PAY_TRANSPORT_UNAVAILABLE" || errorCode.startsWith("ARC_PAY_RESPONSE_") ||
    errorCode === "ARC_PAY_CHECKOUT_URL_INVALID" || /^ARC_PAY_HTTP_(?:5\d\d|408|409|429)$/.test(errorCode);
}

function providerErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.slice(0, 120);
  return "ARC_PAY_CHECKOUT_CREATE_FAILED";
}

function toDto(row: TopUpPaymentRow): TopUpSessionDto {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    provider: row.provider,
    coinAmountMinor: row.coin_amount_minor,
    fiatAmountMinor: row.fiat_amount_minor,
    fiatCurrency: row.fiat_currency,
    rate: {
      fiatMinor: row.rate_fiat_minor,
      coinMinor: row.rate_coin_minor,
    },
    checkoutUrl: row.provider_checkout_url,
  };
}

function steamRefillToDto(row: SteamRefillPaymentRow): SteamRefillSessionDto {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    provider: row.provider,
    amountRubMinor: row.amount_rub_minor,
    feeRubMinor: row.fee_rub_minor,
    fiatAmountMinor: row.fiat_amount_minor,
    fiatCurrency: row.fiat_currency,
    steamLogin: row.steam_login,
    checkoutUrl: row.provider_checkout_url,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new BadRequestException("payment provider webhook payload must be an object");
}

function optionalStringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function optionalIntegerField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Number.isSafeInteger(value)) return value as number;
  }
  return undefined;
}

function optionalRecordField(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return {};
}

function normalizeArcPayWebhook(providerEventIdHeader: string | undefined, payload: unknown): ParsedArcPayWebhook {
  const root = asRecord(payload);
  const payment = root.payment !== null && typeof root.payment === "object" && !Array.isArray(root.payment)
    ? root.payment as Record<string, unknown>
    : {};
  const data = root.data !== null && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : {};
  const providerEventId = providerEventIdHeader ?? optionalStringField(root, "eventId", "event_id", "id");
  const eventType = optionalStringField(root, "type", "event", "event_type");
  const providerSessionId = optionalStringField(root, "checkoutSessionId", "checkout_session_id")
    ?? optionalStringField(payment, "checkoutSessionId", "checkout_session_id", "checkout_session", "metadata_top_up_session")
    ?? optionalStringField(data, "checkoutSessionId", "checkout_session_id");
  const providerPaymentId = optionalStringField(data, "payment_id", "id")
    ?? optionalStringField(payment, "payment_id", "id");
  const providerStatus = optionalStringField(root, "status")
    ?? optionalStringField(payment, "status")
    ?? eventType?.replace(/^payment\./, "");
  const amountMinor = optionalIntegerField(root, "amount")
    ?? optionalIntegerField(payment, "amount", "captured_amount")
    ?? optionalIntegerField(data, "captured_amount", "amount");
  const currency = optionalStringField(root, "currency")
    ?? optionalStringField(payment, "currency")
    ?? optionalStringField(data, "currency");
  const metadata = {
    ...optionalRecordField(root, "metadata"),
    ...optionalRecordField(payment, "metadata"),
    ...optionalRecordField(data, "metadata"),
  };
  const topUpPaymentId = optionalStringField(root, "external_id", "externalId", "shards_top_up_id", "shards_steam_refill_payment_id")
    ?? optionalStringField(payment, "external_id", "externalId", "shards_top_up_id", "shards_steam_refill_payment_id")
    ?? optionalStringField(data, "external_id", "externalId", "shards_top_up_id", "shards_steam_refill_payment_id")
    ?? optionalStringField(metadata, "shards_top_up_id", "top_up_payment_id", "shards_steam_refill_payment_id");

  const normalizedProviderSessionId = providerSessionId ?? providerPaymentId;
  if (!providerEventId || !eventType || !normalizedProviderSessionId || !providerStatus) {
    throw new BadRequestException("payment provider webhook payload is missing required payment fields");
  }

  if (!/^payment\.(created|pending|pending_3ds|authorized|captured|settled|voided|expired|refunded|chargeback|declined|failed|timeout)$/.test(eventType)) {
    throw new BadRequestException("Unsupported payment provider event");
  }
  // Missing snapshot fields can be recovered from GET /payments/{id}; malformed
  // fields must never be silently treated as absent.
  for (const record of [root, payment, data]) {
    for (const key of ["amount", "captured_amount"]) {
      if (record[key] !== undefined && (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0)) {
        throw new BadRequestException("Payment notification amount is invalid");
      }
    }
    if (record.currency !== undefined && (typeof record.currency !== "string" || !record.currency.trim())) {
      throw new BadRequestException("Payment notification currency is invalid");
    }
  }

  return {
    providerEventId,
    eventType,
    providerPaymentId: providerPaymentId ?? null,
    providerSessionId: normalizedProviderSessionId,
    topUpPaymentId: topUpPaymentId ?? null,
    providerStatus,
    amountMinor,
    currency: currency?.toUpperCase(),
    payloadSnapshot: root,
  };
}

function isCapturedWebhook(event: NormalizedArcPayWebhook): boolean {
  return event.eventType === "payment.captured" || event.providerStatus === "captured" || event.providerStatus === "settled";
}

function isFailedWebhook(event: NormalizedArcPayWebhook): boolean {
  return ["payment.failed", "payment.declined", "payment.expired", "payment.voided"].includes(event.eventType)
    || isFailedProviderStatus(event.providerStatus);
}

function isManualReviewWebhook(event: NormalizedArcPayWebhook): boolean {
  return ["payment.refunded", "payment.chargeback"].includes(event.eventType)
    || isManualReviewProviderStatus(event.providerStatus);
}

function isCapturedProviderStatus(status: string): boolean {
  return status === "captured" || status === "settled";
}

function isFailedProviderStatus(status: string): boolean {
  return ["failed", "declined", "expired", "voided"].includes(status);
}

function isManualReviewProviderStatus(status: string): boolean {
  return ["refunded", "chargeback"].includes(status);
}

function topUpStatusForVvAdmin(eventType: VvAdminTopUpEventType): "created" | "completed" | "failed" {
  if (eventType === "top_up.completed") return "completed";
  if (eventType === "top_up.failed") return "failed";
  return "created";
}

function manualReviewReason(providerStatus: string): string {
  if (providerStatus === "chargeback") return "arc_pay_chargeback_after_credit";
  return "arc_pay_refunded_after_credit";
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(ArcPayClient) private readonly arcPay: ArcPayClient,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Optional() @Inject(QuotesService) private readonly quotes?: QuotesService,
  ) {}

  private async requirePaymentQuote(client:Queryable,command:CreateTopUpSessionCommand|CreateSteamRefillSessionCommand,purpose:PaymentPurpose):Promise<PaymentTerms|null>{
    if(!command.quoteBinding)return null;
    if(!this.quotes)throw new ServiceUnavailableException('Quotes unavailable');
    const terms=await this.quotes.lock<PaymentTerms>(client,command.quoteBinding.quoteId,purpose,command.userId);
    const expected=purpose==='wallet_topup'?fiatMinorForCoinMinor((command as CreateTopUpSessionCommand).coinAmountMinor):steamRefillPaymentTerms((command as CreateSteamRefillSessionCommand).amountRub).fiatAmountMinor;
    if(terms.environment!==this.config.arcPay.environment||terms.fiatAmountMinor!==expected||terms.fiatAmountMinor!==command.quoteBinding.acceptedFiatMinor||terms.termsVersion!==(purpose==='wallet_topup'?WALLET_TERMS_VERSION:STEAM_TERMS_VERSION))throw new ConflictException('PAYMENT_TERMS_CHANGED');
    const user=await client.query<{steam_id64:string|null;disabled:boolean}>('SELECT steam_id64,disabled FROM users WHERE id=$1 FOR SHARE',[command.userId]);
    if(!user.rows[0]||user.rows[0].disabled)throw new BadRequestException('USER_UNAVAILABLE');
    if(purpose==='wallet_topup'){
      if(!user.rows[0].steam_id64||terms.coinAmountMinor!==(command as CreateTopUpSessionCommand).coinAmountMinor)throw new BadRequestException('STEAM_IDENTITY_REQUIRED');
    }else{
      if(terms.guestCheckout){const guest=await client.query('SELECT id FROM guest_payment_contexts WHERE user_id=$1 AND expires_at>now()',[command.userId]);if(!guest.rowCount)throw new BadRequestException('GUEST_CONTEXT_REQUIRED');}
      // Serialize guest inserts with email verification to avoid missing concurrent claims.
      if(terms.guestCheckout)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`email:${terms.contactEmail}`]);
      const email=await client.query<{email:string}>('SELECT email FROM email_identities WHERE user_id=$1 AND verified_at IS NOT NULL FOR SHARE',[command.userId]);
      // A legacy email-only owner loses its identity on adoption. Reject an in-flight new payment, while existing idempotent payments remain replayable.
      if(!terms.guestCheckout&&!user.rows[0].steam_id64&&!email.rows[0])throw new ConflictException('PAYMENT_RECIPIENT_CHANGED');
      if((terms.contactEmailSource!=='input'&&(!email.rows[0]||email.rows[0].email!==terms.contactEmail))||!terms.contactEmail||terms.steamLogin!==(command as CreateSteamRefillSessionCommand).steamLogin||!terms.steamCheckTransactionId)throw new ConflictException('PAYMENT_RECIPIENT_CHANGED');
    }
    return terms;
  }

  async createTopUpSession(command: CreateTopUpSessionCommand): Promise<TopUpSessionDto> {
    assertCoinAmountMinor(command.coinAmountMinor);
    const idempotencyKey = requireIdempotencyKey(command.idempotencyKey);
    if (this.config.arcPay.providerMode === "real") {
      return this.createRealTopUpSession({
        ...command,
        idempotencyKey,
      });
    }
    const hash = requestHash(command);
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`payment:${command.userId}`]);
      const existing = await this.findTopUpPayment(client, command.userId, idempotencyKey);
      if (existing !== null) {
        if (existing.request_hash !== hash) throw new ConflictException("Idempotency key is already used for different top-up terms");
        return toDto(existing);
      }

      const bound = await this.requirePaymentQuote(client, command, "wallet_topup");
      const fiatAmountMinor = fiatMinorForCoinMinor(command.coinAmountMinor);
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO top_up_payments (
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
            metadata
          )
          VALUES ($1, $2, $3, $4, 'provider_configuration_required', $5, $6, 'RUB', $7, $8, $9::jsonb)
          RETURNING id
        `,
        [
          command.userId,
          idempotencyKey,
          hash,
          TOP_UP_PROVIDER,
          command.coinAmountMinor,
          fiatAmountMinor,
          COIN_RATE_FIAT_MINOR,
          COIN_RATE_COIN_MINOR,
          JSON.stringify({
            ...(bound?{...bound,quoteId:command.quoteBinding?.quoteId}:{}),
            arcPayConfigured: this.config.arcPay.secretKeyFile !== undefined,
            environment: this.config.arcPay.environment,
          }),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("TOP_UP_PAYMENT_NOT_CREATED");
      if (command.quoteBinding) await this.quotes?.consume(client, command.quoteBinding.quoteId, id);
      if (this.config.arcPay.providerMode === "fake") {
        const providerSessionId = `fake_arc_pay_${id}`;
        const checkoutBaseUrl = this.config.arcPay.fakeCheckoutBaseUrl;
        if (checkoutBaseUrl === undefined) throw new ServiceUnavailableException("payment provider fake checkout URL is not configured");
        const checkoutUrl = `${checkoutBaseUrl}/checkout/${providerSessionId}`;
        await client.query(
          `
            UPDATE top_up_payments
            SET
              status = 'checkout_pending',
              provider_session_id = $2,
              provider_checkout_url = $3,
              provider_status = 'created',
              metadata = metadata || $4::jsonb,
              updated_at = now()
            WHERE id = $1
          `,
          [
            id,
            providerSessionId,
            checkoutUrl,
            JSON.stringify({
              fakeProvider: true,
              environment: this.config.arcPay.environment,
            }),
          ],
        );
        await client.query(
          `
            INSERT INTO payment_provider_attempts (
              top_up_payment_id,
              provider,
              idempotency_key,
              status,
              request_hash,
              request_snapshot,
              response_snapshot,
              finished_at
            )
            VALUES ($1, $2, $3, 'succeeded', $4, $5::jsonb, $6::jsonb, now())
          `,
          [
            id,
            TOP_UP_PROVIDER,
            idempotencyKey,
            hash,
            JSON.stringify({
              amount: fiatAmountMinor,
              coinAmountMinor: command.coinAmountMinor,
              currency: "RUB",
              provider: TOP_UP_PROVIDER,
              rate: {
                fiatMinor: COIN_RATE_FIAT_MINOR,
                coinMinor: COIN_RATE_COIN_MINOR,
              },
            }),
            JSON.stringify({
              checkoutUrl,
              providerSessionId,
              providerStatus: "created",
              fakeProvider: true,
            }),
          ],
        );
      } else {
        await client.query(
          `
            INSERT INTO payment_provider_attempts (
              top_up_payment_id,
              provider,
              idempotency_key,
              status,
              request_hash,
              request_snapshot,
              response_snapshot,
              error_code,
              finished_at
            )
            VALUES ($1, $2, $3, 'configuration_required', $4, $5::jsonb, '{}'::jsonb, 'ARC_PAY_CONFIGURATION_REQUIRED', now())
          `,
          [
            id,
            TOP_UP_PROVIDER,
            idempotencyKey,
            hash,
            JSON.stringify({
              amount: fiatAmountMinor,
              coinAmountMinor: command.coinAmountMinor,
              currency: "RUB",
              provider: TOP_UP_PROVIDER,
              rate: {
                fiatMinor: COIN_RATE_FIAT_MINOR,
                coinMinor: COIN_RATE_COIN_MINOR,
              },
            }),
          ],
        );
      }

      const created = await this.findTopUpPayment(client, command.userId, idempotencyKey);
      if (created === null) throw new Error("TOP_UP_PAYMENT_NOT_FOUND_AFTER_CREATE");
      await this.enqueueVvAdminTopUpEvent(client, {
        eventType: created.status === "checkout_pending" ? "top_up.created" : "top_up.failed",
        topUpPaymentId: created.id,
      });
      return toDto(created);
    });
  }

  async createSteamRefillSession(command: CreateSteamRefillSessionCommand): Promise<SteamRefillSessionDto> {
    assertSteamRefillAmountRub(command.amountRub);
    const idempotencyKey = requireIdempotencyKey(command.idempotencyKey);
    const steamLogin = normalizeSteamLogin(command.steamLogin);
    const normalizedCommand = {
      ...command,
      idempotencyKey,
      steamLogin,
    };
    if (this.config.arcPay.providerMode === "real") {
      return this.createRealSteamRefillSession(normalizedCommand);
    }
    const hash = steamRefillRequestHash(normalizedCommand);
    const paymentTerms = steamRefillPaymentTerms(normalizedCommand.amountRub);
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`payment:${normalizedCommand.userId}`]);
      const existing = await this.findSteamRefillPayment(client, normalizedCommand.userId, idempotencyKey);
      if (existing !== null) {
        if (existing.request_hash !== hash) throw new ConflictException("Idempotency key is already used for different Steam refill terms");
        return steamRefillToDto(existing);
      }

      const bound = await this.requirePaymentQuote(client, normalizedCommand, "steam_refill");
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO steam_refill_payments (
            user_id,
            idempotency_key,
            request_hash,
            provider,
            status,
            amount_rub_minor,
            fee_rub_minor,
            fiat_amount_minor,
            fiat_currency,
            steam_login,
            metadata
          )
          VALUES ($1, $2, $3, $4, 'provider_configuration_required', $5, $6, $7, 'RUB', $8, $9::jsonb)
          RETURNING id
        `,
        [
          normalizedCommand.userId,
          idempotencyKey,
          hash,
          STEAM_REFILL_PROVIDER,
          paymentTerms.amountRubMinor,
          paymentTerms.feeRubMinor,
          paymentTerms.fiatAmountMinor,
          steamLogin,
          JSON.stringify({
            ...(bound?{...bound,quoteId:normalizedCommand.quoteBinding?.quoteId}:{}),
            arcPayConfigured: this.config.arcPay.secretKeyFile !== undefined,
            environment: this.config.arcPay.environment,
            purpose: bound?.purpose ?? "steam_refill_payment",
          }),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("STEAM_REFILL_PAYMENT_NOT_CREATED");
      if (normalizedCommand.quoteBinding) await this.quotes?.consume(client, normalizedCommand.quoteBinding.quoteId, id);
      if (this.config.arcPay.providerMode === "fake") {
        const providerSessionId = `fake_arc_pay_steam_refill_${id}`;
        const checkoutBaseUrl = this.config.arcPay.fakeCheckoutBaseUrl;
        if (checkoutBaseUrl === undefined) throw new ServiceUnavailableException("payment provider fake checkout URL is not configured");
        const checkoutUrl = `${checkoutBaseUrl}/checkout/${providerSessionId}`;
        await client.query(
          `
            UPDATE steam_refill_payments
            SET
              status = 'checkout_pending',
              provider_session_id = $2,
              provider_checkout_url = $3,
              provider_status = 'created',
              metadata = metadata || $4::jsonb,
              updated_at = now()
            WHERE id = $1
          `,
          [
            id,
            providerSessionId,
            checkoutUrl,
            JSON.stringify({
              fakeProvider: true,
              environment: this.config.arcPay.environment,
            }),
          ],
        );
        await client.query(
          `
            INSERT INTO payment_provider_attempts (
              top_up_payment_id,
              steam_refill_payment_id,
              provider,
              idempotency_key,
              status,
              request_hash,
              request_snapshot,
              response_snapshot,
              finished_at
            )
            VALUES (NULL, $1, $2, $3, 'succeeded', $4, $5::jsonb, $6::jsonb, now())
          `,
          [
            id,
            STEAM_REFILL_PROVIDER,
            idempotencyKey,
            hash,
            JSON.stringify({
              amount: paymentTerms.fiatAmountMinor,
              currency: "RUB",
              feeBasisPoints: STEAM_REFILL_FEE_BASIS_POINTS,
              feeRubMinor: paymentTerms.feeRubMinor,
              provider: STEAM_REFILL_PROVIDER,
              purpose: "steam_refill_payment",
              steamAmountRubMinor: paymentTerms.amountRubMinor,
              steamLogin,
            }),
            JSON.stringify({
              checkoutUrl,
              providerSessionId,
              providerStatus: "created",
              fakeProvider: true,
            }),
          ],
        );
      } else {
        await client.query(
          `
            INSERT INTO payment_provider_attempts (
              top_up_payment_id,
              steam_refill_payment_id,
              provider,
              idempotency_key,
              status,
              request_hash,
              request_snapshot,
              response_snapshot,
              error_code,
              finished_at
            )
            VALUES (NULL, $1, $2, $3, 'configuration_required', $4, $5::jsonb, '{}'::jsonb, 'ARC_PAY_CONFIGURATION_REQUIRED', now())
          `,
          [
            id,
            STEAM_REFILL_PROVIDER,
            idempotencyKey,
            hash,
            JSON.stringify({
              amount: paymentTerms.fiatAmountMinor,
              currency: "RUB",
              feeBasisPoints: STEAM_REFILL_FEE_BASIS_POINTS,
              feeRubMinor: paymentTerms.feeRubMinor,
              provider: STEAM_REFILL_PROVIDER,
              purpose: "steam_refill_payment",
              steamAmountRubMinor: paymentTerms.amountRubMinor,
              steamLogin,
            }),
          ],
        );
      }

      const created = await this.findSteamRefillPayment(client, normalizedCommand.userId, idempotencyKey);
      if (created === null) throw new Error("STEAM_REFILL_PAYMENT_NOT_FOUND_AFTER_CREATE");
      return steamRefillToDto(created);
    });
  }

  async expireSyntheticTopUpSession(command: {
    readonly topUpPaymentId: string;
    readonly userId: string;
  }): Promise<void> {
    if (!command.userId.startsWith("synthetic:")) {
      throw new BadRequestException("Only synthetic top-up sessions can be expired through this path");
    }
    const result = await this.database.query(
      `
        UPDATE top_up_payments
        SET
          status = 'failed',
          provider_status = 'synthetic_expired',
          metadata = metadata || $3::jsonb,
          updated_at = now()
        WHERE id = $1
          AND user_id = $2
          AND status = 'checkout_pending'
      `,
      [
        command.topUpPaymentId,
        command.userId,
        JSON.stringify({
          syntheticCleanup: "expired_by_vv_admin_scenario",
        }),
      ],
    );
    if (result.rowCount !== 1) {
      throw new NotFoundException("Synthetic top-up checkout was not found");
    }
    await this.enqueueVvAdminTopUpEvent(this.database, {
      eventType: "top_up.failed",
      topUpPaymentId: command.topUpPaymentId,
    });
  }

  private async steamBuyerDetails(paymentId:string):Promise<{buyerEmail?:string}>{
    const r=await this.database.query<{email:string|null}>("SELECT metadata->>'contactEmail' AS email FROM steam_refill_payments WHERE id=$1",[paymentId]);
    return r.rows[0]?.email?{buyerEmail:r.rows[0].email}:{};
  }
  private async buyerDetails(userId: string): Promise<{ buyerEmail?: string }> {
    const result = await this.database.query<{ email: string }>(
      "SELECT email FROM email_identities WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1", [userId],
    );
    return result.rows[0] ? { buyerEmail: result.rows[0].email } : {};
  }

  private async createRealTopUpSession(command: CreateTopUpSessionCommand): Promise<TopUpSessionDto> {
    const publicOrigin = this.config.arcPay.publicOrigin;
    if (publicOrigin === undefined) throw new ServiceUnavailableException("payment provider public origin is not configured");
    if (this.config.arcPay.secretKeyFile === undefined) throw new ServiceUnavailableException("payment provider secret key is not configured");
    if (this.config.arcPay.webhookSigningSecretFile === undefined) throw new ServiceUnavailableException("payment provider webhook secret is not configured");
    const hash = requestHash(command);
    const {session: initial, ownsCreation} = await this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`payment:${command.userId}`]);
      const existing = await this.findTopUpPayment(client, command.userId, command.idempotencyKey);
      if (existing !== null) {
        if (existing.request_hash !== hash) throw new ConflictException("Idempotency key is already used for different top-up terms");
        return {session:toDto(existing),ownsCreation:false};
      }

      const bound = await this.requirePaymentQuote(client, command, "wallet_topup");
      const fiatAmountMinor = fiatMinorForCoinMinor(command.coinAmountMinor);
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO top_up_payments (
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
            metadata
          )
          VALUES ($1, $2, $3, $4, 'provider_creation_pending', $5, $6, 'RUB', $7, $8, $9::jsonb)
          RETURNING id
        `,
        [
          command.userId,
          command.idempotencyKey,
          hash,
          TOP_UP_PROVIDER,
          command.coinAmountMinor,
          fiatAmountMinor,
          COIN_RATE_FIAT_MINOR,
          COIN_RATE_COIN_MINOR,
          JSON.stringify({
            ...(bound?{...bound,quoteId:command.quoteBinding?.quoteId}:{}),
            arcPayConfigured: true,
            environment: this.config.arcPay.environment,
          }),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("TOP_UP_PAYMENT_NOT_CREATED");
      if (command.quoteBinding) await this.quotes?.consume(client, command.quoteBinding.quoteId, id);
      const providerIdempotencyKey = id;
      await client.query(
        `
          INSERT INTO payment_provider_attempts (
            top_up_payment_id,
            provider,
            idempotency_key,
            status,
            request_hash,
            request_snapshot
          )
          VALUES ($1, $2, $3, 'pending', $4, $5::jsonb)
        `,
        [
          id,
          TOP_UP_PROVIDER,
          providerIdempotencyKey,
          hash,
          JSON.stringify({
            amount: fiatAmountMinor,
            coinAmountMinor: command.coinAmountMinor,
            currency: "RUB",
            provider: TOP_UP_PROVIDER,
            providerPaymentMethod: "sbp",
            rate: {
              fiatMinor: COIN_RATE_FIAT_MINOR,
              coinMinor: COIN_RATE_COIN_MINOR,
            },
          }),
        ],
      );
      const created = await this.findTopUpPayment(client, command.userId, command.idempotencyKey);
      if (created === null) throw new Error("TOP_UP_PAYMENT_NOT_FOUND_AFTER_CREATE");
      return {session:toDto(created),ownsCreation:true};
    });

    if (!ownsCreation || initial.checkoutUrl !== null || initial.status !== "provider_creation_pending") return initial;

    const providerIdempotencyKey = initial.id;
    const urls = topUpReturnUrls(publicOrigin,initial.id);
    let checkout: Awaited<ReturnType<ArcPayClient["createHostedCheckout"]>>;
    try {
      checkout = await this.arcPay.createHostedCheckout({
        ...(await this.buyerDetails(command.userId)),
        amountMinor: initial.fiatAmountMinor,
        cancelUrl: urls.cancelUrl,
        description: "Пополнение баланса Shards",
        externalId: initial.id,
        failUrl: urls.failUrl,
        idempotencyKey: providerIdempotencyKey,
        metadata: {
          shards_top_up_id: initial.id,
          environment:this.config.arcPay.environment, purpose:"wallet_topup",
        },
        successUrl: urls.successUrl,
      });
    } catch (error) {
      const errorCode = providerErrorCode(error);
      const ambiguous = ambiguousCheckoutCreation(errorCode);
      await this.database.transaction(async (client) => {
        const failed = await client.query(
          `
            UPDATE top_up_payments
            SET
              status = CASE WHEN ($2::jsonb->>'providerCreationAmbiguous')::boolean THEN 'manual_review' ELSE 'failed' END,
              provider_status = 'checkout_create_failed',
              metadata = metadata || $2::jsonb,
              updated_at = now()
            WHERE id = $1 AND status = 'provider_creation_pending'
          `,
          [
            initial.id,
            JSON.stringify({
              providerErrorCode: errorCode,
              providerCreationAmbiguous: ambiguous,
            }),
          ],
        );
        if (failed.rowCount && !ambiguous) await this.enqueueVvAdminTopUpEvent(client, {
          eventType: "top_up.failed",
          topUpPaymentId: initial.id,
        });
        await client.query(
          `
            UPDATE payment_provider_attempts
            SET
              status = 'failed',
              response_snapshot = $4::jsonb,
              error_code = $5,
              finished_at = now()
            WHERE provider = $1
              AND idempotency_key = $2
              AND top_up_payment_id = $3
          `,
          [
            TOP_UP_PROVIDER,
            providerIdempotencyKey,
            initial.id,
            JSON.stringify({
              providerStatus: "checkout_create_failed",
            }),
            errorCode,
          ],
        );
      });
      throw new ServiceUnavailableException("payment provider checkout creation failed");
    }

    return this.database.transaction(async (client) => {
      const bound=await client.query<{provider_session_id:string|null}>('SELECT provider_session_id FROM top_up_payments WHERE id=$1 FOR UPDATE',[initial.id]);
      if(bound.rows[0]?.provider_session_id&&bound.rows[0].provider_session_id!==checkout.providerSessionId){
        await client.query("UPDATE top_up_payments SET status='manual_review',metadata=metadata||'{\"providerIdentityMismatch\":true}'::jsonb WHERE id=$1",[initial.id]);
        const current=await this.findTopUpPayment(client,command.userId,command.idempotencyKey);if(!current)throw new Error('PAYMENT_NOT_FOUND');return toDto(current);
      }
      await client.query(
        `
          UPDATE top_up_payments
          SET
            status = CASE WHEN status = 'provider_creation_pending' THEN 'checkout_pending' ELSE status END,
            provider_session_id = $2,
            provider_checkout_url = $3,
            provider_status = CASE WHEN status = 'provider_creation_pending' THEN 'created' ELSE provider_status END,
            updated_at = now()
          WHERE id = $1
        `,
        [initial.id, checkout.providerSessionId, checkout.checkoutUrl],
      );
      await client.query(
        `
          UPDATE payment_provider_attempts
          SET
            status = 'succeeded',
            response_snapshot = $4::jsonb,
            finished_at = now()
          WHERE provider = $1
            AND idempotency_key = $2
            AND top_up_payment_id = $3
        `,
        [
          TOP_UP_PROVIDER,
          providerIdempotencyKey,
          initial.id,
          JSON.stringify({
            checkoutUrl: checkout.checkoutUrl,
            providerSessionId: checkout.providerSessionId,
            providerStatus: "created",
          }),
        ],
      );
      const created = await this.findTopUpPayment(client, command.userId, command.idempotencyKey);
      if (created === null) throw new Error("TOP_UP_PAYMENT_NOT_FOUND_AFTER_PROVIDER_CREATE");
      if (created.status === "checkout_pending") await this.enqueueVvAdminTopUpEvent(client, {
        eventType: "top_up.created",
        topUpPaymentId: created.id,
      });
      return toDto(created);
    });
  }

  private async createRealSteamRefillSession(command: CreateSteamRefillSessionCommand): Promise<SteamRefillSessionDto> {
    const publicOrigin = this.config.arcPay.publicOrigin;
    if (publicOrigin === undefined) throw new ServiceUnavailableException("payment provider public origin is not configured");
    if (this.config.arcPay.secretKeyFile === undefined) throw new ServiceUnavailableException("payment provider secret key is not configured");
    if (this.config.arcPay.webhookSigningSecretFile === undefined) throw new ServiceUnavailableException("payment provider webhook secret is not configured");
    const hash = steamRefillRequestHash(command);
    const paymentTerms = steamRefillPaymentTerms(command.amountRub);
    const {session: initial, ownsCreation} = await this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`payment:${command.userId}`]);
      const existing = await this.findSteamRefillPayment(client, command.userId, command.idempotencyKey);
      if (existing !== null) {
        if (existing.request_hash !== hash) throw new ConflictException("Idempotency key is already used for different Steam refill terms");
        return {session:steamRefillToDto(existing),ownsCreation:false};
      }

      const bound = await this.requirePaymentQuote(client, command, "steam_refill");
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO steam_refill_payments (
            user_id,
            idempotency_key,
            request_hash,
            provider,
            status,
            amount_rub_minor,
            fee_rub_minor,
            fiat_amount_minor,
            fiat_currency,
            steam_login,
            metadata
          )
          VALUES ($1, $2, $3, $4, 'provider_creation_pending', $5, $6, $7, 'RUB', $8, $9::jsonb)
          RETURNING id
        `,
        [
          command.userId,
          command.idempotencyKey,
          hash,
          STEAM_REFILL_PROVIDER,
          paymentTerms.amountRubMinor,
          paymentTerms.feeRubMinor,
          paymentTerms.fiatAmountMinor,
          command.steamLogin,
          JSON.stringify({
            ...(bound?{...bound,quoteId:command.quoteBinding?.quoteId}:{}),
            arcPayConfigured: true,
            environment: this.config.arcPay.environment,
            purpose: bound?.purpose ?? "steam_refill_payment",
          }),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("STEAM_REFILL_PAYMENT_NOT_CREATED");
      if (command.quoteBinding) await this.quotes?.consume(client, command.quoteBinding.quoteId, id);
      await client.query(
        `
          INSERT INTO payment_provider_attempts (
            top_up_payment_id,
            steam_refill_payment_id,
            provider,
            idempotency_key,
            status,
            request_hash,
            request_snapshot
          )
          VALUES (NULL, $1, $2, $3, 'pending', $4, $5::jsonb)
        `,
        [
          id,
          STEAM_REFILL_PROVIDER,
          id,
          hash,
          JSON.stringify({
            amount: paymentTerms.fiatAmountMinor,
            currency: "RUB",
            feeBasisPoints: STEAM_REFILL_FEE_BASIS_POINTS,
            feeRubMinor: paymentTerms.feeRubMinor,
            provider: STEAM_REFILL_PROVIDER,
            providerPaymentMethod: "sbp",
            purpose: "steam_refill_payment",
            steamAmountRubMinor: paymentTerms.amountRubMinor,
            steamLogin: command.steamLogin,
          }),
        ],
      );
      const created = await this.findSteamRefillPayment(client, command.userId, command.idempotencyKey);
      if (created === null) throw new Error("STEAM_REFILL_PAYMENT_NOT_FOUND_AFTER_CREATE");
      return {session:steamRefillToDto(created),ownsCreation:true};
    });

    if (!ownsCreation || initial.checkoutUrl !== null || initial.status !== "provider_creation_pending") return initial;

    const urls = steamRefillReturnUrls(publicOrigin,initial.id);
    let checkout: Awaited<ReturnType<ArcPayClient["createHostedCheckout"]>>;
    try {
      checkout = await this.arcPay.createHostedCheckout({
        ...(await this.steamBuyerDetails(initial.id)),
        amountMinor: initial.fiatAmountMinor,
        cancelUrl: urls.cancelUrl,
        description: `Пополнение Steam на ${initial.amountRubMinor / 100} RUB`,
        externalId: initial.id,
        failUrl: urls.failUrl,
        idempotencyKey: initial.id,
        metadata: {
          shards_steam_refill_payment_id: initial.id,
          environment:this.config.arcPay.environment, purpose:"steam_refill",
        },
        successUrl: urls.successUrl,
      });
    } catch (error) {
      const errorCode = providerErrorCode(error);
      const ambiguous = ambiguousCheckoutCreation(errorCode);
      await this.database.transaction(async (client) => {
        await client.query(
          `
            UPDATE steam_refill_payments
            SET
              status = CASE WHEN ($2::jsonb->>'providerCreationAmbiguous')::boolean THEN 'manual_review' ELSE 'failed' END,
              provider_status = 'checkout_create_failed',
              metadata = metadata || $2::jsonb,
              updated_at = now()
            WHERE id = $1 AND status = 'provider_creation_pending'
          `,
          [
            initial.id,
            JSON.stringify({
              providerErrorCode: errorCode,
              providerCreationAmbiguous: ambiguous,
            }),
          ],
        );
        await client.query(
          `
            UPDATE payment_provider_attempts
            SET
              status = 'failed',
              response_snapshot = $4::jsonb,
              error_code = $5,
              finished_at = now()
            WHERE provider = $1
              AND idempotency_key = $2
              AND steam_refill_payment_id = $3
          `,
          [
            STEAM_REFILL_PROVIDER,
            initial.id,
            initial.id,
            JSON.stringify({
              providerStatus: "checkout_create_failed",
            }),
            errorCode,
          ],
        );
      });
      throw new ServiceUnavailableException("payment provider checkout creation failed");
    }

    return this.database.transaction(async (client) => {
      const bound=await client.query<{provider_session_id:string|null}>('SELECT provider_session_id FROM steam_refill_payments WHERE id=$1 FOR UPDATE',[initial.id]);
      if(bound.rows[0]?.provider_session_id&&bound.rows[0].provider_session_id!==checkout.providerSessionId){
        await client.query("UPDATE steam_refill_payments SET status='manual_review',metadata=metadata||'{\"providerIdentityMismatch\":true}'::jsonb WHERE id=$1",[initial.id]);
        const current=await this.findSteamRefillPayment(client,command.userId,command.idempotencyKey);if(!current)throw new Error('PAYMENT_NOT_FOUND');return steamRefillToDto(current);
      }
      await client.query(
        `
          UPDATE steam_refill_payments
          SET
            status = CASE WHEN status = 'provider_creation_pending' THEN 'checkout_pending' ELSE status END,
            provider_session_id = $2,
            provider_checkout_url = $3,
            provider_status = CASE WHEN status = 'provider_creation_pending' THEN 'created' ELSE provider_status END,
            updated_at = now()
          WHERE id = $1
        `,
        [initial.id, checkout.providerSessionId, checkout.checkoutUrl],
      );
      await client.query(
        `
          UPDATE payment_provider_attempts
          SET
            status = 'succeeded',
            response_snapshot = $4::jsonb,
            finished_at = now()
          WHERE provider = $1
            AND idempotency_key = $2
            AND steam_refill_payment_id = $3
        `,
        [
          STEAM_REFILL_PROVIDER,
          initial.id,
          initial.id,
          JSON.stringify({
            checkoutUrl: checkout.checkoutUrl,
            providerSessionId: checkout.providerSessionId,
            providerStatus: "created",
          }),
        ],
      );
      const created = await this.findSteamRefillPayment(client, command.userId, command.idempotencyKey);
      if (created === null) throw new Error("STEAM_REFILL_PAYMENT_NOT_FOUND_AFTER_PROVIDER_CREATE");
      return steamRefillToDto(created);
    });
  }

  async handleArcPayWebhook(command: HandleArcPayWebhookCommand): Promise<PaymentWebhookResultDto> {
    if (this.config.arcPay.providerMode === "disabled") {
      throw new ServiceUnavailableException("payment provider webhook verification is not configured");
    }
    const signingSecretFile = this.config.arcPay.webhookSigningSecretFile;
    if (signingSecretFile === undefined) {
      throw new ServiceUnavailableException("payment provider webhook signing secret is not configured");
    }
    const signingSecret = (await readFile(signingSecretFile, "utf8")).trim();
    if (this.config.arcPay.providerMode === "fake") {
      if (!verifyFakeArcPayWebhookSignature(command.payload, command.signature, signingSecret)) {
        throw new UnauthorizedException("payment provider webhook signature is invalid");
      }
    } else {
      if (!verifyArcPayWebhookSignature({
        secret: signingSecret,
        ...(command.providerEventId === undefined ? {} : { eventId: command.providerEventId }),
        ...(command.rawBody === undefined ? {} : { rawBody: command.rawBody }),
        ...(command.signature === undefined ? {} : { signature: command.signature }),
        ...(command.timestamp === undefined ? {} : { timestamp: command.timestamp }),
      })) {
        throw new UnauthorizedException("payment provider webhook signature is invalid");
      }
    }

    let payload = command.payload;
    if (this.config.arcPay.providerMode === "real") {
      if (!command.rawBody) throw new BadRequestException("Payment notification body is required");
      payload = JSON.parse(command.rawBody.toString("utf8")) as unknown;
    }
    const event = await this.enrichArcPayWebhook(normalizeArcPayWebhook(command.providerEventId, payload));
    return this.processVerifiedArcPayWebhook(event);
  }

  async reconcilePendingTopUps(command: { limit?: number } = {}): Promise<PaymentReconciliationResultDto> {
    if (this.config.arcPay.providerMode !== "real") {
      throw new ServiceUnavailableException("payment provider reconciliation requires real provider mode");
    }
    const limit = command.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("Reconciliation limit must be between 1 and 100");
    // One fair budget across both products; oldest unobserved attempt is checked first.
    const candidates=await this.database.query<{id:string;kind:string}>(`SELECT p.id,p.kind FROM (SELECT id,'top_up' AS kind,created_at,status,metadata FROM top_up_payments UNION ALL SELECT id,'steam_refill' AS kind,created_at,status,metadata FROM steam_refill_payments) p WHERE p.status IN ('checkout_pending','provider_creation_pending') OR (p.status='manual_review' AND p.metadata->>'providerCreationAmbiguous'='true') ORDER BY coalesce((SELECT max(a.created_at) FROM payment_provider_attempts a WHERE a.top_up_payment_id=p.id OR a.steam_refill_payment_id=p.id),p.created_at),p.id LIMIT $1`,[limit]);
    const topUpIds=candidates.rows.filter(row=>row.kind==='top_up').map(row=>row.id),steamIds=candidates.rows.filter(row=>row.kind==='steam_refill').map(row=>row.id);
    const pendingTopUps = await this.database.query<TopUpPaymentReconciliationRow>(
      `
        SELECT
          id,
          user_id,
          status,
          coin_amount_minor,
          fiat_amount_minor,
          fiat_currency,
          request_hash
        FROM top_up_payments
        WHERE provider = $1 AND id=ANY($3::uuid[])
          AND (status IN ('checkout_pending', 'provider_creation_pending') OR (status = 'manual_review' AND metadata->>'providerCreationAmbiguous' = 'true'))
        ORDER BY created_at ASC, id ASC
        LIMIT $2
      `,
      [TOP_UP_PROVIDER, limit, topUpIds],
    );
    const remainingLimit = steamIds.length;
    const pendingSteamRefills = remainingLimit > 0
      ? await this.database.query<SteamRefillPaymentReconciliationRow>(
        `
          SELECT
            id,
            user_id,
            status,
            amount_rub_minor,
            fee_rub_minor,
            fiat_amount_minor,
            fiat_currency,
            steam_login,
            order_id::text AS order_id,
            request_hash
          FROM steam_refill_payments
          WHERE provider = $1 AND id=ANY($3::uuid[])
            AND (status IN ('checkout_pending', 'provider_creation_pending') OR (status = 'manual_review' AND metadata->>'providerCreationAmbiguous' = 'true'))
          ORDER BY created_at ASC, id ASC
          LIMIT $2
        `,
        [STEAM_REFILL_PROVIDER, remainingLimit, steamIds],
      )
      : { rows: [] };
    const result: PaymentReconciliationResultDto = {
      checked: pendingTopUps.rows.length + pendingSteamRefills.rows.length,
      credited: 0,
      errors: 0,
      failed: 0,
      ignored: 0,
      manualReview: 0,
      steamRefillsCreated: 0,
      unmatched: 0,
    };

    for (const topUpPayment of pendingTopUps.rows) {
      const attemptKey = `reconcile:${topUpPayment.id}:${randomUUID()}`;
      await this.beginReconciliationAttempt({ id: topUpPayment.id, kind: "top_up", request_hash: topUpPayment.request_hash }, attemptKey);
      let providerPayments: Awaited<ReturnType<ArcPayClient["listPayments"]>>;
      try {
        providerPayments = await this.arcPay.listPayments({
          pageSize: 5,
          search: topUpPayment.id,
        });
      } catch (error) {
        result.errors += 1;
        await this.finishReconciliationAttempt({ id: topUpPayment.id, kind: "top_up" }, attemptKey, "failed", {
          providerErrorCode: providerErrorCode(error),
        }, providerErrorCode(error));
        continue;
      }

      const candidates = providerPayments.payments.filter(payment => payment.externalId === topUpPayment.id);
      let matched = candidates.length === 1 && !providerPayments.nextCursor && providerPayments.total <= providerPayments.payments.length ? candidates[0] : undefined;
      if (matched) {
        try {
          matched = await this.arcPay.getPayment(matched.id);
          if (matched.externalId !== topUpPayment.id) throw new Error("ARC_PAY_PAYMENT_MISMATCH");
        } catch (error) {
          result.errors += 1;
          await this.finishReconciliationAttempt({id:topUpPayment.id,kind:"top_up"},attemptKey,"failed",{providerErrorCode:providerErrorCode(error)},providerErrorCode(error));
          continue;
        }
      }
      if (matched === undefined) {
        result.unmatched += 1;
        await this.finishReconciliationAttempt({ id: topUpPayment.id, kind: "top_up" }, attemptKey, "succeeded", {
          matched: false,
          pageSize: providerPayments.pageSize,
          providerPaymentCount: providerPayments.payments.length,
          total: providerPayments.total,
        });
        continue;
      }

      await this.finishReconciliationAttempt({ id: topUpPayment.id, kind: "top_up" }, attemptKey, "succeeded", {
        amount: matched.amount,
        currency: matched.currency,
        matched: true,
        providerPaymentId: matched.id,
        providerStatus: matched.status,
      });
      const applied = await this.applyArcPayProviderPaymentStatus({
        amountMinor: matched.amount,
        currency: matched.currency,
        providerPaymentId: matched.id,
        metadata:matched.metadata,
        providerStatus: matched.status,
        topUpPaymentId: topUpPayment.id,
      });
      if (applied === "credited") result.credited += 1;
      if (applied === "failed") result.failed += 1;
      if (applied === "ignored") result.ignored += 1;
      if (applied === "manual_review") result.manualReview += 1;
      if (applied === "rejected") result.errors += 1;
    }

    for (const steamRefillPayment of pendingSteamRefills.rows) {
      const attemptKey = `reconcile:${steamRefillPayment.id}:${randomUUID()}`;
      await this.beginReconciliationAttempt({
        id: steamRefillPayment.id,
        kind: "steam_refill",
        request_hash: steamRefillPayment.request_hash,
      }, attemptKey);
      let providerPayments: Awaited<ReturnType<ArcPayClient["listPayments"]>>;
      try {
        providerPayments = await this.arcPay.listPayments({
          pageSize: 5,
          search: steamRefillPayment.id,
        });
      } catch (error) {
        result.errors += 1;
        await this.finishReconciliationAttempt({ id: steamRefillPayment.id, kind: "steam_refill" }, attemptKey, "failed", {
          providerErrorCode: providerErrorCode(error),
        }, providerErrorCode(error));
        continue;
      }

      const candidates = providerPayments.payments.filter(payment => payment.externalId === steamRefillPayment.id);
      let matched = candidates.length === 1 && !providerPayments.nextCursor && providerPayments.total <= providerPayments.payments.length ? candidates[0] : undefined;
      if (matched) {
        try {
          matched = await this.arcPay.getPayment(matched.id);
          if (matched.externalId !== steamRefillPayment.id) throw new Error("ARC_PAY_PAYMENT_MISMATCH");
        } catch (error) {
          result.errors += 1;
          await this.finishReconciliationAttempt({id:steamRefillPayment.id,kind:"steam_refill"},attemptKey,"failed",{providerErrorCode:providerErrorCode(error)},providerErrorCode(error));
          continue;
        }
      }
      if (matched === undefined) {
        result.unmatched += 1;
        await this.finishReconciliationAttempt({ id: steamRefillPayment.id, kind: "steam_refill" }, attemptKey, "succeeded", {
          matched: false,
          pageSize: providerPayments.pageSize,
          providerPaymentCount: providerPayments.payments.length,
          total: providerPayments.total,
        });
        continue;
      }

      await this.finishReconciliationAttempt({ id: steamRefillPayment.id, kind: "steam_refill" }, attemptKey, "succeeded", {
        amount: matched.amount,
        currency: matched.currency,
        matched: true,
        providerPaymentId: matched.id,
        providerStatus: matched.status,
      });
      const applied = await this.applySteamRefillProviderPaymentStatus({
        amountMinor: matched.amount,
        currency: matched.currency,
        providerPaymentId: matched.id,
        metadata:matched.metadata,
        providerStatus: matched.status,
        steamRefillPaymentId: steamRefillPayment.id,
      });
      if (applied === "paid") result.steamRefillsCreated += 1;
      if (applied === "failed") result.failed += 1;
      if (applied === "ignored") result.ignored += 1;
      if (applied === "manual_review") result.manualReview += 1;
      if (applied === "rejected") result.errors += 1;
    }

    return result;
  }

  private async enrichArcPayWebhook(event: ParsedArcPayWebhook): Promise<NormalizedArcPayWebhook> {
    if (this.config.arcPay.providerMode !== "real") {
      if (event.amountMinor === undefined || event.currency === undefined) {
        throw new BadRequestException("payment provider webhook payload is missing required payment fields");
      }
      return { ...event, amountMinor: event.amountMinor, currency: event.currency };
    }
    if (event.providerPaymentId === null) throw new BadRequestException("Payment id is required");
    const payment = await this.arcPay.getPayment(event.providerPaymentId);
    const externalId = payment.externalId;
    if (payment.id !== event.providerPaymentId || !externalId ||
        (event.topUpPaymentId !== null && event.topUpPaymentId !== externalId) ||
        (event.amountMinor !== undefined && event.amountMinor !== payment.amount) ||
        (event.currency !== undefined && event.currency !== payment.currency)) {
      throw new BadRequestException("Payment notification does not match provider payment");
    }
    const claimsCapture = event.eventType === "payment.captured" || event.providerStatus === "captured" || event.providerStatus === "settled";
    if (claimsCapture && !isCapturedProviderStatus(payment.status) && !isManualReviewProviderStatus(payment.status)) {
      throw new ServiceUnavailableException("Payment status confirmation is pending");
    }
    const incoming=optionalRecordField(event.payloadSnapshot,"metadata");
    for(const field of ["environment","purpose"]){if(incoming[field]!==undefined&&payment.metadata[field]!==undefined&&incoming[field]!==payment.metadata[field])throw new BadRequestException("Payment metadata mismatch");}
    return { ...event, payloadSnapshot:{...event.payloadSnapshot,metadata:{...incoming,...payment.metadata}}, topUpPaymentId: externalId, providerStatus: payment.status,
      amountMinor: payment.amount, currency: payment.currency, eventType: `payment.${payment.status}` };
  }

  private async bindWebhook(client:Queryable,table:'top_up_payments'|'steam_refill_payments',id:string,event:NormalizedArcPayWebhook,purpose:PaymentPurpose):Promise<boolean>{
    const result=await client.query<{provider_session_id:string|null;provider_payment_id:string|null;metadata:Record<string,unknown>}>(`SELECT provider_session_id,provider_payment_id,metadata FROM ${table} WHERE id=$1 FOR UPDATE`,[id]);
    const row=result.rows[0];if(!row)return false;
    const root=event.payloadSnapshot;
    const metadata={...optionalRecordField(root,'metadata'),...optionalRecordField(optionalRecordField(root,'payment'),'metadata'),...optionalRecordField(optionalRecordField(root,'data'),'metadata')};
    const claimedPurpose=metadata.purpose==='steam_refill_payment'?'steam_refill':metadata.purpose;
    const storedPurpose=row.metadata.purpose==='steam_refill_payment'?'steam_refill':row.metadata.purpose;
    const explicitSession=optionalStringField(root,'checkoutSessionId','checkout_session_id')??optionalStringField(optionalRecordField(root,'payment'),'checkoutSessionId','checkout_session_id','checkout_session');
    if((event.providerPaymentId!==null?row.provider_payment_id!==null&&row.provider_payment_id!==event.providerPaymentId:row.provider_session_id!==null&&row.provider_session_id!==event.providerSessionId)||(explicitSession!==undefined&&row.provider_session_id!==null&&explicitSession!==row.provider_session_id)||(event.topUpPaymentId!==null&&event.topUpPaymentId!==id)||row.metadata.environment!==this.config.arcPay.environment||(metadata.environment!==undefined&&metadata.environment!==row.metadata.environment)||(claimedPurpose!==undefined&&claimedPurpose!==purpose)||(storedPurpose!==undefined&&storedPurpose!==purpose))return false;
    if(event.providerPaymentId!==null)await client.query(`UPDATE ${table} SET provider_payment_id=$2 WHERE id=$1 AND provider_payment_id IS NULL`,[id,event.providerPaymentId]);
    else await client.query(`UPDATE ${table} SET provider_session_id=$2 WHERE id=$1 AND provider_session_id IS NULL`,[id,event.providerSessionId]);
    return true;
  }

  private async processVerifiedArcPayWebhook(event: NormalizedArcPayWebhook): Promise<PaymentWebhookResultDto> {
    return this.database.transaction(async (client) => {
      const insertedEvent = await client.query<{ id: string }>(
        `
          INSERT INTO payment_webhook_events (
            provider,
            provider_event_id,
            status,
            signature_status,
            payload_snapshot
          )
          VALUES ($1, $2, 'received', 'verified', $3::jsonb)
          ON CONFLICT (provider, provider_event_id) DO NOTHING
          RETURNING id
        `,
        [TOP_UP_PROVIDER, event.providerEventId, JSON.stringify(event.payloadSnapshot)],
      );
      const webhookEventId = insertedEvent.rows[0]?.id;
      if (webhookEventId === undefined) return { status: "duplicate" };

      const payment = await client.query<TopUpPaymentWebhookRow>(
        `
          SELECT
            id,
            user_id,
            status,
            coin_amount_minor,
            fiat_amount_minor,
            fiat_currency
          FROM top_up_payments
          WHERE provider = $1
            AND (
              (provider_session_id = $2 AND ($3::text IS NULL OR id::text = $3))
              OR id::text = $3
            )
          LIMIT 1
          FOR UPDATE
        `,
        [TOP_UP_PROVIDER, event.providerSessionId, event.topUpPaymentId],
      );
      const topUpPayment = payment.rows[0];
      if (topUpPayment === undefined) {
        const steamRefillPayment = await this.findSteamRefillPaymentForProviderWebhook(client, event);
        if (steamRefillPayment === null) {
          await this.markWebhookEvent(client, event.providerEventId, "unmatched");
          return { status: "unmatched" };
        }

        if (steamRefillPayment.fiat_amount_minor !== event.amountMinor || steamRefillPayment.fiat_currency !== event.currency) {
          await this.markWebhookEvent(client, event.providerEventId, "rejected_amount_mismatch");
          return { status: "rejected" };
        }
        if(!await this.bindWebhook(client,'steam_refill_payments',steamRefillPayment.id,event,'steam_refill')){await this.markWebhookEvent(client,event.providerEventId,'rejected_identity_mismatch');return {status:'rejected'};}

        if (isCapturedWebhook(event) || isFailedWebhook(event) || isManualReviewWebhook(event)) {
          await this.applySteamRefillProviderPaymentStatusWithClient(client, steamRefillPayment, event.providerStatus);
          await this.markWebhookEvent(client, event.providerEventId, "processed");
          return { status: "processed" };
        }

        await this.markWebhookEvent(client, event.providerEventId, "ignored");
        return { status: "ignored" };
      }

      if (topUpPayment.fiat_amount_minor !== event.amountMinor || topUpPayment.fiat_currency !== event.currency) {
        await this.markWebhookEvent(client, event.providerEventId, "rejected_amount_mismatch");
        return { status: "rejected" };
      }
      if(!await this.bindWebhook(client,'top_up_payments',topUpPayment.id,event,'wallet_topup')){await this.markWebhookEvent(client,event.providerEventId,'rejected_identity_mismatch');return {status:'rejected'};}

      if (isCapturedWebhook(event)) {
        await this.applyArcPayProviderPaymentStatusWithClient(client, topUpPayment, event.providerStatus);
        await this.markWebhookEvent(client, event.providerEventId, "processed");
        return { status: "processed" };
      }

      if (isFailedWebhook(event)) {
        await this.applyArcPayProviderPaymentStatusWithClient(client, topUpPayment, event.providerStatus);
        await this.markWebhookEvent(client, event.providerEventId, "processed");
        return { status: "processed" };
      }

      if (isManualReviewWebhook(event)) {
        await this.applyArcPayProviderPaymentStatusWithClient(client, topUpPayment, event.providerStatus);
        await this.markWebhookEvent(client, event.providerEventId, "processed");
        return { status: "processed" };
      }

      await this.markWebhookEvent(client, event.providerEventId, "ignored");
      return { status: "ignored" };
    });
  }

  private async applyArcPayProviderPaymentStatus(command: {
    amountMinor: number;
    currency: string;
    providerPaymentId: string;
    metadata?: Record<string,string>;
    providerStatus: string;
    topUpPaymentId: string;
  }): Promise<"credited" | "failed" | "ignored" | "manual_review" | "rejected"> {
    return this.database.transaction(async (client) => {
      const payment = await client.query<TopUpPaymentWebhookRow>(
        `
          SELECT
            id,
            user_id,
            status,
            coin_amount_minor,
            fiat_amount_minor,
            fiat_currency
          FROM top_up_payments
          WHERE provider = $1
            AND id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [TOP_UP_PROVIDER, command.topUpPaymentId],
      );
      const topUpPayment = payment.rows[0];
      if (topUpPayment === undefined) return "ignored";
      if (topUpPayment.fiat_amount_minor !== command.amountMinor || topUpPayment.fiat_currency !== command.currency) {
        await client.query(
          `
            UPDATE top_up_payments
            SET
              provider_status = $2,
              metadata = metadata || $3::jsonb,
              updated_at = now()
            WHERE id = $1
          `,
          [
            topUpPayment.id,
            command.providerStatus,
            JSON.stringify({
              reconciliationError: "amount_or_currency_mismatch",
              reconciliationProviderPaymentId: command.providerPaymentId,
            }),
          ],
        );
        return "rejected";
      }
      if(!await this.bindWebhook(client,'top_up_payments',topUpPayment.id,{providerEventId:'reconciliation',eventType:`payment.${command.providerStatus}`,providerPaymentId:command.providerPaymentId,providerSessionId:command.providerPaymentId,topUpPaymentId:topUpPayment.id,providerStatus:command.providerStatus,amountMinor:command.amountMinor,currency:command.currency,payloadSnapshot:{metadata:command.metadata??{}}},'wallet_topup'))return 'rejected';
      return this.applyArcPayProviderPaymentStatusWithClient(client, topUpPayment, command.providerStatus);
    });
  }

  private async applyArcPayProviderPaymentStatusWithClient(
    client: Queryable,
    topUpPayment: TopUpPaymentWebhookRow,
    providerStatus: string,
  ): Promise<"credited" | "failed" | "ignored" | "manual_review"> {
    if (isCapturedProviderStatus(providerStatus)) {
      if (topUpPayment.status !== "paid") {
        await this.wallet.creditUserWithClient(client, {
          userId: topUpPayment.user_id,
          amountCoinMinor: topUpPayment.coin_amount_minor,
          idempotencyKey: `top-up:${topUpPayment.id}`,
          reason: "arc_pay_top_up_capture",
        });
        await client.query(
          `
            UPDATE top_up_payments
            SET status = 'paid', provider_status = $2, updated_at = now()
            WHERE id = $1
          `,
          [topUpPayment.id, providerStatus],
        );
        await this.enqueueVvAdminTopUpEvent(client, {
          eventType: "top_up.completed",
          topUpPaymentId: topUpPayment.id,
        });
        return "credited";
      }
      await client.query(
        `
          UPDATE top_up_payments
          SET provider_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [topUpPayment.id, providerStatus],
      );
      return "ignored";
    }

    if (isFailedProviderStatus(providerStatus)) {
      if (topUpPayment.status !== "paid") {
        await client.query(
          `
            UPDATE top_up_payments
            SET status = 'failed', provider_status = $2, updated_at = now()
            WHERE id = $1
          `,
          [topUpPayment.id, providerStatus],
        );
        await this.enqueueVvAdminTopUpEvent(client, {
          eventType: "top_up.failed",
          topUpPaymentId: topUpPayment.id,
        });
        return "failed";
      }
      await client.query(
        `
          UPDATE top_up_payments
          SET provider_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [topUpPayment.id, providerStatus],
      );
    }

    if (isManualReviewProviderStatus(providerStatus)) {
      if (topUpPayment.status === "paid" || topUpPayment.status === "manual_review") {
        await client.query(
          `
            UPDATE top_up_payments
            SET
              status = 'manual_review',
              provider_status = $2,
              metadata = metadata || $3::jsonb,
              updated_at = now()
            WHERE id = $1
          `,
          [
            topUpPayment.id,
            providerStatus,
            JSON.stringify({
              manualReviewReason: manualReviewReason(providerStatus),
            }),
          ],
        );
        return "manual_review";
      }
      await client.query(
        `
          UPDATE top_up_payments
          SET status = 'failed', provider_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [topUpPayment.id, providerStatus],
      );
      await this.enqueueVvAdminTopUpEvent(client, {
        eventType: "top_up.failed",
        topUpPaymentId: topUpPayment.id,
      });
      return "failed";
    }
    return "ignored";
  }

  private async applySteamRefillProviderPaymentStatus(command: {
    amountMinor: number;
    currency: string;
    providerPaymentId: string;
    metadata?: Record<string,string>;
    providerStatus: string;
    steamRefillPaymentId: string;
  }): Promise<"failed" | "ignored" | "manual_review" | "paid" | "rejected"> {
    return this.database.transaction(async (client) => {
      const payment = await client.query<SteamRefillPaymentWebhookRow>(
        `
          SELECT
            id,
            user_id,
            status,
            amount_rub_minor,
            fee_rub_minor,
            fiat_amount_minor,
            fiat_currency,
            steam_login,
            order_id::text AS order_id
          FROM steam_refill_payments
          WHERE provider = $1
            AND id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [STEAM_REFILL_PROVIDER, command.steamRefillPaymentId],
      );
      const steamRefillPayment = payment.rows[0];
      if (steamRefillPayment === undefined) return "ignored";
      if (steamRefillPayment.fiat_amount_minor !== command.amountMinor || steamRefillPayment.fiat_currency !== command.currency) {
        await client.query(
          `
            UPDATE steam_refill_payments
            SET
              provider_status = $2,
              metadata = metadata || $3::jsonb,
              updated_at = now()
            WHERE id = $1
          `,
          [
            steamRefillPayment.id,
            command.providerStatus,
            JSON.stringify({
              reconciliationError: "amount_or_currency_mismatch",
              reconciliationProviderPaymentId: command.providerPaymentId,
            }),
          ],
        );
        return "rejected";
      }
      if(!await this.bindWebhook(client,'steam_refill_payments',steamRefillPayment.id,{providerEventId:'reconciliation',eventType:`payment.${command.providerStatus}`,providerPaymentId:command.providerPaymentId,providerSessionId:command.providerPaymentId,topUpPaymentId:steamRefillPayment.id,providerStatus:command.providerStatus,amountMinor:command.amountMinor,currency:command.currency,payloadSnapshot:{metadata:command.metadata??{}}},'steam_refill'))return 'rejected';
      return this.applySteamRefillProviderPaymentStatusWithClient(client, steamRefillPayment, command.providerStatus);
    });
  }

  private async findSteamRefillPaymentForProviderWebhook(
    client: Queryable,
    event: NormalizedArcPayWebhook,
  ): Promise<SteamRefillPaymentWebhookRow | null> {
    const payment = await client.query<SteamRefillPaymentWebhookRow>(
      `
        SELECT
          id,
          user_id,
          status,
          amount_rub_minor,
          fee_rub_minor,
          fiat_amount_minor,
          fiat_currency,
          steam_login,
          order_id::text AS order_id
        FROM steam_refill_payments
        WHERE provider = $1
          AND (
            (provider_session_id = $2 AND ($3::text IS NULL OR id::text = $3))
            OR id::text = $3
          )
        LIMIT 1
        FOR UPDATE
      `,
      [STEAM_REFILL_PROVIDER, event.providerSessionId, event.topUpPaymentId],
    );
    return payment.rows[0] ?? null;
  }

  private async applySteamRefillProviderPaymentStatusWithClient(
    client: Queryable,
    payment: SteamRefillPaymentWebhookRow,
    providerStatus: string,
  ): Promise<"failed" | "ignored" | "manual_review" | "paid"> {
    if (isCapturedProviderStatus(providerStatus)) {
      if (payment.status !== "paid" || payment.order_id === null) {
        const orderId = await this.createSteamRefillOrderForPayment(client, payment);
        await client.query(
          `
            UPDATE steam_refill_payments
            SET status = 'paid',
                provider_status = $2,
                order_id = $3,
                updated_at = now()
            WHERE id = $1
          `,
          [payment.id, providerStatus, orderId],
        );
        return "paid";
      }
      await client.query(
        `
          UPDATE steam_refill_payments
          SET provider_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [payment.id, providerStatus],
      );
      return "ignored";
    }

    if (isFailedProviderStatus(providerStatus)) {
      if (payment.status !== "paid") {
        await client.query(
          `
            UPDATE steam_refill_payments
            SET status = 'failed', provider_status = $2, updated_at = now()
            WHERE id = $1
          `,
          [payment.id, providerStatus],
        );
        return "failed";
      }
      await client.query(
        `
          UPDATE steam_refill_payments
          SET provider_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [payment.id, providerStatus],
      );
      return "ignored";
    }

    if (isManualReviewProviderStatus(providerStatus)) {
      if (payment.status === "paid" || payment.status === "manual_review") {
        await client.query(
          `
            UPDATE steam_refill_payments
            SET status = 'manual_review',
                provider_status = $2,
                metadata = metadata || $3::jsonb,
                updated_at = now()
            WHERE id = $1
          `,
          [
            payment.id,
            providerStatus,
            JSON.stringify({
              manualReviewReason: manualReviewReason(providerStatus),
            }),
          ],
        );
        return "manual_review";
      }
      await client.query(
        `
          UPDATE steam_refill_payments
          SET status = 'failed', provider_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [payment.id, providerStatus],
      );
      return "failed";
    }

    return "ignored";
  }

  private async createSteamRefillOrderForPayment(
    client: Queryable,
    payment: SteamRefillPaymentWebhookRow,
  ): Promise<string> {
    if (payment.order_id !== null) return payment.order_id;
    if (payment.amount_rub_minor % 100 !== 0) throw new Error("STEAM_REFILL_PAYMENT_AMOUNT_INVALID");
    const amountRub = payment.amount_rub_minor / 100;
    if (!Number.isSafeInteger(amountRub)) throw new Error("STEAM_REFILL_PAYMENT_AMOUNT_INVALID");

    const recipientSnapshot: CheckoutRecipientSnapshot = {
      kind: "steam-refill",
      steamLogin: payment.steam_login,
    };
    const productSlug = `steam-top-up-${amountRub}-rub`;
    const title = `Пополнение Steam на ${amountRub} RUB`;
    const orderHash = createHash("sha256").update(JSON.stringify({
      amountRubMinor: payment.amount_rub_minor,
      paymentId: payment.id,
      steamLogin: payment.steam_login,
      userId: payment.user_id,
    }), "utf8").digest("hex");

    const order = await client.query<{ id: string }>(
      `
        INSERT INTO orders (
          user_id,
          idempotency_key,
          request_hash,
          status,
          total_coin_minor,
          recipient_snapshots
        )
        VALUES ($1, $2, $3, 'held', 0, $4::jsonb)
        ON CONFLICT (user_id, idempotency_key)
        DO UPDATE SET updated_at = orders.updated_at
        RETURNING id
      `,
      [
        payment.user_id,
        `steam-refill-payment:${payment.id}`,
        orderHash,
        JSON.stringify([recipientSnapshot]),
      ],
    );
    const orderId = order.rows[0]?.id;
    if (orderId === undefined) throw new Error("STEAM_REFILL_ORDER_NOT_CREATED");

    const line = await client.query<{ id: string }>(
      `
        INSERT INTO order_lines (
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
        VALUES ($1, 0, $2, $3, 'steam', $4, 0, 1, $5::jsonb, 'held')
        ON CONFLICT (order_id, line_index)
        DO UPDATE SET created_at = order_lines.created_at
        RETURNING id
      `,
      [
        orderId,
        `steam-top-up-${amountRub}`,
        productSlug,
        title,
        JSON.stringify(recipientSnapshot),
      ],
    );
    const lineId = line.rows[0]?.id;
    if (lineId === undefined) throw new Error("STEAM_REFILL_ORDER_LINE_NOT_CREATED");

    const fulfillmentLine: FulfillmentOrderLineInput = {
      id: lineId,
      kind: "steam",
      productSlug,
      recipientSnapshot,
      title,
      unitPriceCoinMinor: 0,
    };
    await this.fulfillment.enqueueOrderLineCommands(client, {
      orderId,
      lines: [fulfillmentLine],
    });
    await client.query(`UPDATE fulfillment_commands c SET payload_snapshot=c.payload_snapshot||jsonb_build_object('steamCheckTransactionId',p.metadata->>'steamCheckTransactionId','paymentId',p.id,'amountRub',$3::integer,'steamLogin',p.steam_login) FROM steam_refill_payments p WHERE c.order_line_id=$1 AND p.id=$2`,[lineId,payment.id,amountRub]);
    return orderId;
  }

  private async enqueueVvAdminTopUpEvent(
    client: Queryable,
    input: {
      eventType: VvAdminTopUpEventType;
      topUpPaymentId: string;
    },
  ): Promise<void> {
    const result = await client.query<
      TopUpPaymentWebhookRow & {
        created_at: Date;
        provider_session_id: string | null;
        updated_at: Date;
      }
    >(
      `
        SELECT
          id,
          user_id,
          status,
          coin_amount_minor,
          fiat_amount_minor,
          fiat_currency,
          provider_session_id,
          created_at,
          updated_at
        FROM top_up_payments
        WHERE id = $1
        LIMIT 1
      `,
      [input.topUpPaymentId],
    );
    const topUp = result.rows[0];
    if (topUp === undefined) throw new Error("VV_ADMIN_TOP_UP_NOT_FOUND");
    const eventId = `shards.top_up.${topUp.id}.${input.eventType.split(".")[1]}`;
    const payload = {
      schemaVersion: 2,
      eventId,
      eventType: input.eventType,
      source: "customer",
      occurredAt: topUp.updated_at.toISOString(),
      site: { domain: new URL(this.config.integration.publicOrigin).hostname },
      subject: { type: "top_up", externalId: topUp.id },
      data: {
        externalTopUpId: topUp.id,
        externalUserId: topUp.user_id,
        status: topUpStatusForVvAdmin(input.eventType),
        paymentProvider: "arc_pay",
        providerOrderId: topUp.provider_session_id,
        paymentMethod: {
          type: "sbp",
          displayName: "СБП",
          provider: "ArcPay",
        },
        paidAmount: (topUp.fiat_amount_minor / 100).toFixed(2),
        paidCurrency: topUp.fiat_currency,
        creditedAmount: (topUp.coin_amount_minor / 100).toFixed(2),
        creditedCurrency: "SHARDS",
        createdAtExternal: topUp.created_at.toISOString(),
        updatedAtExternal: topUp.updated_at.toISOString(),
      },
    };
    await client.query(
      `
        INSERT INTO vv_admin_integration_outbox (
          event_id, event_type, subject_type, subject_external_id, payload
        )
        VALUES ($1, $2, 'top_up', $3, $4::jsonb)
        ON CONFLICT (event_id) DO UPDATE SET updated_at = vv_admin_integration_outbox.updated_at
      `,
      [eventId, input.eventType, topUp.id, JSON.stringify(payload)],
    );
  }

  private async beginReconciliationAttempt(target: PaymentReconciliationTarget, attemptKey: string): Promise<void> {
    await this.database.query(
      `
        INSERT INTO payment_provider_attempts (
          top_up_payment_id,
          steam_refill_payment_id,
          provider,
          idempotency_key,
          status,
          request_hash,
          request_snapshot
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb)
        ON CONFLICT (provider, idempotency_key)
        DO UPDATE SET
          status = 'pending',
          request_snapshot = EXCLUDED.request_snapshot,
          response_snapshot = '{}'::jsonb,
          error_code = NULL,
          finished_at = NULL
      `,
      [
        target.kind === "top_up" ? target.id : null,
        target.kind === "steam_refill" ? target.id : null,
        target.kind === "top_up" ? TOP_UP_PROVIDER : STEAM_REFILL_PROVIDER,
        attemptKey,
        target.request_hash,
        JSON.stringify({
          provider: target.kind === "top_up" ? TOP_UP_PROVIDER : STEAM_REFILL_PROVIDER,
          search: target.id,
          type: `${target.kind}_payment_status_reconciliation`,
        }),
      ],
    );
  }

  private async finishReconciliationAttempt(
    target: Pick<PaymentReconciliationTarget, "id" | "kind">,
    attemptKey: string,
    status: "failed" | "succeeded",
    responseSnapshot: Record<string, unknown>,
    errorCode: string | null = null,
  ): Promise<void> {
    await this.database.query(
      `
        UPDATE payment_provider_attempts
        SET
          status = $5,
          response_snapshot = $6::jsonb,
          error_code = $7,
          finished_at = now()
        WHERE provider = $1
          AND idempotency_key = $2
          AND (
            ($3::uuid IS NOT NULL AND top_up_payment_id = $3)
            OR ($4::uuid IS NOT NULL AND steam_refill_payment_id = $4)
          )
      `,
      [
        target.kind === "top_up" ? TOP_UP_PROVIDER : STEAM_REFILL_PROVIDER,
        attemptKey,
        target.kind === "top_up" ? target.id : null,
        target.kind === "steam_refill" ? target.id : null,
        status,
        JSON.stringify(responseSnapshot),
        errorCode,
      ],
    );
  }

  private async markWebhookEvent(client: Queryable, providerEventId: string, status: string): Promise<void> {
    await client.query(
      `
        UPDATE payment_webhook_events
        SET status = $3, processed_at = now()
        WHERE provider = $1
          AND provider_event_id = $2
      `,
      [TOP_UP_PROVIDER, providerEventId, status],
    );
  }

  private async findTopUpPayment(client: Queryable, userId: string, idempotencyKey: string): Promise<TopUpPaymentRow | null> {
    const result = await client.query<TopUpPaymentRow>(
      `
        SELECT
          id,
          user_id,
          status,
          provider,
          coin_amount_minor,
          fiat_amount_minor,
          fiat_currency,
          rate_fiat_minor,
          rate_coin_minor,
          provider_checkout_url,
          request_hash
        FROM top_up_payments
        WHERE user_id = $1
          AND idempotency_key = $2
        LIMIT 1
      `,
      [userId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  private async findSteamRefillPayment(client: Queryable, userId: string, idempotencyKey: string): Promise<SteamRefillPaymentRow | null> {
    const result = await client.query<SteamRefillPaymentRow>(
      `
        SELECT
          id,
          user_id,
          status,
          provider,
          amount_rub_minor,
          fee_rub_minor,
          fiat_amount_minor,
          fiat_currency,
          steam_login,
          provider_checkout_url,
          request_hash
        FROM steam_refill_payments
        WHERE user_id = $1
          AND idempotency_key = $2
        LIMIT 1
      `,
      [userId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }
}
