import { createHash } from "node:crypto";

import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import { normalizeIdempotencyKey } from "../../common/idempotency/idempotency-key";
import { FulfillmentService, type FulfillmentSkinReconciliationBatchResultDto } from "../fulfillment/fulfillment.service";
import { PaymentsService, type PaymentReconciliationResultDto } from "../payments/payments.service";

export type AdminOperationsOverviewDto = {
  fulfillment: {
    commands: Array<{
      commandType: string;
      createdAt: string;
      id: string;
      lastAttemptOperation: string | null;
      lastAttemptStatus: string | null;
      lastErrorCode: string | null;
      orderId: string;
      orderLineId: string;
      provider: string;
      status: string;
      updatedAt: string;
    }>;
  };
  generatedAt: string;
  orders: {
    problem: Array<{
      createdAt: string;
      id: string;
      lineCount: number;
      openLineCount: number;
      status: string;
      totalCoinMinor: number;
      updatedAt: string;
      userId: string;
    }>;
  };
  payments: {
    manualReview: Array<{
      coinAmountMinor: number;
      createdAt: string;
      fiatAmountMinor: number;
      fiatCurrency: string;
      id: string;
      manualReviewReason: string | null;
      provider: string;
      providerStatus: string | null;
      status: string;
      updatedAt: string;
      userId: string;
    }>;
  };
  webhooks: {
    problem: Array<{
      id: string;
      processedAt: string | null;
      provider: string;
      providerEventId: string;
      receivedAt: string;
      signatureStatus: string;
      status: string;
    }>;
  };
};

export type AdminPaymentReconciliationCommandBody = {
  limit?: number;
  reason?: string;
};

export type AdminFulfillmentReconciliationCommandBody = AdminPaymentReconciliationCommandBody;

export type AdminPaymentReconciliationResultDto = {
  idempotencyKey: string;
  result: PaymentReconciliationResultDto | null;
  status: "duplicate" | "processed";
};

export type AdminFulfillmentReconciliationResultDto = {
  idempotencyKey: string;
  result: FulfillmentSkinReconciliationBatchResultDto | null;
  status: "duplicate" | "processed";
};

type ReconcilePaymentsCommand = {
  body: AdminPaymentReconciliationCommandBody;
  idempotencyKey: string | undefined;
};

type ReconcileFulfillmentCommand = {
  body: AdminFulfillmentReconciliationCommandBody;
  idempotencyKey: string | undefined;
};

type PaymentRow = {
  coin_amount_minor: number;
  created_at: Date;
  fiat_amount_minor: number;
  fiat_currency: string;
  id: string;
  manual_review_reason: string | null;
  provider: string;
  provider_status: string | null;
  status: string;
  updated_at: Date;
  user_id: string;
};

type OrderRow = {
  created_at: Date;
  id: string;
  line_count: string;
  open_line_count: string;
  status: string;
  total_coin_minor: number;
  updated_at: Date;
  user_id: string;
};

type FulfillmentCommandRow = {
  command_type: string;
  created_at: Date;
  id: string;
  last_attempt_operation: string | null;
  last_attempt_status: string | null;
  last_error_code: string | null;
  order_id: string;
  order_line_id: string;
  provider: string;
  status: string;
  updated_at: Date;
};

type WebhookRow = {
  id: string;
  processed_at: Date | null;
  provider: string;
  provider_event_id: string;
  received_at: Date;
  signature_status: string;
  status: string;
};

type IdempotencyRow = {
  request_hash: string;
  status: string;
};

function countTextToNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("ADMIN_COUNT_INVALID");
  return parsed;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function requireAdminIdempotencyKey(value: string | undefined): string {
  try {
    const normalized = normalizeIdempotencyKey(value);
    if (normalized === undefined) throw new BadRequestException("Idempotency key is required");
    return normalized;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(error instanceof Error ? error.message : "Idempotency key is invalid");
  }
}

