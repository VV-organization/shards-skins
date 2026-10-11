import { Inject, Injectable } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import { DatabaseService } from "../../common/database/database.service";
import { parseSteamRefillAmountRub } from "../catalog/steam-refill-product";
import type { CatalogProductDto } from "../catalog/catalog.types";
import type { CheckoutRecipientSnapshot } from "../checkout/checkout.service";
import { SihClient, SihProviderError } from "../providers/sih/sih.client";
import type { SihCatalogGame, SihCreateSkinOrderResult, SihFailureDisposition, SihSkinOrder, SihSkinOrderStatus, SihSteamCheckResult, SihSteamPayResult } from "../providers/sih/sih.types";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";

type Queryable = {
  query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>>;
};

export type FulfillmentOrderLineInput = {
  appleGiftCard?: {
    currency: string;
    nominalMinor: number;
    regionCode: string;
    regionLabel: string;
  };
  id: string;
  productSlug: string;
  kind: CatalogProductDto["kind"];
  title: string;
  unitPriceCoinMinor: number;
  recipientSnapshot: CheckoutRecipientSnapshot;
};

type FulfillmentCommandType = "manual_apple_gift_card" | "sih_skin_purchase" | "sih_steam_refill";

type PendingSkinCommand = {
  attemptId: string;
  amountMicrousd: bigint;
  commandId: string;
  game: SihCatalogGame;
  marketHashName: string;
  orderId: string;
  orderLineId: string;
  steamId64: string;
  userId: string;
};

type PendingSkinReconciliation = {
  attemptId: string;
  commandId: string;
  customId: string;
  orderId: string;
  orderLineId: string;
  userId: string;
};

type PendingSteamRefillCheck = {
  amountRub: number;
  attemptId: string;
  commandId: string;
  kind: "check";
  orderId: string;
  orderLineId: string;
  steamUsername: string;
  userId: string;
};

type PendingSteamRefillPay = {
  amountRub: number;
  attemptId: string;
  commandId: string;
  kind: "pay";
  orderId: string;
  orderLineId: string;
  steamUsername: string;
  transactionId: string;
  userId: string;
};

type PendingSteamRefill = PendingSteamRefillCheck | PendingSteamRefillPay;

type OrderSettlementSubject = {
  orderId: string;
  userId: string;
};

export type ProcessFulfillmentCommand = {
  skinTestMode: boolean;
};

export type ProcessFulfillmentResult =
  | {
    status: "none";
  }
  | {
    commandId: string;
    providerOrderId: string;
    status: "completed";
  }
  | {
    commandId: string;
    providerOrderId: string;
    status: "submitted";
  };

export type ReconcileFulfillmentResult =
  | {
    status: "none";
  }
  | {
    commandStatus: "completed" | "failed" | "manual_review" | "submitted";
    commandId: string;
    providerStatus: SihSkinOrderStatus;
    status: "reconciled";
  };

export type FulfillmentSkinReconciliationBatchResultDto = {
  checked: number;
  commands: Array<{
    commandId: string;
    providerStatus: SihSkinOrderStatus;
  }>;
  errors: number;
  reconciled: number;
};

function commandTypeForLine(line: FulfillmentOrderLineInput): FulfillmentCommandType {
  if (line.kind === "skins") return "sih_skin_purchase";
  if (line.kind === "apple_gift_card") return "manual_apple_gift_card";
  return "sih_steam_refill";
}

function steamRefillAmountRub(productSlug: string): number {
  const amountRub = parseSteamRefillAmountRub(productSlug);
  if (amountRub === null) throw new Error("FULFILLMENT_STEAM_REFILL_AMOUNT_INVALID");
  return amountRub;
}

function steamUsernameFromSnapshot(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { kind?: unknown }).kind !== "steam-refill" ||
    typeof (value as { steamLogin?: unknown }).steamLogin !== "string"
  ) {
    throw new Error("FULFILLMENT_STEAM_REFILL_RECIPIENT_INVALID");
  }
  const steamUsername = (value as { steamLogin: string }).steamLogin.trim();
  if (steamUsername.length === 0 || steamUsername.length > 64) throw new Error("FULFILLMENT_STEAM_REFILL_RECIPIENT_INVALID");
  return steamUsername;
}

