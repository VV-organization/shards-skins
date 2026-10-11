import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import type { CatalogListDto } from "./catalog.types";
import { CatalogPricingService } from "./catalog-pricing.service";
import { CatalogSupplierSyncService } from "./catalog-supplier-sync.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const deagleMarketHashName = "Desert Eagle | Printstream (Minimal Wear)";
// $1.011 × 95 RUB/USD × 1.25 markup × 1.6 Shards/RUB, rounded half-up to hundredths = 192.11.
const deagleProjectedSlug = "desert-eagle-printstream-minimal-wear-b26c34c3";

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("catalog PostgreSQL persistence", () => {
  let app: INestApplication;
  let pool: Pool;

  async function insertDeagleListing() {
    const run = await pool.query<{ id: string }>(
      `
        INSERT INTO catalog_sync_runs (source, game, status, observed_at, finished_at, row_count, metadata)
        VALUES ('sih', 'cs2', 'promoted', '2026-07-28T10:00:00.000Z', '2026-07-28T10:00:01.000Z', 1, '{"test":"catalog-live-price"}'::jsonb)
        RETURNING id
      `,
    );
    const runId = run.rows[0]?.id;
    expect(runId).toBeDefined();
    await pool.query(
      `
        INSERT INTO supplier_listings (
          supplier,
          game,
          market_hash_name,
          active,
          available_quantity,
          price_microusd,
          image_url,
          snapshot,
          first_seen_at,
          last_seen_at,
          last_sync_run_id
        )
        VALUES ('sih', 'cs2', $1, true, 3, 1011000, 'https://cdn.example/deagle.png', '{}'::jsonb, '2026-07-28T10:00:00.000Z', '2026-07-28T10:00:00.000Z', $2)
      `,
      [deagleMarketHashName, runId],
    );
    const metadataSnapshot = await pool.query<{ id: string }>(
      `
        INSERT INTO catalog_metadata_snapshots (
          provider,
          game,
          locale,
          source_url,
          source_hash,
          observed_at,
          item_count,
          filtered_count,
          metadata
        )
        VALUES ('csgo_api', 'cs2', 'ru', 'https://raw.githubusercontent.com/TorentoFlag/CSGO-API/fixture/public/api/ru/all.json', 'deagle-fixture', '2026-07-28T10:00:00.000Z', 1, 0, '{"test":"catalog-live-price"}'::jsonb)
        RETURNING id
      `,
    );
    const snapshotId = metadataSnapshot.rows[0]?.id;
    expect(snapshotId).toBeDefined();
    await pool.query(
      `
        INSERT INTO catalog_metadata_items (
          provider,
          game,
          locale,
          market_hash_name,
          provider_item_id,
          title,
          description,
          category_name,
          product_type,
          rarity_name,
          image_url,
          tags,
          raw,
          snapshot_id
        )
        VALUES ('csgo_api', 'cs2', 'ru', $1, 'skin-deagle-printstream', 'Desert Eagle | Поток информации', 'Desert Eagle | Printstream для Counter-Strike 2.', 'Пистолеты', 'Пистолет', 'Тайное', 'https://cdn.example/deagle.png', ARRAY['Пистолеты','Тайное'], '{}'::jsonb, $2)
      `,
      [deagleMarketHashName, snapshotId],
    );
  }

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM supplier_listings WHERE supplier = 'sih' AND game = 'cs2' AND market_hash_name = $1", [deagleMarketHashName]);
    await pool.query("DELETE FROM catalog_metadata_items WHERE provider = 'csgo_api' AND game = 'cs2' AND market_hash_name = $1", [deagleMarketHashName]);
    await pool.query("DELETE FROM catalog_metadata_snapshots WHERE provider = 'csgo_api' AND game = 'cs2' AND metadata ->> 'test' = 'catalog-live-price'");
    await pool.query("DELETE FROM catalog_sync_runs WHERE source = 'sih' AND game = 'cs2' AND metadata ->> 'test' = 'catalog-live-price'");
    await pool.query("DELETE FROM catalog_products WHERE supplier_provider = 'sih' AND supplier_item_id = $1", [deagleMarketHashName]);
    await pool.query("DELETE FROM catalog_products WHERE id LIKE 'test-apple-variant-%'");
    delete process.env.DATABASE_URL;
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    app = await createApp();
    await pool.query("DELETE FROM catalog_products WHERE id LIKE 'test-apple-variant-%'");
    await pool.query("DELETE FROM catalog_products WHERE id LIKE 'test-api-game-filter-%'");
    await pool.query("DELETE FROM supplier_listings WHERE supplier = 'sih' AND game = 'cs2' AND market_hash_name = $1", [deagleMarketHashName]);
    await pool.query("DELETE FROM catalog_metadata_items WHERE provider = 'csgo_api' AND game = 'cs2' AND market_hash_name = $1", [deagleMarketHashName]);
    await pool.query("DELETE FROM catalog_metadata_snapshots WHERE provider = 'csgo_api' AND game = 'cs2' AND metadata ->> 'test' = 'catalog-live-price'");
    await pool.query("DELETE FROM catalog_sync_runs WHERE source = 'sih' AND game = 'cs2' AND metadata ->> 'test' = 'catalog-live-price'");
    await pool.query("DELETE FROM catalog_products WHERE supplier_provider = 'sih' AND supplier_item_id = $1", [deagleMarketHashName]);
  });

  it("serves provider-backed CS2 catalog rows promoted from active SIH listings", async () => {
    const seeded = await pool.query<{ total: string; gpt_total: string }>(
      "SELECT count(*) AS total, count(*) FILTER (WHERE kind = 'gpt') AS gpt_total FROM catalog_products",
    );
    expect(Number(seeded.rows[0]?.total)).toBeGreaterThan(0);
    expect(Number(seeded.rows[0]?.gpt_total)).toBe(0);
    await insertDeagleListing();
    const promoted = await app.get(CatalogSupplierSyncService).promoteActiveSihListings("cs2");
    expect(promoted.promotedProductCount).toBeGreaterThanOrEqual(1);

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ q: "Пистолет" })
      .expect(200);
    const body = response.body as CatalogListDto;

    const providerItem = body.items.find((item) => item.slug === deagleProjectedSlug);
    expect(providerItem).toBeDefined();
    expect(providerItem?.price).toEqual({
      currency: "COINS",
      amountMinor: 19211,
      scale: 2,
      display: "192,11 Shards",
    });
    expect(providerItem?.game).toBe("cs2");
  });

  it("does not publish non-CS2 seeded skin categories", async () => {
    await pool.query("UPDATE catalog_products SET public_enabled = false WHERE kind = 'skins' AND game <> 'CS2'");

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .expect(200);
    const body = response.body as CatalogListDto;

    expect(body.facets.games.map((item) => item.id)).not.toContain("Dota 2");
    expect(body.facets.games.map((item) => item.id)).not.toContain("Rust");
    expect(body.items.filter((item) => item.kind === "skins").every((item) => item.game === "CS2")).toBe(true);
  });

  it("rejects duplicate Apple gift-card variants for the same region currency and nominal", async () => {
    const details = {
      specifications: [
        { label: "Регион", value: "Европа" },
        { label: "Номинал", value: "2 EUR" },
      ],
      fulfillment: {
        title: "Ручная выдача",
        description: "Код отправляется на подтверждённый email.",
        requirements: ["Регион Apple ID должен соответствовать выбранной карте."],
      },
      appleGiftCard: {
        currency: "EUR",
        nominalMinor: 200,
        regionCode: "TEST-EU",
        regionLabel: "Тестовая Европа",
      },
    };

    async function insertVariant(id: string, slug: string, publicEnabled: boolean) {
      await pool.query(
        `
          INSERT INTO catalog_products (
            id,
            slug,
            kind,
            category,
            game,
            product_type,
            title,
            description,
            price_coin_minor,
            availability,
            fulfillment_mode,
            popularity,
            image,
            image_alt,
            meta,
            keywords,
            details,
            supplier_provider,
            supplier_snapshot,
            public_enabled,
            created_at
          )
          VALUES ($1, $2, 'apple_gift_card', 'Подарочная карта Apple', NULL, 'Подарочная карта App Store & iTunes',
            'Подарочная карта Apple', 'Подарочная карта Apple для App Store & iTunes.', 200, 'available', 'manual', 10,
            NULL, NULL, ARRAY['Европа', '2 EUR'], ARRAY['apple', 'itunes', 'подарочная карта'], $3::jsonb,
            'manual', '{}'::jsonb, $4, '2026-08-14T10:00:00.000Z')
        `,
        [id, slug, JSON.stringify(details), publicEnabled],
      );
    }

    await expect(insertVariant("test-apple-visible", "test-apple-visible", true)).rejects.toMatchObject({code:"23514"});
    await insertVariant("test-apple-variant-one", "test-apple-eur-2-one", false);

    await expect(insertVariant("test-apple-variant-two", "test-apple-eur-2-two", false))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("quotes supplier-linked skin products from the latest active SIH listing", async () => {
    await insertDeagleListing();
    const promoted = await app.get(CatalogSupplierSyncService).promoteActiveSihListings("cs2");
    expect(promoted.promotedProductCount).toBeGreaterThanOrEqual(1);

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ q: "Пистолет" })
      .expect(200);
    const body = response.body as CatalogListDto;

    const providerItem = body.items.find((item) => item.slug === deagleProjectedSlug);
    expect(providerItem).toBeDefined();
    expect(providerItem?.price).toEqual({
      currency: "COINS",
      amountMinor: 19211,
      scale: 2,
      display: "192,11 Shards",
    });
  });

  it("filters and sorts supplier-linked products by their quoted Coins price", async () => {
    await insertDeagleListing();
    const promoted = await app.get(CatalogSupplierSyncService).promoteActiveSihListings("cs2");
    expect(promoted.promotedProductCount).toBeGreaterThanOrEqual(1);

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ category: "skins", game: "cs2", min: "150", max: "250", sort: "price_asc", limit: 5 })
      .expect(200);
    const body = response.body as CatalogListDto;

    const providerItem = body.items.find((item) => item.slug === deagleProjectedSlug);
    expect(providerItem).toBeDefined();
    expect(providerItem?.price.amountMinor).toBe(19211);
    expect(body.items.every((item) => item.price.amountMinor >= 15000 && item.price.amountMinor <= 25000)).toBe(true);
  });

  it("returns catalog pagination metadata instead of making the first page look exhaustive", async () => {
    await insertDeagleListing();
    const promoted = await app.get(CatalogSupplierSyncService).promoteActiveSihListings("cs2");
    expect(promoted.promotedProductCount).toBeGreaterThanOrEqual(1);

    const firstPageResponse = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ category: "skins", q: "CS2", limit: 1, offset: 0 })
      .expect(200);
    const firstPage = firstPageResponse.body as CatalogListDto;

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.pagination.limit).toBe(1);
    expect(firstPage.pagination.offset).toBe(0);
    expect(firstPage.pagination.total).toBeGreaterThanOrEqual(1);
    expect(firstPage.pagination.hasMore).toBe(firstPage.pagination.total > 1);

    if (firstPage.pagination.total > 1) {
      const secondPageResponse = await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/catalog")
        .query({ category: "skins", q: "CS2", limit: 1, offset: 1 })
        .expect(200);
      const secondPage = secondPageResponse.body as CatalogListDto;

      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.pagination.limit).toBe(1);
      expect(secondPage.pagination.offset).toBe(1);
      expect(secondPage.pagination.total).toBe(firstPage.pagination.total);
      expect(secondPage.items[0]?.slug).not.toBe(firstPage.items[0]?.slug);
    }
  });

  it("rejects excluded games at the public boundary", async () => {
    for (const game of ["rust", "tf2"]) await request(app.getHttpServer() as Parameters<typeof request>[0]).get("/catalog").query({game}).expect(400);
  });

  it("filters catalog totals and pages by product type and item condition before pagination", async () => {
    await pool.query(
      `
        INSERT INTO catalog_products (
          id,
          slug,
          kind,
          category,
          game,
          product_type,
          title,
          description,
          price_coin_minor,
          availability,
          fulfillment_mode,
          popularity,
          image,
          image_alt,
          meta,
          keywords,
          details,
          public_enabled
        )
        VALUES
          (
            'test-api-game-filter-cs2-field-tested-ak',
            'test-api-game-filter-cs2-field-tested-ak',
            'skins',
            'Игровые предметы',
            'cs2',
            'Автомат',
            'AK-47 | Test',
            'CS2 rifle item.',
            30000,
            'available',
            'steam-trade',
            20,
            'https://cdn.example/cs2/ak.png',
            'AK-47 Test',
            ARRAY['CS2','Field-Tested'],
            ARRAY['cs2','ak-47','автомат'],
            '{"specifications":[{"label":"Состояние","value":"Field-Tested"}],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          ),
          (
            'test-api-game-filter-cs2-field-tested-m4',
            'test-api-game-filter-cs2-field-tested-m4',
            'skins',
            'Игровые предметы',
            'cs2',
            'Автомат',
            'M4A1-S | Test',
            'CS2 rifle item.',
            20000,
            'available',
            'steam-trade',
            10,
            'https://cdn.example/cs2/m4.png',
            'M4 Test',
            ARRAY['CS2','Field-Tested'],
            ARRAY['cs2','m4','автомат'],
            '{"specifications":[{"label":"Состояние","value":"Field-Tested"}],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          ),
          (
            'test-api-game-filter-cs2-factory-new-awp',
            'test-api-game-filter-cs2-factory-new-awp',
            'skins',
            'Игровые предметы',
            'cs2',
            'Снайперская винтовка',
            'AWP | Test',
            'CS2 sniper item.',
            10000,
            'available',
            'steam-trade',
            30,
            'https://cdn.example/cs2/awp.png',
            'AWP Test',
            ARRAY['CS2','Factory New'],
            ARRAY['cs2','awp','снайперская'],
            '{"specifications":[{"label":"Состояние","value":"Factory New"}],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          )
      `,
    );

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({
        category: "skins",
        game: "cs2",
        type: "Автомат",
        condition: "Field-Tested",
        sort: "price_asc",
        limit: 1,
      })
      .expect(200);
    const body = response.body as CatalogListDto;

    expect(body.pagination.total).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.slug).toBe("test-api-game-filter-cs2-field-tested-m4");
  });

  it("filters catalog totals and pages by Coins price before pagination", async () => {
    await pool.query(
      `
        INSERT INTO catalog_products (
          id,
          slug,
          kind,
          category,
          game,
          product_type,
          title,
          description,
          price_coin_minor,
          availability,
          fulfillment_mode,
          popularity,
          image,
          image_alt,
          meta,
          keywords,
          details,
          public_enabled
        )
        VALUES
          (
            'test-api-game-filter-cs2-price-low',
            'test-api-game-filter-cs2-price-low',
            'skins',
            'Игровые предметы',
            'cs2',
            'Пистолет',
            'Pistol | Price Low',
            'CS2 pistol item.',
            10000,
            'available',
            'steam-trade',
            1,
            'https://cdn.example/cs2/low.png',
            'Low Price Test',
            ARRAY['CS2'],
            ARRAY['cs2','price'],
            '{"specifications":[],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          ),
          (
            'test-api-game-filter-cs2-price-middle',
            'test-api-game-filter-cs2-price-middle',
            'skins',
            'Игровые предметы',
            'cs2',
            'Пистолет',
            'Pistol | Price Middle',
            'CS2 pistol item.',
            20000,
            'available',
            'steam-trade',
            200,
            'https://cdn.example/cs2/middle.png',
            'Middle Price Test',
            ARRAY['CS2'],
            ARRAY['cs2','price'],
            '{"specifications":[],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          ),
          (
            'test-api-game-filter-cs2-price-high',
            'test-api-game-filter-cs2-price-high',
            'skins',
            'Игровые предметы',
            'cs2',
            'Пистолет',
            'Pistol | Price High',
            'CS2 pistol item.',
            30000,
            'available',
            'steam-trade',
            300,
            'https://cdn.example/cs2/high.png',
            'High Price Test',
            ARRAY['CS2'],
            ARRAY['cs2','price'],
            '{"specifications":[],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          )
      `,
    );

    const emptyResponse = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ category: "skins", game: "cs2", max: "60", limit: 1 })
      .expect(200);
    const emptyBody = emptyResponse.body as CatalogListDto;

    expect(emptyBody.pagination.total).toBe(0);
    expect(emptyBody.pagination.hasMore).toBe(false);
    expect(emptyBody.items).toHaveLength(0);

    const middleResponse = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ category: "skins", game: "cs2", min: "150", max: "250", sort: "price_asc", limit: 1 })
      .expect(200);
    const middleBody = middleResponse.body as CatalogListDto;

    expect(middleBody.pagination.total).toBe(1);
    expect(middleBody.pagination.hasMore).toBe(false);
    expect(middleBody.items).toHaveLength(1);
    expect(middleBody.items[0]?.slug).toBe("test-api-game-filter-cs2-price-middle");
  });

  it("returns scoped catalog facets from all matching products before pagination", async () => {
    await pool.query(
      `
        INSERT INTO catalog_products (
          id,
          slug,
          kind,
          category,
          game,
          product_type,
          title,
          description,
          price_coin_minor,
          availability,
          fulfillment_mode,
          popularity,
          image,
          image_alt,
          meta,
          keywords,
          details,
          public_enabled
        )
        VALUES
          (
            'test-api-game-filter-cs2-facet-rifle',
            'test-api-game-filter-cs2-facet-rifle',
            'skins',
            'Игровые предметы',
            'cs2',
            'FacetProbe Винтовки',
            'FacetProbe Rifle',
            'facetprobe CS2 rifle item.',
            10000,
            'available',
            'steam-trade',
            300,
            'https://cdn.example/cs2/facet-rifle.png',
            'Facet Rifle Test',
            ARRAY['CS2','FacetProbe Minimal'],
            ARRAY['facetprobe','rifle'],
            '{"specifications":[{"label":"Состояние","value":"FacetProbe Minimal"}],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          ),
          (
            'test-api-game-filter-cs2-facet-container',
            'test-api-game-filter-cs2-facet-container',
            'skins',
            'Игровые предметы',
            'cs2',
            'FacetProbe Контейнеры',
            'FacetProbe Container',
            'facetprobe CS2 container item.',
            20000,
            'available',
            'steam-trade',
            1,
            'https://cdn.example/cs2/facet-container.png',
            'Facet Container Test',
            ARRAY['CS2','FacetProbe Factory'],
            ARRAY['facetprobe','container'],
            '{"specifications":[{"label":"Состояние","value":"FacetProbe Factory"}],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            true
          ),
          (
            'test-api-game-filter-rust-facet-decoy',
            'test-api-game-filter-rust-facet-decoy',
            'skins',
            'Игровые предметы',
            'rust',
            'FacetProbe Rust',
            'FacetProbe Rust Decoy',
            'facetprobe Rust item.',
            30000,
            'available',
            'steam-trade',
            500,
            'https://cdn.example/rust/facet-decoy.png',
            'Facet Rust Test',
            ARRAY['Rust','FacetProbe Rust'],
            ARRAY['facetprobe','rust'],
            '{"specifications":[{"label":"Состояние","value":"FacetProbe Rust"}],"fulfillment":{"title":"","description":"","requirements":[]}}'::jsonb,
            false
          )
      `,
    );

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/catalog")
      .query({ category: "skins", game: "cs2", q: "facetprobe", limit: 1 })
      .expect(200);
    const body = response.body as CatalogListDto;

    expect(body.items).toHaveLength(1);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.facets.productTypes.map((item) => item.id)).toEqual([
      "FacetProbe Винтовки",
      "FacetProbe Контейнеры",
    ]);
    expect(body.facets.conditions.map((item) => item.id)).toEqual([
      "FacetProbe Factory",
      "FacetProbe Minimal",
    ]);
    expect(body.facets.games.map((item) => item.id)).toEqual(["cs2"]);
  });
  it("keeps list, detail, SQL price bounds and supplier quote aligned after a new price version", async () => {
    await insertDeagleListing();
    await app.get(CatalogSupplierSyncService).promoteActiveSihListings("cs2");
    const pricing = app.get(CatalogPricingService);
    expect((await pricing.quoteSupplierPrice({scope:"sih-skins",supplierAmountMicrounit:1011000n})).amountMinor).toBe(19211);
    await pool.query("UPDATE pricing_settings SET superseded_at=now() WHERE id='pricing-shards-v1'");
    await pool.query(`INSERT INTO pricing_settings (id,scope,source,supplier_currency,fiat_currency,supplier_to_fiat_rate_minor,coin_rate_numerator,coin_rate_denominator,markup_bps,min_price_coin_minor,round_to_coin_minor,valid_from) VALUES ('test-shards-new-rate','sih-skins','sih','USD','RUB',10000,8,5,2500,1,1,now())`);
    try {
      const quoted = await pricing.quoteSupplierPrice({scope:"sih-skins",supplierAmountMicrounit:1011000n});
      expect(quoted.amountMinor).toBe(20221);
      const detail = await request(app.getHttpServer() as Parameters<typeof request>[0]).get(`/catalog/${deagleProjectedSlug}`).expect(200);
      expect((detail.body as {price:{amountMinor:number}}).price.amountMinor).toBe(20221);
      const listed = await request(app.getHttpServer() as Parameters<typeof request>[0]).get('/catalog').query({min:'202.21',max:'202.21',sort:'price_asc'}).expect(200);
      expect((listed.body as CatalogListDto).items.find(item=>item.slug===deagleProjectedSlug)?.price.amountMinor).toBe(20221);
    } finally {
      await pool.query("DELETE FROM pricing_settings WHERE id='test-shards-new-rate'");
      await pool.query("UPDATE pricing_settings SET superseded_at=NULL WHERE id='pricing-shards-v1'");
    }
  });

  it("keeps a formerly public SKU readable when unavailable, and never exposes unpublished records", async()=>{
    await insertDeagleListing();
    await app.get(CatalogSupplierSyncService).promoteActiveSihListings("cs2");
    const server=app.getHttpServer() as Parameters<typeof request>[0];
    const stale=await request(server).get(`/catalog/${deagleProjectedSlug}`).expect(200);
    expect((stale.body as {availability:string}).availability).toBe("unavailable");
    await pool.query("UPDATE supplier_listings SET last_seen_at=now() WHERE market_hash_name=$1",[deagleMarketHashName]);
    const fresh=await request(server).get(`/catalog/${deagleProjectedSlug}`).expect(200);
    expect((fresh.body as {availability:string}).availability).toBe("available");
    expect((fresh.body as {priceRevision:string}).priceRevision).not.toBe((stale.body as {priceRevision:string}).priceRevision);
    await pool.query("UPDATE catalog_products SET public_enabled=false WHERE slug=$1",[deagleProjectedSlug]);
    const gone=await request(server).post('/catalog/lookup').send({slugs:[deagleProjectedSlug]}).expect(200);
    expect((gone.body as {items:Array<{availability:string}>}).items[0]?.availability).toBe("unavailable");
    await pool.query("UPDATE catalog_products SET ever_published=false WHERE slug=$1",[deagleProjectedSlug]);
    await request(server).get(`/catalog/${deagleProjectedSlug}`).expect(404);
    await request(server).post('/catalog/lookup').send({slugs:Array(51).fill(deagleProjectedSlug)}).expect(400);
  });

});