function parseReconciliationBody(body: AdminPaymentReconciliationCommandBody): { limit: number; reason: string } {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) {
    throw new BadRequestException("Admin operation reason must be between 10 and 500 characters");
  }
  const limit = body.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestException("Reconciliation limit must be between 1 and 100");
  }
  return { limit, reason };
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  async getOperationsOverview(): Promise<AdminOperationsOverviewDto> {
    const [payments, orders, fulfillment, webhooks] = await Promise.all([
      this.database.query<PaymentRow>(
        `
          SELECT
            id,
            user_id,
            status,
            provider,
            provider_status,
            coin_amount_minor,
            fiat_amount_minor,
            fiat_currency,
            metadata->>'manualReviewReason' AS manual_review_reason,
            created_at,
            updated_at
          FROM top_up_payments
          WHERE status = 'manual_review'
          ORDER BY updated_at DESC, id DESC
          LIMIT 100
        `,
      ),
      this.database.query<OrderRow>(
        `
          SELECT
            orders.id,
            orders.user_id,
            orders.status,
            orders.total_coin_minor,
            orders.created_at,
            orders.updated_at,
            count(order_lines.id)::text AS line_count,
            count(order_lines.id) FILTER (WHERE order_lines.status NOT IN ('supplier_finished', 'supplier_failed'))::text AS open_line_count
          FROM orders
          LEFT JOIN order_lines ON order_lines.order_id = orders.id
          WHERE orders.status IN ('manual_review', 'failed')
          GROUP BY orders.id
          ORDER BY orders.updated_at DESC, orders.id DESC
          LIMIT 100
        `,
      ),
      this.database.query<FulfillmentCommandRow>(
        `
          SELECT
            fulfillment_commands.id,
            fulfillment_commands.order_id,
            fulfillment_commands.order_line_id,
            fulfillment_commands.provider,
            fulfillment_commands.command_type,
            fulfillment_commands.status,
            fulfillment_commands.last_error_code,
            fulfillment_commands.created_at,
            fulfillment_commands.updated_at,
            last_attempt.operation AS last_attempt_operation,
            last_attempt.status AS last_attempt_status
          FROM fulfillment_commands
          LEFT JOIN LATERAL (
            SELECT operation, status
            FROM fulfillment_provider_attempts
            WHERE fulfillment_provider_attempts.command_id = fulfillment_commands.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ) AS last_attempt ON true
          WHERE fulfillment_commands.status IN ('pending', 'processing', 'submitted', 'manual_review', 'failed')
          ORDER BY fulfillment_commands.updated_at DESC, fulfillment_commands.id DESC
          LIMIT 100
        `,
      ),
      this.database.query<WebhookRow>(
        `
          SELECT
            id,
            provider,
            provider_event_id,
            status,
            signature_status,
            received_at,
            processed_at
          FROM payment_webhook_events
          WHERE status NOT IN ('processed', 'duplicate', 'ignored')
          ORDER BY received_at DESC, id DESC
          LIMIT 100
        `,
      ),
    ]);

    return {
      fulfillment: {
        commands: fulfillment.rows.map((row) => ({
          commandType: row.command_type,
          createdAt: row.created_at.toISOString(),
          id: row.id,
          lastAttemptOperation: row.last_attempt_operation,
          lastAttemptStatus: row.last_attempt_status,
          lastErrorCode: row.last_error_code,
          orderId: row.order_id,
          orderLineId: row.order_line_id,
          provider: row.provider,
          status: row.status,
          updatedAt: row.updated_at.toISOString(),
        })),
      },
      generatedAt: new Date().toISOString(),
      orders: {
        problem: orders.rows.map((row) => ({
          createdAt: row.created_at.toISOString(),
          id: row.id,
          lineCount: countTextToNumber(row.line_count),
          openLineCount: countTextToNumber(row.open_line_count),
          status: row.status,
          totalCoinMinor: row.total_coin_minor,
          updatedAt: row.updated_at.toISOString(),
          userId: row.user_id,
        })),
      },
      payments: {
        manualReview: payments.rows.map((row) => ({
          coinAmountMinor: row.coin_amount_minor,
          createdAt: row.created_at.toISOString(),
          fiatAmountMinor: row.fiat_amount_minor,
          fiatCurrency: row.fiat_currency,
          id: row.id,
          manualReviewReason: row.manual_review_reason,
          provider: row.provider,
          providerStatus: row.provider_status,
          status: row.status,
          updatedAt: row.updated_at.toISOString(),
          userId: row.user_id,
        })),
      },
      webhooks: {
        problem: webhooks.rows.map((row) => ({
          id: row.id,
          processedAt: row.processed_at?.toISOString() ?? null,
          provider: row.provider,
          providerEventId: row.provider_event_id,
          receivedAt: row.received_at.toISOString(),
          signatureStatus: row.signature_status,
          status: row.status,
        })),
      },
    };
  }

  async reconcilePayments(command: ReconcilePaymentsCommand): Promise<AdminPaymentReconciliationResultDto> {
    const idempotencyKey = requireAdminIdempotencyKey(command.idempotencyKey);
    const parsed = parseReconciliationBody(command.body);
    const action = "admin.payments.reconcile";
    const scope = "admin:payments:reconcile";
    const requestHash = sha256({
      limit: parsed.limit,
      operation: action,
      reason: parsed.reason,
    });

    const shouldProcess = await this.reserveAdminOperation(scope, idempotencyKey, requestHash);
    if (!shouldProcess) {
      return {
        idempotencyKey,
        result: null,
        status: "duplicate",
      };
    }

    try {
      const result = await this.payments.reconcilePendingTopUps({ limit: parsed.limit });
      await this.completeAdminOperation({
        action,
        idempotencyKey,
        limit: parsed.limit,
        reason: parsed.reason,
        requestHash,
        result,
        scope,
      });
      return {
        idempotencyKey,
        result,
        status: "processed",
      };
    } catch (error) {
      await this.failAdminOperation(scope, idempotencyKey, requestHash);
      throw error;
    }
  }

  async reconcileFulfillment(command: ReconcileFulfillmentCommand): Promise<AdminFulfillmentReconciliationResultDto> {
    const idempotencyKey = requireAdminIdempotencyKey(command.idempotencyKey);
    const parsed = parseReconciliationBody(command.body);
    const action = "admin.fulfillment.reconcile";
    const scope = "admin:fulfillment:reconcile";
    const requestHash = sha256({
      limit: parsed.limit,
      operation: action,
      reason: parsed.reason,
    });

    const shouldProcess = await this.reserveAdminOperation(scope, idempotencyKey, requestHash);
    if (!shouldProcess) {
      return {
        idempotencyKey,
        result: null,
        status: "duplicate",
      };
    }

    try {
      const result = await this.fulfillment.reconcileSubmittedSkinCommands({ limit: parsed.limit });
      await this.completeAdminOperation({
        action,
        idempotencyKey,
        limit: parsed.limit,
        reason: parsed.reason,
        requestHash,
        result,
        scope,
      });
      return {
        idempotencyKey,
        result,
        status: "processed",
      };
    } catch (error) {
      await this.failAdminOperation(scope, idempotencyKey, requestHash);
      throw error;
    }
  }

  private async reserveAdminOperation(scope: string, idempotencyKey: string, requestHash: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const inserted = await client.query(
        `
          INSERT INTO idempotency_keys (
            scope,
            id,
            request_hash,
            status,
            locked_at
          )
          VALUES ($1, $2, $3, 'processing', now())
          ON CONFLICT (scope, id) DO NOTHING
          RETURNING id
        `,
        [scope, idempotencyKey, requestHash],
      );
      if (inserted.rowCount === 1) return true;

      const existing = await client.query<IdempotencyRow>(
        `
          SELECT request_hash, status
          FROM idempotency_keys
          WHERE scope = $1
            AND id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [scope, idempotencyKey],
      );
      const row = existing.rows[0];
      if (row === undefined) throw new ConflictException("Admin operation idempotency key is not available");
      if (row.request_hash !== requestHash) {
        throw new ConflictException("Idempotency key is already used for a different admin operation");
      }
      if (row.status === "completed") return false;
      throw new ConflictException("Admin operation is already processing or failed; use a new idempotency key after reviewing evidence");
    });
  }

  private async completeAdminOperation(command: {
    action: string;
    idempotencyKey: string;
    limit: number;
    reason: string;
    requestHash: string;
    result: PaymentReconciliationResultDto | FulfillmentSkinReconciliationBatchResultDto;
    scope: string;
  }): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE idempotency_keys
          SET
            status = 'completed',
            response_hash = $4,
            locked_at = NULL,
            completed_at = now(),
            updated_at = now()
          WHERE scope = $1
            AND id = $2
            AND request_hash = $3
        `,
        [command.scope, command.idempotencyKey, command.requestHash, sha256(command.result)],
      );
      await client.query(
        `
          INSERT INTO audit_events (
            actor_user_id,
            action,
            target_type,
            target_id,
            request_id,
            metadata
          )
          VALUES (NULL, $1, 'admin_operation', $2, NULL, $3::jsonb)
        `,
        [
          command.action,
          command.idempotencyKey,
          JSON.stringify({
            idempotencyKey: command.idempotencyKey,
            limit: command.limit,
            reason: command.reason,
            result: command.result,
            status: "processed",
          }),
        ],
      );
    });
  }

  private async failAdminOperation(scope: string, idempotencyKey: string, requestHash: string): Promise<void> {
    await this.database.query(
      `
        UPDATE idempotency_keys
        SET
          status = 'failed',
          locked_at = NULL,
          updated_at = now()
        WHERE scope = $1
          AND id = $2
          AND request_hash = $3
      `,
      [scope, idempotencyKey, requestHash],
    );
  }
}
