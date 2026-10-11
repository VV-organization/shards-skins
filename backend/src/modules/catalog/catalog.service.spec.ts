import { describe, expect, it } from "vitest";

import { CatalogService } from "./catalog.service";
import type { CatalogPricingService } from "./catalog-pricing.service";

type QueryResult<Row> = { rows: Row[] };

const appleRow = {
  id: "apple-ru-500",
  slug: "apple-ru-500",
  kind: "apple_gift_card",
  category: "Подарочная карта Apple",
  game: null,
  product_type: "Подарочная карта App Store & iTunes",
  title: "Подарочная карта Apple",
  description: "Пополняйте баланс Apple ID подарочной картой App Store & iTunes. Код вручную отправит команда Shards после оплаты.",
  price_coin_minor: 75000,
  effective_price_coin_minor: "75000",
  availability: "available",
  fulfillment_mode: "manual",
  created_at: new Date("2026-08-12T15:45:35.355Z"),
  popularity: 100,
  image: null,
  image_alt: null,
  meta: ["Россия", "500 RUB"],
  keywords: ["apple", "itunes", "подарочная карта"],
  details: {
    specifications: [
      { label: "Регион", value: "Россия" },
      { label: "Номинал", value: "500 RUB" },
    ],
    fulfillment: {
      title: "Ручная выдача",
      description: "Код вручную отправит команда Shards после оплаты.",
      requirements: ["Регион Apple ID должен соответствовать выбранной карте."],
    },
    appleGiftCard: {
      currency: "RUB",
      nominalMinor: 50000,
      regionCode: "RU",
      regionLabel: "Россия",
    },
  },
  supplier_price_microusd: null,
};

describe("CatalogService", () => {
  function createService(row: Omit<typeof appleRow, "game"> & { game: string | null } = appleRow) {
    const database = {
      query<Row>(sql: string): Promise<QueryResult<Row>> {
        const isConstrainedToSkins = sql.includes("catalog_products.kind = 'skins'");

        if (sql.includes("SELECT count(*)::text AS total")) {
          return Promise.resolve({ rows: [{ total: isConstrainedToSkins ? "0" : "1" }] as Row[] });
        }

        if (sql.includes("SELECT DISTINCT") || sql.includes("jsonb_array_elements")) {
          return Promise.resolve({ rows: [] });
        }

        if (sql.includes("catalog_products.id")) {
          return Promise.resolve({ rows: (isConstrainedToSkins ? [] : [row]) as Row[] });
        }

        return Promise.resolve({ rows: [] });
      },
    };
    const pricing = {
      quoteSupplierPrice: () => Promise.reject(new Error("supplier pricing must not be used for manual Apple gift cards")),
    } as unknown as CatalogPricingService;

    return new CatalogService(database as never, pricing);
  }

  it("keeps the default public catalog constrained to skins", async () => {
    const service = createService();

    const result = await service.list({ q: "apple" });

    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it("does not expose Apple even with explicit category", async () => {
    const result = await createService().list({category: "apple_gift_card"});
    expect(result.items).toEqual([]);
    await expect(createService().getBySlug("apple-ru-500")).rejects.toThrow("Product not found");
  });

  it("does not expose Steam refill as public catalog products because Steam uses direct RUB payment", async () => {
    const service = createService({
      ...appleRow,
      id: "steam-top-up-500",
      slug: "steam-top-up-500-rub",
      kind: "steam",
      category: "Steam",
      game: "Steam",
      product_type: "Пополнение баланса",
      title: "Пополнение Steam на 500 RUB",
      description: "Пополнение кошелька Steam на 500 RUB по курсу Shards.",
      price_coin_minor: 75_000,
      effective_price_coin_minor: "75000",
      fulfillment_mode: "automatic",
      meta: ["Steam", "500 RUB"],
      keywords: ["steam", "пополнение"],
      details: {
        ...appleRow.details,
        specifications: [{ label: "Зачисление в Steam", value: "500 RUB" }],
        fulfillment: {
          title: "Данные пополнения Steam",
          description: "Логин Steam фиксируется в заказе.",
          requirements: ["Проверьте логин Steam перед оформлением."],
        },
      },
    });

    const result = await service.list({ category: "steam", q: "steam" });

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it("does not resolve legacy dynamic Steam refill slugs as product detail pages", async () => {
    const service = createService();

    await expect(service.getBySlug("steam-top-up-750-rub")).rejects.toMatchObject({
      message: "Product not found",
    });
  });


});
