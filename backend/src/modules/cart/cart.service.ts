import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { BundlesService, requireBundleId, type BundleDto } from "../bundles/bundles.service";
import { DatabaseService } from "../../common/database/database.service";
import { CatalogService } from "../catalog/catalog.service";
import { parseSteamRefillAmountRub } from "../catalog/steam-refill-product";
import type { CatalogProductDto } from "../catalog/catalog.types";
import type { CheckoutCartItem } from "../checkout/checkout.service";

type CartItemRow = {
  product_slug: string;
  quantity: number;
  recipient: Record<string, unknown>;
};

export type CartRecipient = {
  steamLogin?: string;
};

export type CartItemDto = {
  productId: string;
  productSlug: string;
  kind: CatalogProductDto["kind"];
  title: string;
  quantity: number;
  unitPriceCoinMinor: number;
  lineTotalCoinMinor: number;
  recipient: CartRecipient;
};

export type CartDto = {
  items: CartItemDto[];
  bundles: BundleDto[];
  totalCoinMinor: number;
};

export type SetCartItemCommand = {
  userId: string;
  productSlug: string;
  quantity: number;
  recipient?: CartRecipient;
};

function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 50) {
    throw new BadRequestException("Cart item quantity is invalid");
  }
}

function normalizeRecipient(value: CartRecipient | undefined): CartRecipient {
  const steamLogin = value?.steamLogin?.trim();
  return steamLogin ? { steamLogin } : {};
}

function isCartRecipient(value: unknown): value is CartRecipient {
  return typeof value === "object" && value !== null && (
    !("steamLogin" in value) || typeof (value as { steamLogin?: unknown }).steamLogin === "string"
  );
}

