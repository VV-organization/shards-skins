import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import { CATALOG_GAMES, getCatalogGameDefinition, parseCatalogGame, type CatalogGame } from "./catalog-game";
import { CatalogPricingService } from "./catalog-pricing.service";
import { parseAppleGiftCardDetails } from "./apple-gift-card";
import type {
  CatalogFacetOption,
  CatalogFacetsDto,
  CatalogListDto,
  CatalogListQuery,
  CatalogProduct,
  CatalogProductDto,
  CatalogProductKind,
  CatalogSort,
} from "./catalog.types";
import { parseSteamRefillAmountRub } from "./steam-refill-product";

const allowedKinds = new Set<CatalogProductKind>(["apple_gift_card", "skins", "steam"]);
const defaultCatalogLimit = 120;
const maxCatalogLimit = 240;
const coinRateFiatMinor = 100;
const coinRateCoinMinor = 160;
const appleGiftCardRubRates: Record<string, { rateRubScaled: number; unit: number }> = {
  AED: { rateRubScaled: 230_211, unit: 1 },
  BRL: { rateRubScaled: 163_038, unit: 1 },
  CAD: { rateRubScaled: 606_578, unit: 1 },
  CHF: { rateRubScaled: 1_039_146, unit: 1 },
  CNY: { rateRubScaled: 124_789, unit: 1 },
  EUR: { rateRubScaled: 975_141, unit: 1 },
  GBP: { rateRubScaled: 1_141_948, unit: 1 },
  INR: { rateRubScaled: 885_971, unit: 100 },
  JPY: { rateRubScaled: 530_461, unit: 100 },
  KZT: { rateRubScaled: 181_743, unit: 100 },
  NOK: { rateRubScaled: 887_620, unit: 10 },
  NZD: { rateRubScaled: 495_137, unit: 1 },
  PLN: { rateRubScaled: 226_662, unit: 1 },
  RUB: { rateRubScaled: 10_000, unit: 1 },
  TRY: { rateRubScaled: 177_136, unit: 10 },
  USD: { rateRubScaled: 845_449, unit: 1 },
};
const supplierPricingJoin = `
        LEFT JOIN LATERAL (
          SELECT
            pricing_settings.id,
            pricing_settings.supplier_to_fiat_rate_minor,
            pricing_settings.coin_rate_numerator,
            pricing_settings.coin_rate_denominator,
            pricing_settings.markup_bps,
            pricing_settings.min_price_coin_minor,
            pricing_settings.round_to_coin_minor
          FROM pricing_settings
          WHERE pricing_settings.scope = 'sih-skins'
            AND pricing_settings.superseded_at IS NULL
          ORDER BY pricing_settings.valid_from DESC, pricing_settings.created_at DESC, pricing_settings.id DESC
          LIMIT 1
        ) AS active_pricing_settings ON supplier_listings.price_microusd IS NOT NULL
`;
const supplierQuotedCoinMinorSql = `
          (
            (
              GREATEST(
                (
                  (
                    (
                      (
                        (supplier_listings.price_microusd::bigint * active_pricing_settings.supplier_to_fiat_rate_minor::bigint + 1000000 - 1)
                        / 1000000
                      )
                      * (10000 + active_pricing_settings.markup_bps)::bigint + 10000 - 1
                    )
                    / 10000
                  )
                  * active_pricing_settings.coin_rate_numerator::bigint * 2 + active_pricing_settings.coin_rate_denominator::bigint
                )
                / (active_pricing_settings.coin_rate_denominator::bigint * 2),
                active_pricing_settings.min_price_coin_minor::bigint
              )
              + active_pricing_settings.round_to_coin_minor::bigint - 1
            )
            / active_pricing_settings.round_to_coin_minor::bigint
          )
          * active_pricing_settings.round_to_coin_minor::bigint
`;
const effectivePriceCoinMinorSql = `
          COALESCE(
            CASE
              WHEN supplier_listings.price_microusd IS NOT NULL AND active_pricing_settings.id IS NOT NULL
                THEN ${supplierQuotedCoinMinorSql}
              ELSE NULL
            END,
            catalog_products.price_coin_minor::bigint
          )
`;
const relatedTerms: Record<CatalogProductKind, string[]> = {
  apple_gift_card: ["apple", "app store", "itunes", "подарочная карта", "подарочный код"],
  steam: ["steam", "стим", "пополнение", "баланс", "кошелек"],
  skins: ["скин", "скины", "предмет", "предметы", "cs2", "rust", "раст", "tf2", "team fortress"],
};
const gameSearchTerms: Record<CatalogGame, string[]> = {
  cs2: ["cs2", "кс", "counter-strike", "counter strike"],
  rust: ["rust", "раст"],
  tf2: ["tf2", "team fortress", "team fortress 2"],
};

