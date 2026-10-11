import { Inject, Injectable } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import { DatabaseService } from "../../common/database/database.service";
import type { CatalogProductKind } from "../catalog/catalog.types";
import type { CheckoutRecipientSnapshot } from "../checkout/checkout.service";

type Queryable = {
  query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>>;
};

export type OrderHistoryLineDto = {
  bundleId?: string;
  fulfillmentStage: OrderHistoryLineFulfillmentStage;
  id: string;
  productSlug: string;
  kind: CatalogProductKind;
  title: string;
  quantity: 1;
  unitPriceCoinMinor: number;
  recipientSnapshot: CheckoutRecipientSnapshot;
};

export type OrderHistoryStatus = "failed" | "fulfilled" | "held" | "manual_review" | "partially_fulfilled";
export type OrderHistoryLineFulfillmentStage = "pending" | "trade_offer_sent" | "trade_protection" | "delivered" | "failed" | "needs_review";

export type OrderHistoryItemDto = {
  id: string;
  userId: string;
  status: OrderHistoryStatus;
  totalCoinMinor: number;
  recipientSnapshots: CheckoutRecipientSnapshot[];
  createdAt: string;
  lines: OrderHistoryLineDto[];
};

export type OrderHistoryDto = {
  orders: OrderHistoryItemDto[];
};

type OrderRow = {
  id: string;
  user_id: string;
  status: OrderHistoryItemDto["status"];
  total_coin_minor: number;
  recipient_snapshots: CheckoutRecipientSnapshot[];
  created_at: Date;
};

type OrderLineRow = {
  bundle_id: string | null;
  command_status: string | null;
  id: string;
  latest_response_snapshot: Record<string, unknown> | null;
  order_id: string;
  line_index: number;
  product_slug: string;
  kind: CatalogProductKind;
  line_status: string;
  title: string;
  quantity: number;
  unit_price_coin_minor: number;
  recipient_snapshot: CheckoutRecipientSnapshot;
};

type SteamRefillPaymentHistoryRow = {
  id: string;
  user_id: string;
  status: "provider_configuration_required" | "provider_creation_pending" | "checkout_pending" | "paid" | "failed" | "manual_review";
  amount_rub_minor: number;
  steam_login: string;
  created_at: Date;
};