@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SihClient) private readonly sih: SihClient,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async enqueueOrderLineCommands(
    client: Queryable,
    command: {
      orderId: string;
      lines: FulfillmentOrderLineInput[];
    },
  ): Promise<void> {
    for (const line of command.lines) {
      const commandType = commandTypeForLine(line);
      const idempotencyKey = `${command.orderId}:${line.id}:${commandType}`;
      const isAppleGiftCard = line.kind === "apple_gift_card";
      await client.query(
        `
          INSERT INTO fulfillment_commands (
            order_id,
            order_line_id,
            provider,
            command_type,
            status,
            idempotency_key,
            payload_snapshot
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          ON CONFLICT (order_line_id, command_type) DO NOTHING
        `,
        [
          command.orderId,
          line.id,
          isAppleGiftCard ? "manual" : "sih",
          commandType,
          isAppleGiftCard ? "manual_review" : "pending",
          idempotencyKey,
          JSON.stringify({
            orderId: command.orderId,
            orderLineId: line.id,
            productSlug: line.productSlug,
            kind: line.kind,
            title: line.title,
            unitPriceCoinMinor: line.unitPriceCoinMinor,
            recipientSnapshot: line.recipientSnapshot,
          }),
        ],
      );
      if (isAppleGiftCard && line.appleGiftCard && line.recipientSnapshot.kind === "delivery-email") {
        await client.query(`
          INSERT INTO apple_gift_card_fulfillments (order_line_id, delivery_email, region_code, currency, nominal_minor)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (order_line_id) DO NOTHING
        `, [line.id, line.recipientSnapshot.email, line.appleGiftCard.regionCode, line.appleGiftCard.currency, line.appleGiftCard.nominalMinor]);
      }
    }
  }

  async processNextPendingCommand(command: ProcessFulfillmentCommand): Promise<ProcessFulfillmentResult> {
    const pending = await this.claimNextSkinCommand(command);
    if (pending === null) {
      const refill = await this.claimNextSteamRefillCommand();
      if (refill === null) return { status: "none" };
      return this.processSteamRefill(refill);
    }

    const credential = await this.users.requireSteamTradeCredential(pending.userId);
    let response: SihCreateSkinOrderResult;
    try {
      response = await this.sih.createSkinOrder({
        amountMicrousd: pending.amountMicrousd,
        customId: pending.attemptId,
        game: pending.game,
        marketHashName: pending.marketHashName,
        steamId64: pending.steamId64,
        test: command.skinTestMode,
        tradeToken: credential.token,
      });
    } catch (error) {
      await this.markAttemptFailed(pending, this.errorCode(error), this.errorDisposition(error));
      throw error;
    }

    const providerOrderId = response.providerOrderId;
    await this.markSkinSubmitted(pending, providerOrderId, response);
    return {
      commandId: pending.commandId,
      providerOrderId,
      status: "submitted",
    };
  }

  async reconcileNextSubmittedSkinCommand(): Promise<ReconcileFulfillmentResult> {
    const pending = await this.claimNextSubmittedSkinCommand();
    if (pending === null) return { status: "none" };

    let order: SihSkinOrder;
    try {
      order = await this.sih.getSkinOrder({ customId: pending.customId });
    } catch (error) {
      await this.markReconciliationFailed(pending, this.errorCode(error), this.errorDisposition(error));
      throw error;
    }

    const reconciliation = await this.markSkinReconciled(pending, order);
    return {
      commandStatus: reconciliation.commandStatus,
      commandId: pending.commandId,
      providerStatus: order.status,
      status: "reconciled",
    };
  }

  async reconcileSubmittedSkinCommands(command: { limit?: number } = {}): Promise<FulfillmentSkinReconciliationBatchResultDto> {
    const limit = command.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("FULFILLMENT_RECONCILIATION_LIMIT_INVALID");
    const result: FulfillmentSkinReconciliationBatchResultDto = {
      checked: 0,
      commands: [],
      errors: 0,
      reconciled: 0,
    };

    for (let index = 0; index < limit; index += 1) {
      let reconciliation: ReconcileFulfillmentResult;
      try {
        reconciliation = await this.reconcileNextSubmittedSkinCommand();
      } catch {
        result.errors += 1;
        break;
      }
      if (reconciliation.status === "none") break;
      result.checked += 1;
      result.reconciled += 1;
      result.commands.push({
        commandId: reconciliation.commandId,
        providerStatus: reconciliation.providerStatus,
      });
      if (reconciliation.commandStatus === "submitted") break;
    }

    return result;
  }

  async completeManualAppleGiftCard(orderLineId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ order_id: string; user_id: string }>(`
        SELECT order_lines.order_id, orders.user_id
        FROM order_lines JOIN orders ON orders.id = order_lines.order_id
        WHERE order_lines.id = $1 AND order_lines.kind = 'apple_gift_card'
        FOR UPDATE
      `, [orderLineId]);
      const pending = result.rows[0];
      if (!pending) throw new Error("APPLE_GIFT_CARD_ORDER_LINE_NOT_FOUND");
      await client.query(`
        UPDATE fulfillment_commands
        SET status = 'completed', finished_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE order_line_id = $1 AND command_type = 'manual_apple_gift_card' AND status <> 'completed'
      `, [orderLineId]);
      await client.query("UPDATE order_lines SET status = 'supplier_finished' WHERE id = $1", [orderLineId]);
      await this.settleOrderIfTerminal(client, { orderId: pending.order_id, userId: pending.user_id });
    });
  }

  private async claimNextSkinCommand(command: ProcessFulfillmentCommand): Promise<PendingSkinCommand | null> {
    return this.database.transaction(async (client) => {
      const claimed = await client.query<{
        amount_microusd: string;
        command_id: string;
        game: string | null;
        market_hash_name: string | null;
        order_id: string;
        order_line_id: string;
        steam_id64: string;
        user_id: string;
      }>(
        `
          SELECT
            fulfillment_commands.id AS command_id,
            fulfillment_commands.order_id,
            fulfillment_commands.order_line_id,
            orders.user_id,
            users.steam_id64,
            lower(catalog_products.game) AS game,
            catalog_products.supplier_item_id AS market_hash_name,
            supplier_listings.price_microusd::text AS amount_microusd
          FROM fulfillment_commands
          JOIN orders ON orders.id = fulfillment_commands.order_id
          JOIN users ON users.id = orders.user_id
          JOIN order_lines ON order_lines.id = fulfillment_commands.order_line_id
          JOIN catalog_products ON catalog_products.id = order_lines.product_id
          JOIN supplier_listings
            ON supplier_listings.supplier = 'sih'
            AND supplier_listings.game = lower(catalog_products.game)
            AND supplier_listings.market_hash_name = catalog_products.supplier_item_id
            AND supplier_listings.active = true
          WHERE fulfillment_commands.provider = 'sih'
            AND fulfillment_commands.command_type = 'sih_skin_purchase'
            AND fulfillment_commands.status = 'pending'
            AND fulfillment_commands.available_at <= clock_timestamp()
          ORDER BY fulfillment_commands.created_at ASC, fulfillment_commands.id ASC
          FOR UPDATE OF fulfillment_commands SKIP LOCKED
          LIMIT 1
        `,
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      const game = this.sihGame(row.game);
      if (row.market_hash_name === null) throw new Error("FULFILLMENT_MARKET_HASH_NAME_MISSING");

      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = 'processing',
              locked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [row.command_id],
      );
      const attempt = await client.query<{ id: string }>(
        `
          INSERT INTO fulfillment_provider_attempts (
            command_id,
            order_id,
            order_line_id,
            provider,
            operation,
            status,
            idempotency_key,
            request_snapshot
          )
          VALUES ($1, $2, $3, 'sih', 'create_order', 'started', gen_random_uuid()::text, $4::jsonb)
          RETURNING id
        `,
        [
          row.command_id,
          row.order_id,
          row.order_line_id,
          JSON.stringify({
            amountMicrousd: row.amount_microusd,
            marketHashName: row.market_hash_name,
            skinTestMode: command.skinTestMode,
          }),
        ],
      );
      const attemptId = attempt.rows[0]?.id;
      if (attemptId === undefined) throw new Error("FULFILLMENT_ATTEMPT_NOT_CREATED");
      await client.query(
        "UPDATE fulfillment_provider_attempts SET idempotency_key = $1 WHERE id = $1",
        [attemptId],
      );
      return {
        amountMicrousd: BigInt(row.amount_microusd),
        attemptId,
        commandId: row.command_id,
        game,
        marketHashName: row.market_hash_name,
        orderId: row.order_id,
        orderLineId: row.order_line_id,
        steamId64: row.steam_id64,
        userId: row.user_id,
      };
    });
  }

  private async markSkinSubmitted(pending: PendingSkinCommand, providerOrderId: string, response: SihCreateSkinOrderResult): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE fulfillment_provider_attempts
          SET status = 'succeeded',
              provider_order_id = $2,
              response_snapshot = $3::jsonb,
              finished_at = clock_timestamp()
          WHERE id = $1
        `,
        [
          pending.attemptId,
          providerOrderId,
          JSON.stringify({
            projection: response.projection,
            providerOrderId,
          }),
        ],
      );
      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = 'submitted',
              finished_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.commandId],
      );
      await client.query(
        "UPDATE order_lines SET status = 'supplier_submitted' WHERE id = $1",
        [pending.orderLineId],
      );
    });
  }

  private async claimNextSteamRefillCommand(): Promise<PendingSteamRefill | null> {
    return this.database.transaction(async (client) => {
      const claimed = await client.query<{
        command_id: string;
        order_id: string;
        order_line_id: string;
        product_slug: string;
        recipient_snapshot: unknown;
        steam_check_transaction_id: string | null;
        user_id: string;
      }>(
        `
          SELECT
            fulfillment_commands.id AS command_id,
            fulfillment_commands.order_id,
            fulfillment_commands.order_line_id,
            order_lines.product_slug,
            order_lines.recipient_snapshot,
            orders.user_id,
            steam_check.response_snapshot ->> 'transactionId' AS steam_check_transaction_id
          FROM fulfillment_commands
          JOIN orders ON orders.id = fulfillment_commands.order_id
          JOIN order_lines ON order_lines.id = fulfillment_commands.order_line_id
          LEFT JOIN LATERAL (
            SELECT response_snapshot
            FROM fulfillment_provider_attempts
            WHERE command_id = fulfillment_commands.id
              AND operation = 'steam_check'
              AND status = 'succeeded'
            ORDER BY created_at DESC
            LIMIT 1
          ) AS steam_check ON true
          WHERE fulfillment_commands.provider = 'sih'
            AND fulfillment_commands.command_type = 'sih_steam_refill'
            AND fulfillment_commands.status = 'pending'
            AND fulfillment_commands.available_at <= clock_timestamp()
          ORDER BY fulfillment_commands.created_at ASC, fulfillment_commands.id ASC
          FOR UPDATE OF fulfillment_commands SKIP LOCKED
          LIMIT 1
        `,
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      const amountRub = steamRefillAmountRub(row.product_slug);
      const steamUsername = steamUsernameFromSnapshot(row.recipient_snapshot);
      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = 'processing',
              locked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [row.command_id],
      );
      if (row.steam_check_transaction_id !== null) {
        const attemptId = await this.createSteamProviderAttempt(client, {
          amountRub,
          commandId: row.command_id,
          operation: "steam_pay",
          orderId: row.order_id,
          orderLineId: row.order_line_id,
          providerOrderId: row.steam_check_transaction_id,
          requestSnapshot: {
            amountRub,
            currency: "RUB",
            steamUsername,
            transactionId: row.steam_check_transaction_id,
          },
        });
        return {
          amountRub,
          attemptId,
          commandId: row.command_id,
          kind: "pay",
          orderId: row.order_id,
          orderLineId: row.order_line_id,
          steamUsername,
          transactionId: row.steam_check_transaction_id,
          userId: row.user_id,
        };
      }
      const attemptId = await this.createSteamProviderAttempt(client, {
        commandId: row.command_id,
        operation: "steam_check",
        orderId: row.order_id,
        orderLineId: row.order_line_id,
        requestSnapshot: { steamUsername },
      });
      return {
        amountRub,
        attemptId,
        commandId: row.command_id,
        kind: "check",
        orderId: row.order_id,
        orderLineId: row.order_line_id,
        steamUsername,
        userId: row.user_id,
      };
    });
  }

  private async processSteamRefill(pending: PendingSteamRefill): Promise<ProcessFulfillmentResult> {
    let pay: PendingSteamRefillPay;
    if (pending.kind === "check") {
      let check: SihSteamCheckResult;
      try {
        check = await this.sih.checkSteamAccount({ steamUsername: pending.steamUsername });
      } catch (error) {
        await this.markAttemptFailed(pending, this.errorCode(error), this.errorDisposition(error));
        throw error;
      }
      pay = await this.markSteamCheckSucceededAndCreatePayAttempt(pending, check);
    } else {
      pay = pending;
    }

    let payment: SihSteamPayResult;
    try {
      payment = await this.sih.paySteamRefill({
        amountRub: pay.amountRub,
        steamUsername: pay.steamUsername,
        transactionId: pay.transactionId,
      });
    } catch (error) {
      await this.markAttemptFailed(pay, this.errorCode(error), this.errorDisposition(error));
      throw error;
    }

    await this.markSteamRefillCompleted(pay, payment);
    return {
      commandId: pay.commandId,
      providerOrderId: pay.transactionId,
      status: "completed",
    };
  }

  private async createSteamProviderAttempt(
    client: Queryable,
    command: {
      amountRub?: number;
      commandId: string;
      operation: "steam_check" | "steam_pay";
      orderId: string;
      orderLineId: string;
      providerOrderId?: string;
      requestSnapshot: Record<string, unknown>;
    },
  ): Promise<string> {
    const attempt = await client.query<{ id: string }>(
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
          request_snapshot
        )
        VALUES ($1, $2, $3, 'sih', $4, 'started', gen_random_uuid()::text, $5, $6::jsonb)
        RETURNING id
      `,
      [
        command.commandId,
        command.orderId,
        command.orderLineId,
        command.operation,
        command.providerOrderId ?? null,
        JSON.stringify(command.requestSnapshot),
      ],
    );
    const attemptId = attempt.rows[0]?.id;
    if (attemptId === undefined) throw new Error("FULFILLMENT_STEAM_ATTEMPT_NOT_CREATED");
    await client.query(
      "UPDATE fulfillment_provider_attempts SET idempotency_key = $1 WHERE id = $1",
      [attemptId],
    );
    return attemptId;
  }

  private async markSteamCheckSucceededAndCreatePayAttempt(
    pending: PendingSteamRefillCheck,
    check: SihSteamCheckResult,
  ): Promise<PendingSteamRefillPay> {
    return this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE fulfillment_provider_attempts
          SET status = 'succeeded',
              provider_order_id = $2,
              response_snapshot = $3::jsonb,
              finished_at = clock_timestamp()
          WHERE id = $1
        `,
        [
          pending.attemptId,
          check.transactionId,
          JSON.stringify({ transactionId: check.transactionId }),
        ],
      );
      const attemptId = await this.createSteamProviderAttempt(client, {
        amountRub: pending.amountRub,
        commandId: pending.commandId,
        operation: "steam_pay",
        orderId: pending.orderId,
        orderLineId: pending.orderLineId,
        providerOrderId: check.transactionId,
        requestSnapshot: {
          amountRub: pending.amountRub,
          currency: "RUB",
          steamUsername: pending.steamUsername,
          transactionId: check.transactionId,
        },
      });
      return {
        ...pending,
        attemptId,
        kind: "pay",
        transactionId: check.transactionId,
      };
    });
  }

  private async markSteamRefillCompleted(pending: PendingSteamRefillPay, payment: SihSteamPayResult): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE fulfillment_provider_attempts
          SET status = 'succeeded',
              provider_order_id = $2,
              response_snapshot = $3::jsonb,
              finished_at = clock_timestamp()
          WHERE id = $1
        `,
        [
          pending.attemptId,
          pending.transactionId,
          JSON.stringify({
            cashbackUsd: payment.cashbackUsd.toString(),
            paymentAmountRub: payment.paymentAmountRub.toString(),
            status: payment.status,
          }),
        ],
      );
      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = 'completed',
              finished_at = clock_timestamp(),
              locked_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.commandId],
      );
      await client.query(
        "UPDATE order_lines SET status = 'supplier_finished' WHERE id = $1",
        [pending.orderLineId],
      );
      await this.settleOrderIfTerminal(client, pending);
    });
  }

  private async claimNextSubmittedSkinCommand(): Promise<PendingSkinReconciliation | null> {
    return this.database.transaction(async (client) => {
      const claimed = await client.query<{
        command_id: string;
        custom_id: string;
        order_id: string;
        order_line_id: string;
        user_id: string;
      }>(
        `
          SELECT
            fulfillment_commands.id AS command_id,
            fulfillment_commands.order_id,
            fulfillment_commands.order_line_id,
            create_attempt.id AS custom_id,
            orders.user_id
          FROM fulfillment_commands
          JOIN orders ON orders.id = fulfillment_commands.order_id
          JOIN fulfillment_provider_attempts AS create_attempt
            ON create_attempt.command_id = fulfillment_commands.id
            AND create_attempt.operation = 'create_order'
            AND create_attempt.status = 'succeeded'
          WHERE fulfillment_commands.provider = 'sih'
            AND fulfillment_commands.command_type = 'sih_skin_purchase'
            AND fulfillment_commands.status = 'submitted'
          ORDER BY fulfillment_commands.updated_at ASC, fulfillment_commands.id ASC
          FOR UPDATE OF fulfillment_commands SKIP LOCKED
          LIMIT 1
        `,
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      await client.query(
        `
          UPDATE fulfillment_commands
          SET locked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [row.command_id],
      );
      const attempt = await client.query<{ id: string }>(
        `
          INSERT INTO fulfillment_provider_attempts (
            command_id,
            order_id,
            order_line_id,
            provider,
            operation,
            status,
            idempotency_key,
            request_snapshot
          )
          VALUES ($1, $2, $3, 'sih', 'get_order', 'started', gen_random_uuid()::text, $4::jsonb)
          RETURNING id
        `,
        [
          row.command_id,
          row.order_id,
          row.order_line_id,
          JSON.stringify({ customId: row.custom_id }),
        ],
      );
      const attemptId = attempt.rows[0]?.id;
      if (attemptId === undefined) throw new Error("FULFILLMENT_RECONCILIATION_ATTEMPT_NOT_CREATED");
      await client.query(
        "UPDATE fulfillment_provider_attempts SET idempotency_key = $1 WHERE id = $1",
        [attemptId],
      );
      return {
        attemptId,
        commandId: row.command_id,
        customId: row.custom_id,
        orderId: row.order_id,
        orderLineId: row.order_line_id,
        userId: row.user_id,
      };
    });
  }

  private async markSkinReconciled(
    pending: PendingSkinReconciliation,
    order: SihSkinOrder,
  ): Promise<{ commandStatus: "completed" | "failed" | "manual_review" | "submitted" }> {
    const transition = this.skinReconciliationTransition(order);
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE fulfillment_provider_attempts
          SET status = 'succeeded',
              provider_order_id = $2,
              response_snapshot = $3::jsonb,
              finished_at = clock_timestamp()
          WHERE id = $1
        `,
        [
          pending.attemptId,
          order.providerOrderId,
          JSON.stringify({
            expectedAmountMicrousd: order.expectedAmountMicrousd?.toString() ?? null,
            offerId: order.offerId,
            protection: order.protection === null
              ? null
              : {
                error: order.protection.error,
                rollbackAmountMicrousd: order.protection.rollbackAmountMicrousd?.toString() ?? null,
                rollbackAt: order.protection.rollbackAt?.toISOString() ?? null,
                status: order.protection.status,
              },
            providerOrderId: order.providerOrderId,
            status: order.status,
          }),
        ],
      );
      await client.query(
        `
          UPDATE order_lines
          SET status = CASE
            WHEN status = 'supplier_sent' AND $2 = 'supplier_submitted' THEN status
            WHEN status = 'supplier_finished' AND $2 IN ('supplier_sent', 'supplier_submitted') THEN status
            ELSE $2
          END
          WHERE id = $1
        `,
        [pending.orderLineId, transition.lineStatus],
      );
      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = $2,
              finished_at = CASE
                WHEN $2 IN ('completed', 'failed') THEN clock_timestamp()
                ELSE finished_at
              END,
              locked_at = NULL,
              last_error_code = $3,
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.commandId, transition.commandStatus, transition.errorCode],
      );
      if (transition.orderStatus !== null) {
        await client.query(
          `
            UPDATE orders
            SET status = $2,
                updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [pending.orderId, transition.orderStatus],
        );
      }
      if (transition.shouldSettle) await this.settleOrderIfTerminal(client, pending);
    });
    return { commandStatus: transition.commandStatus };
  }

  private skinReconciliationTransition(order: SihSkinOrder): {
    commandStatus: "completed" | "failed" | "manual_review" | "submitted";
    errorCode: string | null;
    lineStatus: "protection_failed" | "supplier_failed" | "supplier_finished" | "supplier_sent" | "supplier_submitted";
    orderStatus: "manual_review" | null;
    shouldSettle: boolean;
  } {
    if (order.protection?.status === "failed") {
      return {
        commandStatus: "manual_review",
        errorCode: order.protection.error === "rollback supplier"
          ? "SIH_PROTECTION_ROLLBACK_SUPPLIER"
          : "SIH_PROTECTION_ROLLBACK_USER",
        lineStatus: "protection_failed",
        orderStatus: "manual_review",
        shouldSettle: false,
      };
    }
    if (order.status === "finished" && order.protection?.status === "processing") {
      return {
        commandStatus: "submitted",
        errorCode: null,
        lineStatus: "supplier_sent",
        orderStatus: null,
        shouldSettle: false,
      };
    }
    if (order.status === "finished") {
      return {
        commandStatus: "completed",
        errorCode: null,
        lineStatus: "supplier_finished",
        orderStatus: null,
        shouldSettle: true,
      };
    }
    if (order.status === "failed" || order.status === "penalized") {
      return {
        commandStatus: "failed",
        errorCode: null,
        lineStatus: "supplier_failed",
        orderStatus: null,
        shouldSettle: true,
      };
    }
    return {
      commandStatus: "submitted",
      errorCode: null,
      lineStatus: order.status === "sent" ? "supplier_sent" : "supplier_submitted",
      orderStatus: null,
      shouldSettle: false,
    };
  }

  private async settleOrderIfTerminal(client: Queryable, pending: OrderSettlementSubject): Promise<void> {
    const aggregate = await client.query<{
      capture_coin_minor: string;
      finished_lines: string;
      open_lines: string;
      terminal_lines: string;
      total_lines: string;
    }>(
      `
        SELECT
          COALESCE(sum(unit_price_coin_minor * quantity) FILTER (WHERE status = 'supplier_finished'), 0)::text AS capture_coin_minor,
          count(*) FILTER (WHERE status = 'supplier_finished')::text AS finished_lines,
          count(*) FILTER (WHERE status NOT IN ('supplier_finished', 'supplier_failed'))::text AS open_lines,
          count(*) FILTER (WHERE status IN ('supplier_finished', 'supplier_failed'))::text AS terminal_lines,
          count(*)::text AS total_lines
        FROM order_lines
        WHERE order_id = $1
      `,
      [pending.orderId],
    );
    const row = aggregate.rows[0];
    if (row === undefined || row.open_lines !== "0" || row.terminal_lines === "0") return;
    const captureCoinMinor = Number(row.capture_coin_minor);
    if (!Number.isSafeInteger(captureCoinMinor) || captureCoinMinor < 0) throw new Error("FULFILLMENT_CAPTURE_AMOUNT_INVALID");

    const hold = await client.query<{ active_holds: string }>(
      `
        SELECT count(*)::text AS active_holds
        FROM wallet_holds
        WHERE order_id = $1
          AND status = 'active'
      `,
      [pending.orderId],
    );
    if (hold.rows[0]?.active_holds === "0") {
      const finishedLines = Number(row.finished_lines);
      const totalLines = Number(row.total_lines);
      if (!Number.isSafeInteger(finishedLines) || !Number.isSafeInteger(totalLines)) throw new Error("FULFILLMENT_LINE_AGGREGATE_INVALID");
      const orderStatus = finishedLines === 0
        ? "failed"
        : finishedLines === totalLines
          ? "fulfilled"
          : "partially_fulfilled";
      await client.query(
        `
          UPDATE orders
          SET status = $2,
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.orderId, orderStatus],
      );
      return;
    }

    await this.wallet.settleOrderHoldWithClient(client, {
      userId: pending.userId,
      orderId: pending.orderId,
      captureCoinMinor,
      idempotencyKey: `fulfillment-settle:${pending.orderId}`,
      reason: "fulfillment_terminal",
    });

    await client.query(
      `
        UPDATE orders
        SET status = CASE
              WHEN $2 = 0 THEN 'failed'
              WHEN $2 = total_coin_minor THEN 'fulfilled'
              ELSE 'partially_fulfilled'
            END,
            updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [pending.orderId, captureCoinMinor],
    );
  }

  private async markReconciliationFailed(pending: PendingSkinReconciliation, errorCode: string, disposition: SihFailureDisposition): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE fulfillment_provider_attempts
          SET status = 'failed',
              error_code = $2,
              finished_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.attemptId, errorCode],
      );
      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = CASE WHEN $3 = 'permanent' THEN 'manual_review' ELSE status END,
              locked_at = NULL,
              last_error_code = $2,
              updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.commandId, errorCode, disposition],
      );
      if (disposition === "permanent") {
        await client.query(
          `
            UPDATE orders
            SET status = 'manual_review',
                updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [pending.orderId],
        );
      }
    });
  }

  private async markAttemptFailed(
    pending: { attemptId: string; commandId: string; orderId: string; orderLineId: string; userId: string },
    errorCode: string,
    disposition: SihFailureDisposition,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE fulfillment_provider_attempts
          SET status = 'failed',
              error_code = $2,
              finished_at = clock_timestamp()
          WHERE id = $1
        `,
        [pending.attemptId, errorCode],
      );
      if (errorCode === "SIH_REQUEST_REJECTED") {
        await client.query(
          `
            UPDATE order_lines
            SET status = 'supplier_failed'
            WHERE id = $1
          `,
          [pending.orderLineId],
        );
        await client.query(
          `
            UPDATE fulfillment_commands
            SET status = 'failed',
                last_error_code = $2,
                finished_at = clock_timestamp(),
                updated_at = clock_timestamp(),
                locked_at = NULL
            WHERE id = $1
          `,
          [pending.commandId, errorCode],
        );
        await this.settleOrderIfTerminal(client, pending);
        return;
      }
      await client.query(
        `
          UPDATE fulfillment_commands
          SET status = CASE WHEN $3 = 'permanent' THEN 'manual_review' ELSE 'pending' END,
              last_error_code = $2,
              updated_at = clock_timestamp(),
              locked_at = NULL
          WHERE id = $1
        `,
        [pending.commandId, errorCode, disposition],
      );
      if (disposition === "permanent") {
        await client.query(
          `
            UPDATE orders
            SET status = 'manual_review',
                updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [pending.orderId],
        );
      }
    });
  }

  private errorCode(error: unknown): string {
    if (error instanceof SihProviderError) return error.code;
    if (error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message)) return error.message;
    return "FULFILLMENT_PROVIDER_ERROR";
  }

  private errorDisposition(error: unknown): SihFailureDisposition {
    if (error instanceof SihProviderError) return error.disposition;
    return "retryable";
  }

  private sihGame(value: string | null): SihCatalogGame {
    if (value === "cs2") return value;
    throw new Error("FULFILLMENT_SIH_GAME_UNSUPPORTED");
  }
}