type LoadedCatalogProduct = CatalogProduct & {
  priceCoinMinor?: number;
  supplierPriceMicrousd?: string;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function arrayQuery(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function numberQuery(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function limitQuery(value: string | undefined): number {
  const parsed = numberQuery(value);
  if (parsed === undefined) return defaultCatalogLimit;
  if (!Number.isSafeInteger(parsed) || parsed < 1) return defaultCatalogLimit;
  return Math.min(parsed, maxCatalogLimit);
}

function offsetQuery(value: string | undefined): number {
  const parsed = numberQuery(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed)) return 0;
  return Math.max(0, parsed);
}

function sortQuery(value: string | undefined): CatalogSort {
  switch (value) {
    case undefined:
    case "":
    case "relevance":
      return "relevance";
    case "price_asc":
    case "price-asc":
      return "price_asc";
    case "price_desc":
    case "price-desc":
      return "price_desc";
    case "newest":
      return "newest";
    case "name_asc":
      return "name_asc";
    case "name_desc":
      return "name_desc";
    default:
      return "relevance";
  }
}

function gameFromSearch(query: string): CatalogGame | undefined {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return undefined;
  return CATALOG_GAMES.find((game) => gameSearchTerms[game].some((term) => normalize(term) === normalizedQuery));
}

function priceDto(amountMinor: number) {
  return {
    currency: "COINS" as const,
    amountMinor,
    scale: 2 as const,
    display: amountMinor % 100 === 0
      ? `${(amountMinor / 100).toLocaleString("ru-RU")} Shards`
      : `${(amountMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Shards`,
  };
}

function priceCoinMinor(product: LoadedCatalogProduct): number {
  return product.priceCoinMinor ?? product.priceCoins * 100;
}

function appleGiftCardPriceCoinMinor(amountMinor: number, details: NonNullable<CatalogProduct["details"]>): number {
  const card = details.appleGiftCard;
  if (card === undefined) return amountMinor;
  const rate = appleGiftCardRubRates[card.currency];
  if (rate === undefined) return Math.max(amountMinor, card.nominalMinor);
  const rubMinor = Math.ceil((card.nominalMinor * rate.rateRubScaled) / (rate.unit * 10_000));
  const minimumCoinMinor = Math.ceil((rubMinor * coinRateCoinMinor) / coinRateFiatMinor);
  return Math.max(amountMinor, minimumCoinMinor);
}

function productDescription(product: LoadedCatalogProduct): string {
  if (product.kind !== "apple_gift_card") return product.description;
  return product.description
    .replace(/\s*Код вручную отправит команда Shards(?: на подтверждённый email)? после оплаты\./u, "")
    .trim();
}

function productDto(product: LoadedCatalogProduct): CatalogProductDto {
  const details = product.kind === "apple_gift_card"
    ? parseAppleGiftCardDetails(product.details)
    : product.details;
  if (details === null) throw new Error("APPLE_GIFT_CARD_DETAILS_INVALID");
  const amountMinor = product.kind === "apple_gift_card"
    ? appleGiftCardPriceCoinMinor(priceCoinMinor(product), details)
    : priceCoinMinor(product);
  return {
    id: product.id,
    slug: product.slug,
    kind: product.kind,
    category: product.category,
    ...(product.game === undefined ? {} : { game: product.game }),
    productType: product.productType,
    title: product.title,
    description: productDescription(product),
    availability: product.availability,
    fulfillmentMode: product.fulfillmentMode,
    createdAt: product.createdAt,
    popularity: product.popularity,
    ...(product.image === undefined ? {} : { image: product.image }),
    ...(product.imageAlt === undefined ? {} : { imageAlt: product.imageAlt }),
    meta: product.meta,
    keywords: product.keywords,
    details,
    price: priceDto(amountMinor),
  };
}

function searchableText(product: CatalogProduct): string {
  return [
    product.title,
    product.description,
    product.category,
    product.game ?? "",
    product.productType,
    product.kind,
    ...product.meta,
    ...product.keywords,
    ...relatedTerms[product.kind],
  ]
    .map(normalize)
    .join(" ");
}

function matchesQuery(product: CatalogProduct, query: string): boolean {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  const exactGame = gameFromSearch(normalizedQuery);
  if (exactGame) return normalize(product.game ?? "") === exactGame;
  const haystack = searchableText(product);
  return normalizedQuery.split(/\s+/).filter(Boolean).every((term) => {
    if (term === "steam") return product.kind === "steam";
    return haystack.includes(term);
  });
}

function relevance(product: CatalogProduct, query: string): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return product.popularity;
  const title = normalize(product.title);
  const classification = normalize([product.category, product.game ?? "", product.productType].join(" "));
  const details = searchableText(product);
  return (
    (title.includes(normalizedQuery) ? 50 : 0)
    + (classification.includes(normalizedQuery) ? 20 : 0)
    + (details.includes(normalizedQuery) ? 10 : 0)
    + product.popularity / 100
  );
}

function facetOptionsFromValues(values: Array<string | null | undefined>): CatalogFacetOption[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, "ru-RU"))
    .map((value) => ({ id: value, title: value }));
}

