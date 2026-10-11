import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import { IDEMPOTENCY_KEY_HEADER } from "../../common/http/http-headers";
import { DatabaseService } from "../../common/database/database.service";
import { normalizeIdempotencyKey } from "../../common/idempotency/idempotency-key";

type Queryable = {
  query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>>;
};

export type InventoryActionDto =
  | {
    enabled: true;
    reason: "available";
  }
  | {
    enabled: false;
    reason: "not_supported" | "steam_trade_url_required";
  };

export type InventoryItemDto = {
  id: string;
  orderId: string;
  productSlug: string;
  title: string;
  unitPriceCoinMinor: number;
  acquiredAt: string;
  status: "owned";
  actions: {
    sellToSite: InventoryActionDto;
    withdrawToSteam: InventoryActionDto;
  };
};

export type InventoryDto = {
  items: InventoryItemDto[];
};

export type InventoryWithdrawalDto = {
  createdAt: string;
  id: string;
  itemId: string;
  orderId: string;
  orderNumber: string;
  status: "pending";
  title: string;
};

type InventoryRow = {
  acquired_at: Date;
  has_steam_trade_url: boolean;
  id: string;
  order_id: string;
  product_slug: string;
  title: string;
  unit_price_coin_minor: number;
};

type WithdrawalRow = {
  command_created_at: Date;
  command_id: string;
  order_id: string;
  order_line_id: string;
  title: string;
};