@Injectable()
export class CartService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(BundlesService) private readonly bundles: BundlesService,
  ) {}

  async getCart(userId: string): Promise<CartDto> {
    const cartId = await this.ensureActiveCart(userId);
    return this.loadCart(cartId);
  }

  async setItem(command: SetCartItemCommand): Promise<CartDto> {
    assertQuantity(command.quantity);
    if (parseSteamRefillAmountRub(command.productSlug) !== null) {
      throw new BadRequestException("Steam refill is paid through direct RUB checkout");
    }
    const product = await this.catalog.getBySlug(command.productSlug);
    if (product.kind === "steam") {
      throw new BadRequestException("Steam refill is paid through direct RUB checkout");
    }
    const cartId = await this.ensureActiveCart(command.userId);
    await this.database.query(
      `
        INSERT INTO cart_items (cart_id, product_slug, quantity, recipient)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (cart_id, product_slug) DO UPDATE
        SET quantity = EXCLUDED.quantity,
            recipient = EXCLUDED.recipient,
            updated_at = clock_timestamp()
      `,
      [cartId, command.productSlug, command.quantity, JSON.stringify(normalizeRecipient(command.recipient))],
    );
    await this.touchCart(cartId);
    return this.loadCart(cartId);
  }

  async removeItem(userId: string, productSlug: string): Promise<CartDto> {
    const cartId = await this.ensureActiveCart(userId);
    await this.database.query("DELETE FROM cart_items WHERE cart_id = $1 AND product_slug = $2", [cartId, productSlug]);
    await this.touchCart(cartId);
    return this.loadCart(cartId);
  }

  async clearCart(userId: string): Promise<CartDto> {
    const cartId = await this.ensureActiveCart(userId);
    await this.database.transaction(async client => {
      await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);
      await client.query("DELETE FROM cart_bundles WHERE cart_id = $1", [cartId]);
    });
    await this.touchCart(cartId);
    return this.loadCart(cartId);
  }

  async clearPurchasedCart(userId: string, orderId: string): Promise<void> {
    // Retry cleanup only for entries represented by this order. Mutations made
    // after its creation remain in the cart, even when the same SKU is added again.
    const cartId = await this.ensureActiveCart(userId);
    await this.database.transaction(async client => {
      await client.query(`DELETE FROM cart_items c USING orders o
        WHERE c.cart_id = $1 AND o.id = $2 AND o.user_id = $3
          AND c.updated_at <= o.created_at
          AND c.quantity = (SELECT count(*) FROM order_lines l
            WHERE l.order_id = o.id AND l.bundle_id IS NULL AND l.product_slug = c.product_slug)`,
        [cartId, orderId, userId]);
      await client.query(`DELETE FROM cart_bundles c USING orders o
        WHERE c.cart_id = $1 AND o.id = $2 AND o.user_id = $3
          AND c.created_at <= o.created_at
          AND (SELECT jsonb_agg(l.product_slug ORDER BY l.product_slug) FROM order_lines l
            WHERE l.order_id = o.id AND l.bundle_id = c.bundle_id)
            = (SELECT jsonb_agg(s ORDER BY s) FROM jsonb_array_elements_text(c.product_slugs) s)`,
        [cartId, orderId, userId]);
      await client.query("UPDATE carts SET updated_at = clock_timestamp() WHERE id = $1", [cartId]);
    });
  }

  async getCheckoutItems(userId: string): Promise<CheckoutCartItem[]> {
    const cartId = await this.ensureActiveCart(userId);
    await this.removeSteamRefillItems(cartId);
    const result = await this.database.query<CartItemRow>(
      `
        SELECT product_slug, quantity, recipient
        FROM cart_items
        WHERE cart_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [cartId],
    );
    const items: CheckoutCartItem[] = result.rows.map((row) => ({
      productSlug: row.product_slug,
      quantity: row.quantity,
      recipient: isCartRecipient(row.recipient) ? row.recipient : {},
    }));
    const groups = await this.database.query<{ bundle_id: string; product_slugs: string[] }>(
      "SELECT bundle_id, product_slugs FROM cart_bundles WHERE cart_id = $1 ORDER BY bundle_id", [cartId],
    );
    return [...items, ...groups.rows.flatMap(group => group.product_slugs.map(productSlug => ({ productSlug, quantity: 1, bundleId: group.bundle_id })))];
  }

  async setBundle(userId: string, bundleId: string): Promise<CartDto> {
    const quote = await this.bundles.quote(bundleId);
    if (quote.availability !== "available") throw new BadRequestException("Bundle is unavailable");
    const cartId = await this.ensureActiveCart(userId);
    await this.database.query(`INSERT INTO cart_bundles (cart_id, bundle_id, product_slugs, quote_snapshot)
      VALUES ($1, $2, $3::jsonb, $4::jsonb) ON CONFLICT (cart_id, bundle_id) DO NOTHING`,
      [cartId, quote.id, JSON.stringify(quote.items.map(item => item.slug)), JSON.stringify(quote)]);
    await this.touchCart(cartId);
    return this.loadCart(cartId);
  }

  async removeBundle(userId: string, bundleId: string): Promise<CartDto> {
    requireBundleId(bundleId);
    const cartId = await this.ensureActiveCart(userId);
    await this.database.query("DELETE FROM cart_bundles WHERE cart_id = $1 AND bundle_id = $2", [cartId, bundleId]);
    await this.touchCart(cartId);
    return this.loadCart(cartId);
  }

  private async ensureActiveCart(userId: string): Promise<string> {
    const result = await this.database.query<{ id: string }>(
      `
        INSERT INTO carts (user_id, status)
        VALUES ($1, 'active')
        ON CONFLICT (user_id, status) DO UPDATE
        SET updated_at = carts.updated_at
        RETURNING id
      `,
      [userId],
    );
    const cartId = result.rows[0]?.id;
    if (cartId === undefined) throw new Error("CART_NOT_CREATED");
    return cartId;
  }

  private async touchCart(cartId: string): Promise<void> {
    await this.database.query("UPDATE carts SET updated_at = clock_timestamp() WHERE id = $1", [cartId]);
  }

  private async removeSteamRefillItems(cartId: string): Promise<void> {
    const result = await this.database.query(
      `
        DELETE FROM cart_items
        WHERE cart_id = $1
          AND (
            product_slug IN (
              SELECT slug
              FROM catalog_products
              WHERE kind = 'steam'
            )
            OR product_slug ~ '^steam-top-up-[1-9][0-9]*-rub$'
          )
      `,
      [cartId],
    );
    if ((result.rowCount ?? 0) > 0) await this.touchCart(cartId);
  }

  private async loadCart(cartId: string): Promise<CartDto> {
    await this.removeSteamRefillItems(cartId);
    const result = await this.database.query<CartItemRow>(
      `
        SELECT product_slug, quantity, recipient
        FROM cart_items
        WHERE cart_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [cartId],
    );
    const items = await Promise.all(result.rows.map(async (row): Promise<CartItemDto> => {
      const product = await this.catalog.getBySlug(row.product_slug);
      const lineTotalCoinMinor = product.price.amountMinor * row.quantity;
      return {
        productId: product.id,
        productSlug: product.slug,
        kind: product.kind,
        title: product.title,
        quantity: row.quantity,
        unitPriceCoinMinor: product.price.amountMinor,
        lineTotalCoinMinor,
        recipient: isCartRecipient(row.recipient) ? row.recipient : {},
      };
    }));
    const groups = await this.database.query<{ bundle_id: string; product_slugs: string[]; quote_snapshot: BundleDto }>(
      "SELECT bundle_id, product_slugs, quote_snapshot FROM cart_bundles WHERE cart_id = $1 ORDER BY bundle_id", [cartId],
    );
    const bundles = await Promise.all(groups.rows.map(async (group): Promise<BundleDto> => {
      try { return await this.bundles.quote(group.bundle_id, group.product_slugs); }
      catch (error) {
        if (!(error instanceof BadRequestException || error instanceof NotFoundException)) throw error;
        // Keep the original group visible and removable when supplier stock disappears.
        return { ...group.quote_snapshot, availability: "on-request" };
      }
    }));
    return {
      items,
      bundles,
      totalCoinMinor: items.reduce((total, item) => total + item.lineTotalCoinMinor, 0) + bundles.reduce((total, bundle) => total + bundle.totalCoinMinor, 0),
    };
  }
}
