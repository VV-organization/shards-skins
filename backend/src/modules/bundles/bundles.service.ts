import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database/database.service";
import { CatalogService } from "../catalog/catalog.service";
import type { CatalogProductDto } from "../catalog/catalog.types";

export const BUNDLE_DEFINITIONS = {
  mono: ["USP-S | Printstream", "AK-47 | Asiimov", "Karambit | Blue Steel"],
  chroma: ["Galil AR | Sugar Rush", "Karambit | Fade", "Glock-18 | Gamma Doppler"],
  metal: ["AK-47 | X-Ray", "M9 Bayonet | Tiger Tooth", "Hydra Gloves | Rattler"],
} as const;
export type BundleId = keyof typeof BUNDLE_DEFINITIONS;
export type BundleDto = {
  id: BundleId;
  title: string;
  items: CatalogProductDto[];
  originalTotalCoinMinor: number;
  totalCoinMinor: number;
  discountPercent: 5;
  availability: "available" | "on-request";
};

export function requireBundleId(id: string): BundleId {
  if (!Object.hasOwn(BUNDLE_DEFINITIONS, id)) throw new BadRequestException("Unknown bundle");
  return id as BundleId;
}

export function bundleMarketName(value: string): string {
  return value.replace(/^★ /u, "").replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/, "");
}

// Enumerate the exact names accepted by bundleMarketName so PostgreSQL can use
// catalog_products_supplier_item_idx instead of normalizing the entire catalog.
export function bundleSupplierNames(members: readonly string[]): string[] {
  const wears = ["", "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
  return members.flatMap(member => ["", "★ "].flatMap(prefix =>
    wears.map(wear => `${prefix}${member}${wear ? ` (${wear})` : ""}`),
  ));
}

// Round the bundle total once, then distribute residual cents by largest remainder.
// Every persisted fulfillment line therefore owns exactly its part of the wallet hold.
export function discountedBundlePrices(prices: readonly number[]): number[] {
  if (prices.length !== 3 || prices.some(price => !Number.isSafeInteger(price) || price <= 0)) {
    throw new BadRequestException("Invalid bundle prices");
  }
  const scaled = prices.map(price => BigInt(price) * 95n);
  const result = scaled.map(price => Number(price / 100n));
  const target = Number((scaled.reduce((sum, price) => sum + price, 0n) + 50n) / 100n);
  if (!Number.isSafeInteger(target)) throw new BadRequestException("Bundle total overflow");
  let remaining = target - result.reduce((sum, price) => sum + price, 0);
  const indices = [0, 1, 2].sort((a, b) => Number(((scaled[b] ?? 0n) % 100n) - ((scaled[a] ?? 0n) % 100n)) || a - b);
  for (const index of indices) {
    if (remaining-- <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
  }
  if (result.some(price => price <= 0)) throw new BadRequestException("Bundle price is too small");
  return result;
}

@Injectable()
export class BundlesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async list(): Promise<{ bundles: BundleDto[] }> {
    return { bundles: await Promise.all(Object.keys(BUNDLE_DEFINITIONS).map(id => this.quote(id))) };
  }

  async quote(value: string, productSlugs?: readonly string[]): Promise<BundleDto> {
    const id = requireBundleId(value);
    const members = BUNDLE_DEFINITIONS[id];
    const rows = await this.database.query<{ slug: string; supplier_item_id: string }>(`
      SELECT p.slug, p.supplier_item_id FROM catalog_products p
      JOIN supplier_listings s ON s.supplier = 'sih' AND s.game = 'cs2'
        AND s.market_hash_name = p.supplier_item_id AND s.active = true
      WHERE p.public_enabled = true AND p.kind = 'skins' AND lower(p.game) = 'cs2'
        AND p.supplier_provider = 'sih' AND p.availability = 'available'
        AND s.price_microusd > 0 AND s.available_quantity > 0
        AND ($1::text[] IS NULL OR p.slug = ANY($1::text[]))
        AND p.supplier_item_id = ANY($2::text[])
      ORDER BY s.price_microusd ASC, p.slug ASC
    `, [productSlugs ?? null, bundleSupplierNames(members)]);
    const selected = members.map(member => rows.rows.find(row => bundleMarketName(row.supplier_item_id) === member));
    if (productSlugs !== undefined && (productSlugs.length !== 3 || new Set(productSlugs).size !== 3 || selected.some(row => row === undefined))) {
      throw new BadRequestException("Bundle members are invalid or unavailable");
    }
    const items = await Promise.all(selected.flatMap(row => row ? [this.catalog.getBySlug(row.slug)] : []));
    const available = items.length === 3 && items.every(item => item.availability === "available");
    const originalTotalCoinMinor = items.reduce((sum, item) => sum + item.price.amountMinor, 0);
    return {
      id, title: id.toUpperCase(), items, originalTotalCoinMinor,
      totalCoinMinor: available ? discountedBundlePrices(items.map(item => item.price.amountMinor)).reduce((sum, price) => sum + price, 0) : 0,
      discountPercent: 5, availability: available ? "available" : "on-request",
    };
  }
}
