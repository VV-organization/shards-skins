import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import { BundlesService, discountedBundlePrices } from "../bundles/bundles.service";
import { DatabaseService } from "../../common/database/database.service";
import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { normalizeIdempotencyKey } from "../../common/idempotency/idempotency-key";
import { CatalogService } from "../catalog/catalog.service";
import { parseSteamRefillAmountRub } from "../catalog/steam-refill-product";
import type { CatalogProductDto } from "../catalog/catalog.types";
import { FulfillmentService, type FulfillmentOrderLineInput } from "../fulfillment/fulfillment.service";
import { UsersService } from "../users/users.service";
import { WalletInsufficientFundsError, WalletService } from "../wallet/wallet.service";

type Queryable = {
  query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>>;
};

export type CheckoutCartItem = {
  bundleId?: string;
  productSlug: string;
  quantity: number;
  recipient?: {
    steamLogin?: string;
  };
};

export type CheckoutFromCartCommand = {
  userId: string;
  idempotencyKey: string;
  acceptedTotalCoinMinor: number;
  items: CheckoutCartItem[];
};

export type CheckoutRecipientSnapshot =
  | {
    kind: "steam-trade";
    steamId64: string;
    steamTradePartnerAccountId: string;
  }
  | {
    kind: "steam-refill";
    steamLogin: string;
  }
  | {
    kind: "delivery-email";
    email: string;
    verificationId: string;
  };

export type CheckoutOrderLineDto = {
  bundleId?: string;
  id: string;
  productSlug: string;
  kind: CatalogProductDto["kind"];
  title: string;
  quantity: 1;
  unitPriceCoinMinor: number;
  recipientSnapshot: CheckoutRecipientSnapshot;
};

export type CheckoutOrderDto = {
  id: string;
  userId: string;
  status: "held";
  totalCoinMinor: number;
  recipientSnapshots: CheckoutRecipientSnapshot[];
  lines: CheckoutOrderLineDto[];
};

type PreparedLine = Omit<CheckoutOrderLineDto, "id"> & {
  appleGiftCard?: NonNullable<CatalogProductDto["details"]["appleGiftCard"]>;
  productId: string;
  lineIndex: number;
};

type OrderRow = {
  id: string;
  user_id: string;
  status: CheckoutOrderDto["status"];
  total_coin_minor: number;
  recipient_snapshots: CheckoutRecipientSnapshot[];
  request_hash: string;
};

type OrderLineRow = {
  bundle_id: string | null;
  id: string;
  product_slug: string;
  kind: CatalogProductDto["kind"];
  title: string;
  quantity: number;
  unit_price_coin_minor: number;
  recipient_snapshot: CheckoutRecipientSnapshot;
};

export class CheckoutInsufficientBalanceError extends HttpException {
  readonly code = "CHECKOUT_INSUFFICIENT_BALANCE";

  constructor(readonly requiredCoinMinor: number, readonly availableCoinMinor: number) {
    super({
      statusCode: 402,
      code: "CHECKOUT_INSUFFICIENT_BALANCE",
      message: "Insufficient Coins balance for checkout",
      requiredCoinMinor,
      availableCoinMinor,
    }, 402);
  }
}

export class CheckoutSteamTradeUrlRequiredError extends BadRequestException {
  readonly code = "STEAM_TRADE_URL_REQUIRED";

  constructor() {
    super({
      statusCode: 400,
      code: "STEAM_TRADE_URL_REQUIRED",
      message: "Steam Trade URL is required for skin checkout",
    });
  }
}

export class CheckoutSteamIdentityRequiredError extends BadRequestException {
  readonly code = "STEAM_IDENTITY_REQUIRED";

  constructor() {
    super({
      statusCode: 400,
      code: "STEAM_IDENTITY_REQUIRED",
      message: "Steam identity is required for skin checkout",
    });
  }
}

export class CheckoutDeliveryEmailRequiredError extends BadRequestException {
  readonly code = "DELIVERY_EMAIL_REQUIRED";