function nestedString(value: Record<string, unknown> | null, path: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

function fulfillmentStage(row: OrderLineRow): OrderHistoryLineFulfillmentStage {
  if (row.line_status === "supplier_finished") return "delivered";
  if (row.line_status === "supplier_failed") return "failed";
  if (row.line_status === "protection_failed" || row.command_status === "manual_review") return "needs_review";
  const providerStatus = nestedString(row.latest_response_snapshot, ["status"]);
  const protectionStatus = nestedString(row.latest_response_snapshot, ["protection", "status"]);
  if (providerStatus === "finished" && protectionStatus === "processing") return "trade_protection";
  if (row.line_status === "supplier_sent") return "trade_offer_sent";
  return "pending";
}

function steamRefillPaymentHistoryStatus(status: SteamRefillPaymentHistoryRow["status"]): OrderHistoryStatus {
  if (status === "paid") return "fulfilled";
  if (status === "failed") return "failed";
  if (status === "manual_review" || status === "provider_configuration_required") return "manual_review";
  return "held";
}

function steamRefillPaymentFulfillmentStage(status: SteamRefillPaymentHistoryRow["status"]): OrderHistoryLineFulfillmentStage {
  if (status === "paid") return "delivered";
  if (status === "failed") return "failed";
  if (status === "manual_review" || status === "provider_configuration_required") return "needs_review";
  return "pending";
}

function steamRefillPaymentToOrderHistory(payment: SteamRefillPaymentHistoryRow): OrderHistoryItemDto {
  if (payment.amount_rub_minor % 100 !== 0) throw new Error("STEAM_REFILL_HISTORY_AMOUNT_INVALID");
  const amountRub = payment.amount_rub_minor / 100;
  const recipientSnapshot: CheckoutRecipientSnapshot = {
    kind: "steam-refill",
    steamLogin: payment.steam_login,
  };
  return {
    id: payment.id,
    userId: payment.user_id,
    status: steamRefillPaymentHistoryStatus(payment.status),
    totalCoinMinor: 0,
    recipientSnapshots: [recipientSnapshot],
    createdAt: payment.created_at.toISOString(),
    lines: [{
      fulfillmentStage: steamRefillPaymentFulfillmentStage(payment.status),
      id: payment.id,
      productSlug: `steam-top-up-${amountRub}-rub`,
      kind: "steam",
      title: `Пополнение Steam на ${amountRub} RUB`,
      quantity: 1,
      unitPriceCoinMinor: 0,
      recipientSnapshot,
    }],
  };
}

@Injectable()
export class OrdersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listUserOrders(userId: string): Promise<OrderHistoryDto> {
    return this.listUserOrdersWithClient(this.database, userId);
  }

  private async listUserOrdersWithClient(client: Queryable, userId: string): Promise<OrderHistoryDto> {
    const orders = await client.query<OrderRow>(
      `
        SELECT id, user_id, status, total_coin_minor, recipient_snapshots, created_at
        FROM orders
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId],
    );
    const steamRefillPayments = await client.query<SteamRefillPaymentHistoryRow>(
      `
        SELECT id, user_id, status, amount_rub_minor, steam_login, created_at
        FROM steam_refill_payments
        WHERE user_id = $1
          AND order_id IS NULL
        ORDER BY created_at DESC, id DESC
      `,
      [userId],
    );
    if (orders.rows.length === 0 && steamRefillPayments.rows.length === 0) return { orders: [] };

    const orderIds = orders.rows.map((order) => order.id);
    const lines = orderIds.length === 0
      ? { rows: [] }
      : await client.query<OrderLineRow>(
        `
          SELECT
            order_lines.id,
            order_lines.order_id,
            order_lines.line_index,
            order_lines.product_slug,
            order_lines.bundle_id,
            order_lines.kind,
            order_lines.status AS line_status,
            order_lines.title,
            order_lines.quantity,
            order_lines.unit_price_coin_minor,
            order_lines.recipient_snapshot,
            fulfillment_command.status AS command_status,
            latest_attempt.response_snapshot AS latest_response_snapshot
          FROM order_lines
          LEFT JOIN LATERAL (
            SELECT fulfillment_commands.id, fulfillment_commands.status
            FROM fulfillment_commands
            WHERE fulfillment_commands.order_line_id = order_lines.id
              AND fulfillment_commands.command_type IN ('sih_skin_purchase', 'sih_steam_refill')
            ORDER BY fulfillment_commands.created_at ASC, fulfillment_commands.id ASC
            LIMIT 1
          ) AS fulfillment_command ON true
          LEFT JOIN LATERAL (
            SELECT fulfillment_provider_attempts.response_snapshot
            FROM fulfillment_provider_attempts
            WHERE fulfillment_provider_attempts.command_id = fulfillment_command.id
              AND fulfillment_provider_attempts.status = 'succeeded'
            ORDER BY fulfillment_provider_attempts.created_at DESC, fulfillment_provider_attempts.id DESC
            LIMIT 1
          ) AS latest_attempt ON true
          WHERE order_id = ANY($1::uuid[])
          ORDER BY order_id ASC, line_index ASC
        `,
        [orderIds],
      );
    const linesByOrder = new Map<string, OrderLineRow[]>();
    for (const line of lines.rows) {
      const current = linesByOrder.get(line.order_id) ?? [];
      current.push(line);
      linesByOrder.set(line.order_id, current);
    }

    const orderHistory = orders.rows.map<OrderHistoryItemDto>((order) => ({
      id: order.id,
      userId: order.user_id,
      status: order.status,
      totalCoinMinor: order.total_coin_minor,
      recipientSnapshots: order.recipient_snapshots,
      createdAt: order.created_at.toISOString(),
      lines: (linesByOrder.get(order.id) ?? []).map((line) => ({
        fulfillmentStage: fulfillmentStage(line),
        id: line.id,
        productSlug: line.product_slug,
        ...(line.bundle_id ? { bundleId: line.bundle_id } : {}),
        kind: line.kind,
        title: line.title,
        quantity: 1,
        unitPriceCoinMinor: line.unit_price_coin_minor,
        recipientSnapshot: line.recipient_snapshot,
      })),
    }));
    const steamRefillHistory = steamRefillPayments.rows.map(steamRefillPaymentToOrderHistory);
    return {
      orders: [...orderHistory, ...steamRefillHistory].sort((left, right) => {
        const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        return createdDiff === 0 ? right.id.localeCompare(left.id) : createdDiff;
      }),
    };
  }
}