function emptyCatalogFacets(): CatalogFacetsDto {
  return {
    kinds: [],
    games: [],
    productTypes: [],
    conditions: [],
    fulfillmentModes: [],
    availability: [],
  };
}

function catalogPricingDto(): CatalogListDto["pricing"] {
  return {
    coinRate: {
      fiatCurrency: "RUB",
      fiatMinor: 100,
      coinMinor: 150,
      display: "1 RUB = 1.6 Shards",
    },
  };
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogPricingService)
    private readonly pricing: CatalogPricingService,
  ) {}

  async list(query: CatalogListQuery): Promise<CatalogListDto> {
    const category = allowedKinds.has(query.category as CatalogProductKind) ? query.category as CatalogProductKind : undefined;
    const types = arrayQuery(query.type).map(normalize);
    const conditions = arrayQuery(query.condition).map(normalize);
    const min = numberQuery(query.min);
    const max = numberQuery(query.max);
    const minPrice = min !== undefined && max !== undefined && min > max ? max : min;
    const maxPrice = min !== undefined && max !== undefined && min > max ? min : max;
    const minPriceCoinMinor = minPrice === undefined ? undefined : minPrice * 100;
    const maxPriceCoinMinor = maxPrice === undefined ? undefined : maxPrice * 100;
    const sort = sortQuery(query.sort);
    const search = query.q ?? "";
    const game = this.gameFilter(query);
    const limit = limitQuery(query.limit);
    const offset = offsetQuery(query.offset);
    if (category === "steam") {
      return {
        items: [],
        facets: emptyCatalogFacets(),
        pagination: {
          limit,
          offset,
          total: 0,
          hasMore: false,
        },
        pricing: catalogPricingDto(),
      };
    }
    const [products, catalogFacets, total] = await Promise.all([
      this.loadProducts({
        ...(category === undefined ? {} : { category }),
        ...(game === undefined ? {} : { game }),
        conditions,
        ...(minPriceCoinMinor === undefined ? {} : { minPriceCoinMinor }),
        ...(maxPriceCoinMinor === undefined ? {} : { maxPriceCoinMinor }),
        search,
        types,
        limit,
        offset,
        sort,
      }),
      this.loadFacets({
        ...(category === undefined ? {} : { category }),
        ...(game === undefined ? {} : { game }),
        search,
      }),
      this.countProducts({
        ...(category === undefined ? {} : { category }),
        ...(game === undefined ? {} : { game }),
        conditions,
        ...(minPriceCoinMinor === undefined ? {} : { minPriceCoinMinor }),
        ...(maxPriceCoinMinor === undefined ? {} : { maxPriceCoinMinor }),
        search,
        types,
      }),
    ]);

    const items = products
      .filter((product) => minPriceCoinMinor === undefined || priceCoinMinor(product) >= minPriceCoinMinor)
      .filter((product) => maxPriceCoinMinor === undefined || priceCoinMinor(product) <= maxPriceCoinMinor)
      .filter((product) => matchesQuery(product, search))
      .sort((left, right) => {
        if (sort === "price_asc") return priceCoinMinor(left) - priceCoinMinor(right);
        if (sort === "price_desc") return priceCoinMinor(right) - priceCoinMinor(left);
        if (sort === "newest") return Date.parse(right.createdAt) - Date.parse(left.createdAt);
        if (sort === "name_asc") return left.title.localeCompare(right.title, "ru-RU");
        if (sort === "name_desc") return right.title.localeCompare(left.title, "ru-RU");
        return relevance(right, search) - relevance(left, search) || left.id.localeCompare(right.id);
      })
      .slice(0, limit);

    const quotedItems = await Promise.all(items.map((product) => this.withLivePrice(product)));

    return {
      items: quotedItems.map(productDto),
      facets: catalogFacets,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + items.length < total,
      },
      pricing: catalogPricingDto(),
    };
  }

  async getBySlug(slug: string): Promise<CatalogProductDto> {
    if (parseSteamRefillAmountRub(slug) !== null) throw new NotFoundException("Product not found");

    const product = (await this.loadProducts({ slug, limit: 1 }))[0];
    if (!product) throw new NotFoundException("Product not found");
    return productDto(await this.withLivePrice(product));
  }

  private async withLivePrice(product: LoadedCatalogProduct): Promise<LoadedCatalogProduct> {
    if (product.supplierPriceMicrousd === undefined) return product;
    const livePrice = await this.pricing.quoteSupplierPrice({
      scope: "sih-skins",
      supplierAmountMicrounit: BigInt(product.supplierPriceMicrousd),
    });
    return { ...product, priceCoinMinor: livePrice.amountMinor };
  }

  private async loadProducts(command: {
    category?: CatalogProductKind;
    conditions?: string[];
    game?: CatalogGame;
    limit?: number;
    maxPriceCoinMinor?: number;
    minPriceCoinMinor?: number;
    offset?: number;
    search?: string;
    slug?: string;
    sort?: CatalogSort;
    types?: string[];
  } = {}): Promise<LoadedCatalogProduct[]> {
    const { params, where } = this.catalogWhere(command);
    if (command.minPriceCoinMinor !== undefined) {
      params.push(command.minPriceCoinMinor);
      where.push(`${effectivePriceCoinMinorSql} >= $${params.length}`);
    }
    if (command.maxPriceCoinMinor !== undefined) {
      params.push(command.maxPriceCoinMinor);
      where.push(`${effectivePriceCoinMinorSql} <= $${params.length}`);
    }
    const limit = Math.min(command.limit ?? maxCatalogLimit, maxCatalogLimit * 4);
    params.push(limit);
    const limitParam = params.length;
    const offset = Math.max(0, command.offset ?? 0);
    params.push(offset);
    const offsetParam = params.length;
    const orderBy = (() => {
      if (command.sort === "price_asc") {
        return `${effectivePriceCoinMinorSql} ASC, catalog_products.id ASC`;
      }
      if (command.sort === "price_desc") {
        return `${effectivePriceCoinMinorSql} DESC, catalog_products.id ASC`;
      }
      if (command.sort === "name_asc") {
        return "lower(catalog_products.title) ASC, catalog_products.id ASC";
      }
      if (command.sort === "name_desc") {
        return "lower(catalog_products.title) DESC, catalog_products.id ASC";
      }
      if (command.sort === "newest") {
        return "catalog_products.created_at DESC, catalog_products.popularity DESC, catalog_products.id ASC";
      }
      return "catalog_products.popularity DESC, catalog_products.created_at DESC, catalog_products.id ASC";
    })();
    const result = await this.database.query<{
      id: string;
      slug: string;
      kind: CatalogProductKind;
      category: string;
      game: string | null;
      product_type: string;
      title: string;
      description: string;
      price_coin_minor: number;
      effective_price_coin_minor: string;
      availability: CatalogProduct["availability"];
      fulfillment_mode: CatalogProduct["fulfillmentMode"];
      created_at: Date;
      popularity: number;
      image: string | null;
      image_alt: string | null;
      meta: string[];
      keywords: string[];
      details: CatalogProduct["details"];
      supplier_price_microusd: string | null;
    }>(
      `
        SELECT
          catalog_products.id,
          catalog_products.slug,
          catalog_products.kind,
          catalog_products.category,
          catalog_products.game,
          catalog_products.product_type,
          catalog_products.title,
          catalog_products.description,
          catalog_products.price_coin_minor,
          ${effectivePriceCoinMinorSql}::text AS effective_price_coin_minor,
          catalog_products.availability,
          catalog_products.fulfillment_mode,
          catalog_products.created_at,
          catalog_products.popularity,
          catalog_products.image,
          catalog_products.image_alt,
          catalog_products.meta,
          catalog_products.keywords,
          catalog_products.details,
          supplier_listings.price_microusd::text AS supplier_price_microusd
        FROM catalog_products
        LEFT JOIN supplier_listings
          ON catalog_products.supplier_provider = 'sih'
          AND supplier_listings.supplier = 'sih'
          AND supplier_listings.game = lower(catalog_products.game)
          AND supplier_listings.market_hash_name = catalog_products.supplier_item_id
          AND supplier_listings.active = true
${supplierPricingJoin}
        WHERE ${where.join("\n          AND ")}
        ORDER BY ${orderBy}
        LIMIT $${limitParam}
        OFFSET $${offsetParam}
      `,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      category: row.category,
      ...(row.game === null ? {} : { game: row.game }),
      productType: row.product_type,
      title: row.title,
      description: row.description,
      priceCoins: Math.floor(Number(row.effective_price_coin_minor) / 100),
      priceCoinMinor: Number(row.effective_price_coin_minor),
      availability: row.availability,
      fulfillmentMode: row.fulfillment_mode,
      createdAt: row.created_at.toISOString(),
      popularity: row.popularity,
      ...(row.image === null ? {} : { image: row.image }),
      ...(row.image_alt === null ? {} : { imageAlt: row.image_alt }),
      meta: row.meta,
      keywords: row.keywords,
      details: row.details,
      ...(row.supplier_price_microusd === null ? {} : { supplierPriceMicrousd: row.supplier_price_microusd }),
    }));
  }

  private catalogWhere(command: {
    category?: CatalogProductKind;
    conditions?: string[];
    game?: CatalogGame;
    maxPriceCoinMinor?: number;
    minPriceCoinMinor?: number;
    search?: string;
    slug?: string;
    types?: string[];
  }) {
    const params: Array<number | string> = [];
    const where = [
      "catalog_products.public_enabled = true",
      "catalog_products.kind = 'skins'",
      "lower(catalog_products.game) = 'cs2'",
    ];
    if (command.category !== undefined) {
      params.push(command.category);
      where.push(`catalog_products.kind = $${params.length}`);
    } else if (command.slug === undefined) {
      where.push("catalog_products.kind = 'skins'");
    }
    if (command.game !== undefined) {
      params.push(command.game);
      where.push(`lower(coalesce(catalog_products.game, '')) = $${params.length}`);
    }
    if (command.slug !== undefined) {
      params.push(command.slug);
      where.push(`catalog_products.slug = $${params.length}`);
    }
    const typeFilters = command.types ?? [];
    if (typeFilters.length > 0) {
      const conditions = typeFilters.map((type) => {
        params.push(`%${type}%`);
        return `lower(catalog_products.product_type) LIKE $${params.length}`;
      });
      where.push(`(${conditions.join(" OR ")})`);
    }
    const conditionFilters = command.conditions ?? [];
    if (conditionFilters.length > 0) {
      const conditions = conditionFilters.map((condition) => {
        params.push(`%${condition}%`);
        return `(
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(catalog_products.details -> 'specifications') AS specification(value)
            WHERE lower(specification.value ->> 'label') = 'состояние'
              AND lower(specification.value ->> 'value') LIKE $${params.length}
          )
          OR lower(array_to_string(catalog_products.meta, ' ')) LIKE $${params.length}
        )`;
      });
      where.push(`(${conditions.join(" OR ")})`);
    }
    const search = normalize(command.search ?? "");
    if (search) {
      const exactGame = gameFromSearch(search);
      if (exactGame !== undefined) {
        params.push(exactGame);
        where.push(`lower(coalesce(catalog_products.game, '')) = $${params.length}`);
      } else {
        for (const term of search.split(/\s+/).filter(Boolean)) {
          if (term === "steam") {
            where.push("catalog_products.kind = 'steam'");
            continue;
          }
          if (["скин", "скины", "предмет", "предметы"].includes(term)) {
            where.push("catalog_products.kind = 'skins'");
            continue;
          }
          if (["автомат", "пистолет", "нож", "перчатки", "наклейка"].includes(term)) {
            params.push(`%${term}%`);
            where.push(`(
              lower(catalog_products.category) LIKE $${params.length}
              OR lower(catalog_products.product_type) LIKE $${params.length}
              OR lower(array_to_string(catalog_products.keywords, ' ')) LIKE $${params.length}
            )`);
            continue;
          }
          params.push(`%${term}%`);
          where.push(`(
            lower(catalog_products.title) LIKE $${params.length}
            OR lower(catalog_products.description) LIKE $${params.length}
            OR lower(catalog_products.category) LIKE $${params.length}
            OR lower(coalesce(catalog_products.game, '')) LIKE $${params.length}
            OR lower(catalog_products.product_type) LIKE $${params.length}
            OR lower(array_to_string(catalog_products.meta || catalog_products.keywords, ' ')) LIKE $${params.length}
          )`);
        }
      }
    }
    return { params, where };
  }

  private async countProducts(command: {
    category?: CatalogProductKind;
    conditions?: string[];
    game?: CatalogGame;
    maxPriceCoinMinor?: number;
    minPriceCoinMinor?: number;
    search?: string;
    slug?: string;
    types?: string[];
  }): Promise<number> {
    const { params, where } = this.catalogWhere(command);
    if (command.minPriceCoinMinor !== undefined) {
      params.push(command.minPriceCoinMinor);
      where.push(`${effectivePriceCoinMinorSql} >= $${params.length}`);
    }
    if (command.maxPriceCoinMinor !== undefined) {
      params.push(command.maxPriceCoinMinor);
      where.push(`${effectivePriceCoinMinorSql} <= $${params.length}`);
    }
    const result = await this.database.query<{ total: string }>(
      `
        SELECT count(*)::text AS total
        FROM catalog_products
        LEFT JOIN supplier_listings
          ON catalog_products.supplier_provider = 'sih'
          AND supplier_listings.supplier = 'sih'
          AND supplier_listings.game = lower(catalog_products.game)
          AND supplier_listings.market_hash_name = catalog_products.supplier_item_id
          AND supplier_listings.active = true
${supplierPricingJoin}
        WHERE ${where.join("\n          AND ")}
      `,
      params,
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private gameFilter(query: CatalogListQuery): CatalogGame | undefined {
    const rawGame = query.game;
    if (rawGame === undefined || rawGame.trim() === "") return undefined;
    const game = parseCatalogGame(rawGame);
    if (game === null) throw new BadRequestException("Unsupported catalog game");
    const category = allowedKinds.has(query.category as CatalogProductKind) ? query.category as CatalogProductKind : undefined;
    if (category !== undefined && category !== "skins") {
      throw new BadRequestException("Catalog game filter is available only for skins");
    }
    return game;
  }

  private async loadFacets(command: {
    category?: CatalogProductKind;
    game?: CatalogGame;
    search?: string;
  } = {}): Promise<CatalogFacetsDto> {
    const { params, where } = this.catalogWhere(command);
    const gameFacets = this.catalogWhere({
      ...(command.category === undefined ? {} : { category: command.category }),
      ...(command.search === undefined ? {} : { search: command.search }),
    });
    const result = await this.database.query<{
      game: string | null;
      product_type: string | null;
      condition_value: string | null;
    }>(
      `
        SELECT DISTINCT
          catalog_products.game,
          catalog_products.product_type,
          condition_specification.value ->> 'value' AS condition_value
        FROM catalog_products
        LEFT JOIN LATERAL jsonb_array_elements(coalesce(catalog_products.details -> 'specifications', '[]'::jsonb)) AS condition_specification(value)
          ON lower(condition_specification.value ->> 'label') = 'состояние'
        WHERE ${where.join("\n          AND ")}
        ORDER BY catalog_products.game ASC, catalog_products.product_type ASC, condition_value ASC
      `,
      params,
    );
    const gameResult = await this.database.query<{ game: string | null }>(
      `
        SELECT DISTINCT catalog_products.game
        FROM catalog_products
        WHERE ${gameFacets.where.join("\n          AND ")}
        ORDER BY catalog_products.game ASC
      `,
      gameFacets.params,
    );
    const games = CATALOG_GAMES
      .filter((game) => gameResult.rows.some((row) => parseCatalogGame(row.game) === game))
      .map((game) => ({
        id: game,
        title: getCatalogGameDefinition(game).label,
      }));

    return {
      kinds: [
        { id: "skins", title: "Игровые предметы" },
      ],
      games,
      productTypes: facetOptionsFromValues(result.rows.map((row) => row.product_type)),
      conditions: facetOptionsFromValues(result.rows.map((row) => row.condition_value)),
      fulfillmentModes: [
        { id: "automatic", title: "Автоматически" },
        { id: "steam-trade", title: "Steam Trade" },
        { id: "manual", title: "Ручная выдача" },
      ],
      availability: [{ id: "available", title: "Доступен к оформлению" }],
    };
  }
}