  constructor() {
    super({
      statusCode: 400,
      code: "DELIVERY_EMAIL_REQUIRED",
      message: "A verified delivery email is required for Apple gift-card checkout",
    });
  }
}

export class CheckoutPriceChangedError extends ConflictException {
  readonly code = "CHECKOUT_PRICE_CHANGED";

  constructor(readonly acceptedTotalCoinMinor: number, readonly currentTotalCoinMinor: number) {
    super({
      statusCode: 409,
      code: "CHECKOUT_PRICE_CHANGED",
      message: "Checkout total increased; review the updated Coins price and confirm again",
      acceptedTotalCoinMinor,
      currentTotalCoinMinor,
    });
  }
}

function requireIdempotencyKey(value: string): string {
  const normalized = normalizeIdempotencyKey(value);
  if (normalized === undefined) throw new BadRequestException("Idempotency key is required");
  return normalized;
}

function requireAcceptedTotalCoinMinor(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException("Accepted checkout total is required");
  }
  return value;
}

function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 50) {
    throw new BadRequestException("Cart item quantity is invalid");
  }
}

function requestHash(command: CheckoutFromCartCommand): string {
  const normalized = {
    userId: command.userId,
    items: command.items.map((item) => ({
      ...(item.bundleId === undefined ? {} : { bundleId: item.bundleId }),
      productSlug: item.productSlug,
      quantity: item.quantity,
      recipient: item.recipient ?? {},
    })),
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

function uniqueSnapshots(lines: PreparedLine[]): CheckoutRecipientSnapshot[] {
  const seen = new Set<string>();
  const snapshots: CheckoutRecipientSnapshot[] = [];
  for (const line of lines) {
    const key = JSON.stringify(line.recipientSnapshot);
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(line.recipientSnapshot);
  }
  return snapshots;
}

function formatCoins(amountCoinMinor: number): string {
  return `${(amountCoinMinor / 100).toLocaleString("ru-RU")} Coins`;
}

function orderNumberFromId(orderId: string): string {
  return `VLT-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function recipientSlackLabel(snapshot: CheckoutRecipientSnapshot): string {
  if (snapshot.kind === "delivery-email") return snapshot.email;
  if (snapshot.kind === "steam-refill") return `Steam login ${snapshot.steamLogin}`;
  return `Steam ${snapshot.steamId64}`;
}

function summarizeOrderLinesForSlack(lines: readonly FulfillmentOrderLineInput[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line.title, (counts.get(line.title) ?? 0) + 1);
  const summary = [...counts.entries()].map(([title, count]) => `${count}x ${title}`);
  const visible = summary.slice(0, 5);
  const hiddenCount = summary.length - visible.length;
  return hiddenCount > 0 ? `${visible.join(", ")} +${hiddenCount}` : visible.join(", ");
}

function summarizeRecipientsForSlack(lines: readonly FulfillmentOrderLineInput[]): string {
  return [...new Set(lines.map((line) => recipientSlackLabel(line.recipientSnapshot)))].slice(0, 3).join(", ");
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BundlesService) private readonly bundles: BundlesService,
  ) {}

  async checkoutFromCart(command: CheckoutFromCartCommand): Promise<CheckoutOrderDto> {
    if (!Array.isArray(command.items) || command.items.length === 0) throw new BadRequestException("Cart is empty");
    const idempotencyKey = requireIdempotencyKey(command.idempotencyKey);
    const acceptedTotalCoinMinor = requireAcceptedTotalCoinMinor(command.acceptedTotalCoinMinor);
    const existingBeforeQuote = await this.findOrderByIdempotencyKey(this.database, command.userId, idempotencyKey);
    if (existingBeforeQuote !== null) {
      const hash = requestHash(command);
      if (existingBeforeQuote.request_hash !== hash) throw new ConflictException("Idempotency key is already used for a different checkout request");
      return this.loadOrder(this.database, existingBeforeQuote.id);
    }
    const user = await this.users.requireUser(command.userId);
    const lines = await this.prepareLines(command.userId, user.steam.steamId64, user.email?.address, command.items);
    const totalCoinMinor = lines.reduce((total, line) => total + line.unitPriceCoinMinor, 0);
    if (!Number.isSafeInteger(totalCoinMinor) || totalCoinMinor <= 0) {
      throw new BadRequestException("Cart total is invalid");
    }
    if (totalCoinMinor > acceptedTotalCoinMinor) {
      throw new CheckoutPriceChangedError(acceptedTotalCoinMinor, totalCoinMinor);
    }
    const hash = requestHash(command);
    return this.database.transaction(async (client) => {
      await this.wallet.lockUserBalance(client, command.userId);
      const existing = await this.findOrderByIdempotencyKey(client, command.userId, idempotencyKey);
      if (existing !== null) {
        if (existing.request_hash !== hash) throw new ConflictException("Idempotency key is already used for a different checkout request");
        return this.loadOrder(client, existing.id);
      }

      const order = await client.query<{ id: string }>(
        `
          INSERT INTO orders (user_id, idempotency_key, request_hash, status, total_coin_minor, recipient_snapshots)
          VALUES ($1, $2, $3, 'held', $4, $5::jsonb)
          RETURNING id
        `,
        [command.userId, idempotencyKey, hash, totalCoinMinor, JSON.stringify(uniqueSnapshots(lines))],
      );
      const orderId = order.rows[0]?.id;
      if (orderId === undefined) throw new Error("CHECKOUT_ORDER_NOT_CREATED");

      try {
        await this.wallet.createHold(client, {
          userId: command.userId,
          orderId,
          amountCoinMinor: totalCoinMinor,
          reason: "checkout",
        });
      } catch (error) {
        if (error instanceof WalletInsufficientFundsError) {
          throw new CheckoutInsufficientBalanceError(totalCoinMinor, error.balance.availableCoinMinor);
        }
        throw error;
      }

      const persistedLines: FulfillmentOrderLineInput[] = [];
      for (const line of lines) {
        const insertedLine = await client.query<{ id: string }>(
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
              status,
              bundle_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8::jsonb, 'held', $9)
            RETURNING id
          `,
          [
            orderId,
            line.lineIndex,
            line.productId,
            line.productSlug,
            line.kind,
            line.title,
            line.unitPriceCoinMinor,
            JSON.stringify(line.recipientSnapshot),
            line.bundleId ?? null,
          ],
        );
        const lineId = insertedLine.rows[0]?.id;
        if (lineId === undefined) throw new Error("CHECKOUT_ORDER_LINE_NOT_CREATED");
        persistedLines.push({
          id: lineId,
          productSlug: line.productSlug,
          kind: line.kind,
          title: line.title,
          unitPriceCoinMinor: line.unitPriceCoinMinor,
          recipientSnapshot: line.recipientSnapshot,
          ...(line.appleGiftCard ? { appleGiftCard: line.appleGiftCard } : {}),
        });
      }
      await this.fulfillment.enqueueOrderLineCommands(client, { orderId, lines: persistedLines });
      await this.enqueueVvAdminOrderCreatedEvent(client, {
        orderId,
        userId: command.userId,
        totalCoinMinor,
        lines: persistedLines,
      });
      await client.query(`
        INSERT INTO notification_outbox (channel, event_type, entity_id, idempotency_key, payload)
        VALUES ('slack', 'order.slack-alert', $1, $2, $3::jsonb)
        ON CONFLICT (channel, idempotency_key) DO NOTHING
      `, [
        orderId,
        `order-slack-alert/${orderId}`,
        JSON.stringify({
          amount: formatCoins(totalCoinMinor),
          itemSummary: summarizeOrderLinesForSlack(persistedLines),
          orderNumber: orderNumberFromId(orderId),
          recipientSummary: summarizeRecipientsForSlack(persistedLines),
        }),
      ]);

      return this.loadOrder(client, orderId);
    });
  }

  async replayServerCart(userId: string, key: string, acceptedTotalCoinMinor: number): Promise<CheckoutOrderDto | null> {
    requireAcceptedTotalCoinMinor(acceptedTotalCoinMinor);
    const existing = await this.findOrderByIdempotencyKey(this.database, userId, requireIdempotencyKey(key));
    if (existing === null) return null;
    if (existing.total_coin_minor > acceptedTotalCoinMinor) throw new CheckoutPriceChangedError(acceptedTotalCoinMinor, existing.total_coin_minor);
    return this.loadOrder(this.database, existing.id);
  }

  private async enqueueVvAdminOrderCreatedEvent(
    client: Queryable,
    input: {
      orderId: string;
      userId: string;
      totalCoinMinor: number;
      lines: FulfillmentOrderLineInput[];
    },
  ): Promise<void> {
    const now = new Date();
    const event = {
      schemaVersion: 2,
      eventId: `shards.order.${input.orderId}.created`,
      eventType: "order.created",
      source: "customer",
      occurredAt: now.toISOString(),
      site: { domain: new URL(this.config.integration.publicOrigin).hostname },
      subject: { type: "order", externalId: input.orderId },
      data: {
        externalOrderId: input.orderId,
        externalUserId: input.userId,
        status: "created",
        payment: {
          status: "paid",
          method: {
            type: "internal_balance",
            displayName: "Shards Coins",
            provider: null,
          },
          paidAt: now.toISOString(),
        },
        totalAmount: (input.totalCoinMinor / 100).toFixed(2),
        currency: "FC",
        createdAtExternal: now.toISOString(),
        paidAtExternal: now.toISOString(),
        items: input.lines.map((line) => ({
          externalItemId: line.id,
          name: line.title,
          marketHashName: line.productSlug,
          priceAmount: (line.unitPriceCoinMinor / 100).toFixed(2),
          currency: "FC",
        })),
      },
    };
    await client.query(
      `
        INSERT INTO vv_admin_integration_outbox (
          event_id,
          event_type,
          subject_type,
          subject_external_id,
          payload
        )
        VALUES ($1, 'order.created', 'order', $2, $3::jsonb)
        ON CONFLICT (event_id) DO NOTHING
      `,
      [event.eventId, input.orderId, JSON.stringify(event)],
    );
  }

  private async prepareLines(
    userId: string,
    steamId64: string | undefined,
    verifiedEmail: string | undefined,
    items: CheckoutCartItem[],
  ): Promise<PreparedLine[]> {
    const lines: PreparedLine[] = [];
    const products = await Promise.all(items.map(async (item) => {
      assertQuantity(item.quantity);
      if (parseSteamRefillAmountRub(item.productSlug) !== null) {
        throw new BadRequestException("Steam refill is paid through direct RUB checkout");
      }
      return this.catalog.getBySlug(item.productSlug);
    }));
    const bundlePrices = new Map<string, Map<string, number>>();
    const groups = new Map<string, CheckoutCartItem[]>();
    for (const item of items) {
      if (item.bundleId === undefined) continue;
      if (typeof item.bundleId !== "string" || item.quantity !== 1) throw new BadRequestException("Invalid bundle quantity");
      groups.set(item.bundleId, [...(groups.get(item.bundleId) ?? []), item]);
    }
    for (const [id, members] of groups) {
      const quote = await this.bundles.quote(id, members.map(item => item.productSlug));
      if (quote.availability !== "available") throw new BadRequestException("Bundle is unavailable");
      // Use the same catalog snapshots as the actual order lines, ordered canonically.
      const ordered = quote.items.map(member => {
        const product = products[items.findIndex(item => item.bundleId === id && item.productSlug === member.slug)];
        if (product === undefined) throw new BadRequestException("Invalid bundle member");
        return product;
      });
      const allocated = discountedBundlePrices(ordered.map(product => product.price.amountMinor));
      bundlePrices.set(id, new Map(ordered.map((product, index) => [product.slug, allocated[index] ?? 0])));
    }
    const tradeCredential = await this.requiredTradeCredentialIfNeeded(userId, products);
    for (const [itemIndex, item] of items.entries()) {
      const product = products[itemIndex];
      if (product === undefined) throw new BadRequestException("Cart item is invalid");
      if (product.availability !== "available") throw new BadRequestException("Product is not available");
      if (product.kind === "steam") throw new BadRequestException("Steam refill is paid through direct RUB checkout");
      if (product.kind === "skins" && steamId64 === undefined) throw new CheckoutSteamIdentityRequiredError();
      const recipientSnapshot: CheckoutRecipientSnapshot = product.kind === "skins"
        ? {
          kind: "steam-trade",
          steamId64: steamId64 ?? "",
          steamTradePartnerAccountId: tradeCredential?.partner ?? "",
        }
        : this.deliveryEmailRecipient(userId, verifiedEmail);
      if (recipientSnapshot.kind === "steam-trade" && recipientSnapshot.steamTradePartnerAccountId === "") {
        throw new CheckoutSteamTradeUrlRequiredError();
      }
      const unitPriceCoinMinor = item.bundleId === undefined ? product.price.amountMinor : bundlePrices.get(item.bundleId)?.get(product.slug);
      if (unitPriceCoinMinor === undefined || unitPriceCoinMinor <= 0) throw new BadRequestException("Invalid bundle price");
      for (let unit = 0; unit < item.quantity; unit += 1) {
        lines.push({
          lineIndex: lines.length,
          productId: product.id,
          productSlug: product.slug,
          kind: product.kind,
          title: product.title,
          quantity: 1,
          unitPriceCoinMinor,
          ...(item.bundleId === undefined ? {} : { bundleId: item.bundleId }),
          recipientSnapshot,
          ...(product.kind === "apple_gift_card" && product.details.appleGiftCard ? { appleGiftCard: product.details.appleGiftCard } : {}),
        });
      }
    }
    return lines;
  }

  private async requiredTradeCredentialIfNeeded(userId: string, products: CatalogProductDto[]): Promise<{ partner: string } | null> {
    if (!products.some((product) => product.kind === "skins")) return null;
    try {
      return await this.users.requireSteamTradeCredential(userId);
    } catch {
      throw new CheckoutSteamTradeUrlRequiredError();
    }
  }

  private deliveryEmailRecipient(userId: string, email: string | undefined): CheckoutRecipientSnapshot {
    if (!email) throw new CheckoutDeliveryEmailRequiredError();
    return { kind: "delivery-email", email, verificationId: userId };
  }

  private async findOrderByIdempotencyKey(client: Queryable, userId: string, idempotencyKey: string): Promise<OrderRow | null> {
    const result = await client.query<OrderRow>(
      `
        SELECT id, user_id, status, total_coin_minor, recipient_snapshots, request_hash
        FROM orders
        WHERE user_id = $1
          AND idempotency_key = $2
        LIMIT 1
      `,
      [userId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  private async loadOrder(client: Queryable, orderId: string): Promise<CheckoutOrderDto> {
    const order = await client.query<OrderRow>(
      `
        SELECT id, user_id, status, total_coin_minor, recipient_snapshots, request_hash
        FROM orders
        WHERE id = $1
        LIMIT 1
      `,
      [orderId],
    );
    const row = order.rows[0];
    if (row === undefined) throw new NotFoundException("Order not found");
    const lines = await client.query<OrderLineRow>(
      `
        SELECT id, product_slug, kind, title, quantity, unit_price_coin_minor, recipient_snapshot, bundle_id
        FROM order_lines
        WHERE order_id = $1
        ORDER BY line_index ASC
      `,
      [orderId],
    );
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      totalCoinMinor: row.total_coin_minor,
      recipientSnapshots: row.recipient_snapshots,
      lines: lines.rows.map((line) => ({
        id: line.id,
        ...(line.bundle_id ? { bundleId: line.bundle_id } : {}),
        productSlug: line.product_slug,
        kind: line.kind,
        title: line.title,
        quantity: 1,
        unitPriceCoinMinor: line.unit_price_coin_minor,
        recipientSnapshot: line.recipient_snapshot,
      })),
    };
  }
}