function orderNumberFromId(id: string): string {
  return `VLT-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function requireIdempotencyKey(value: string | undefined): string {
  try {
    const normalized = normalizeIdempotencyKey(value);
    if (normalized === undefined) throw new BadRequestException(`${IDEMPOTENCY_KEY_HEADER} is required`);
    return normalized;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`${IDEMPOTENCY_KEY_HEADER} is invalid`);
  }
}

function withdrawalDto(row: WithdrawalRow): InventoryWithdrawalDto {
  return {
    createdAt: row.command_created_at.toISOString(),
    id: row.command_id,
    itemId: row.order_line_id,
    orderId: row.order_id,
    orderNumber: orderNumberFromId(row.order_id),
    status: "pending",
    title: row.title,
  };
}

@Injectable()
export class InventoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listUserInventory(userId: string): Promise<InventoryDto> {
    return this.listUserInventoryWithClient(this.database, userId);
  }

  async requestWithdrawal(command: {
    idempotencyKey: string | undefined;
    itemId: string;
    userId: string;
  }): Promise<InventoryWithdrawalDto> {
    const idempotencyKey = `inventory-withdrawal:${command.userId}:${requireIdempotencyKey(command.idempotencyKey)}`;
    return this.database.transaction(async (client) => {
      const existingByKey = await client.query<WithdrawalRow & { existing_order_line_id: string }>(
        `
          SELECT
            fulfillment_commands.created_at AS command_created_at,
            fulfillment_commands.id AS command_id,
            fulfillment_commands.order_line_id AS existing_order_line_id,
            order_lines.order_id,
            order_lines.id AS order_line_id,
            order_lines.title
          FROM fulfillment_commands
          JOIN order_lines ON order_lines.id = fulfillment_commands.order_line_id
          JOIN orders ON orders.id = order_lines.order_id
          WHERE fulfillment_commands.provider = 'steam_trade'
            AND fulfillment_commands.idempotency_key = $1
            AND fulfillment_commands.command_type = 'steam_inventory_withdrawal'
            AND orders.user_id = $2
          LIMIT 1
        `,
        [idempotencyKey, command.userId],
      );
      const existing = existingByKey.rows[0];
      if (existing !== undefined) {
        if (existing.existing_order_line_id !== command.itemId) throw new ConflictException("Idempotency key was already used for another inventory item");
        return withdrawalDto(existing);
      }

      const item = await client.query<{
        existing_withdrawal_id: string | null;
        has_steam_trade_url: boolean;
        order_id: string;
        order_line_id: string;
        product_slug: string;
        title: string;
        unit_price_coin_minor: number;
      }>(
        `
          SELECT
            existing_withdrawal.id AS existing_withdrawal_id,
            steam_trade_credentials.user_id IS NOT NULL AS has_steam_trade_url,
            order_lines.order_id,
            order_lines.id AS order_line_id,
            order_lines.product_slug,
            order_lines.title,
            order_lines.unit_price_coin_minor
          FROM order_lines
          JOIN orders ON orders.id = order_lines.order_id
          LEFT JOIN steam_trade_credentials ON steam_trade_credentials.user_id = orders.user_id
          LEFT JOIN fulfillment_commands AS existing_withdrawal
            ON existing_withdrawal.order_line_id = order_lines.id
            AND existing_withdrawal.command_type = 'steam_inventory_withdrawal'
            AND existing_withdrawal.status IN ('pending', 'processing', 'submitted', 'completed', 'manual_review')
          WHERE order_lines.id = $1
            AND orders.user_id = $2
            AND order_lines.kind = 'skins'
            AND order_lines.status = 'supplier_finished'
          FOR UPDATE OF order_lines
          LIMIT 1
        `,
        [command.itemId, command.userId],
      );
      const row = item.rows[0];
      if (row === undefined) throw new NotFoundException("Inventory item is not owned by the current user");
      if (!row.has_steam_trade_url) throw new BadRequestException("Steam Trade URL is required before withdrawal");
      if (row.existing_withdrawal_id !== null) throw new ConflictException("Inventory item already has a withdrawal request");

      const inserted = await client.query<WithdrawalRow>(
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
          VALUES ($1, $2, 'steam_trade', 'steam_inventory_withdrawal', 'pending', $3, $4::jsonb)
          RETURNING
            created_at AS command_created_at,
            id AS command_id,
            order_id,
            order_line_id,
            $5::text AS title
        `,
        [
          row.order_id,
          row.order_line_id,
          idempotencyKey,
          JSON.stringify({
            itemId: row.order_line_id,
            orderId: row.order_id,
            productSlug: row.product_slug,
            title: row.title,
            unitPriceCoinMinor: row.unit_price_coin_minor,
          }),
          row.title,
        ],
      );
      const created = inserted.rows[0];
      if (created === undefined) throw new Error("INVENTORY_WITHDRAWAL_NOT_CREATED");
      return withdrawalDto(created);
    });
  }

  private async listUserInventoryWithClient(client: Queryable, userId: string): Promise<InventoryDto> {
    const result = await client.query<InventoryRow>(
      `
        SELECT
          order_lines.id,
          order_lines.order_id,
          order_lines.product_slug,
          order_lines.title,
          order_lines.unit_price_coin_minor,
          steam_trade_credentials.user_id IS NOT NULL AS has_steam_trade_url,
          order_lines.created_at AS acquired_at
        FROM order_lines
        JOIN orders ON orders.id = order_lines.order_id
        LEFT JOIN steam_trade_credentials ON steam_trade_credentials.user_id = orders.user_id
        LEFT JOIN fulfillment_commands AS withdrawal_command
          ON withdrawal_command.order_line_id = order_lines.id
          AND withdrawal_command.command_type = 'steam_inventory_withdrawal'
          AND withdrawal_command.status IN ('pending', 'processing', 'submitted', 'completed', 'manual_review')
        WHERE orders.user_id = $1
          AND order_lines.kind = 'skins'
          AND order_lines.status = 'supplier_finished'
          AND withdrawal_command.id IS NULL
        ORDER BY order_lines.created_at DESC, order_lines.id DESC
      `,
      [userId],
    );

    return {
      items: result.rows.map((item) => ({
        actions: {
          sellToSite: { enabled: false, reason: "not_supported" },
          withdrawToSteam: item.has_steam_trade_url
            ? { enabled: true, reason: "available" }
            : { enabled: false, reason: "steam_trade_url_required" },
        },
        acquiredAt: item.acquired_at.toISOString(),
        id: item.id,
        orderId: item.order_id,
        productSlug: item.product_slug,
        status: "owned",
        title: item.title,
        unitPriceCoinMinor: item.unit_price_coin_minor,
      })),
    };
  }
}
