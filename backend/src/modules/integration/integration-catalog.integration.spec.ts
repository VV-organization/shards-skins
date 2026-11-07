import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { DatabaseService } from "../../common/database/database.service";
import { requireSafeTestDatabase } from "../../common/database/test-database";
import { loadAppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { CatalogService } from "../catalog/catalog.service";
import { IntegrationCatalogService } from "./integration-catalog.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("invoice catalog preserves the public Shards read model", () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const target = requireSafeTestDatabase(databaseUrl);
    pool = new Pool({ connectionString: target });
    await pool.query("DELETE FROM catalog_products");
    await pool.query(`
      INSERT INTO catalog_products (id,slug,kind,category,category_id,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,image,meta,keywords,details,public_enabled,ever_published)
      SELECT 'invoice-'||n, 'invoice-'||n, 'skins', 'Skins', 'rifle', 'cs2', 'Rifle', 'Skin '||lpad(n::text,3,'0'), '', 12345+n,
        'available', 'steam-trade', 0, 'https://cdn.example/'||repeat('x',180)||'.png', '{}', '{}',
        '{"specifications":[],"fulfillment":{"title":"Trade","description":"","requirements":[]}}', n<=205, true
      FROM generate_series(1,208) AS n
    `);
    await pool.query("UPDATE catalog_products SET game='rust' WHERE id='invoice-207'");
    await pool.query("UPDATE catalog_products SET kind='steam',game=NULL WHERE id='invoice-208'");
    await pool.query(`
      WITH run AS (INSERT INTO catalog_sync_runs (source,game,status) VALUES ('sih','cs2','promoted') RETURNING id)
      INSERT INTO supplier_listings(supplier,game,market_hash_name,available_quantity,price_microusd,last_sync_run_id)
      SELECT 'sih','cs2','Invoice live skin',3,1020000,id FROM run
    `);
    await pool.query("UPDATE catalog_products SET supplier_provider='sih',supplier_item_id='Invoice live skin' WHERE id='invoice-1'");
    await pool.query(`INSERT INTO supplier_listings(supplier,game,market_hash_name,active,available_quantity,price_microusd,last_sync_run_id)
      SELECT supplier,game,'Invoice inactive skin',false,0,2020000,last_sync_run_id FROM supplier_listings WHERE market_hash_name='Invoice live skin'`);
    await pool.query("UPDATE catalog_products SET supplier_provider='sih',supplier_item_id='Invoice inactive skin' WHERE id='invoice-101'");
    await pool.query(`INSERT INTO catalog_products (id,slug,kind,category,category_id,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,public_enabled,ever_published)
      SELECT 'invoice-100-hidden', 'invoice-100-hidden', kind,category,category_id,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,false,true FROM catalog_products WHERE id='invoice-100'`);
    await pool.query("UPDATE pricing_settings SET superseded_at=now() WHERE scope='sih-skins' AND superseded_at IS NULL");
    await pool.query(`INSERT INTO pricing_settings(id,scope,source,supplier_currency,fiat_currency,supplier_to_fiat_rate_minor,coin_rate_numerator,coin_rate_denominator,markup_bps,min_price_coin_minor,round_to_coin_minor,valid_from)
      VALUES ('invoice-pricing-v1','sih-skins','sih','USD','RUB',100,8,5,0,1,1,now())`);
    const readOnlyUrl = new URL(target);
    readOnlyUrl.searchParams.set("options", "-c default_transaction_read_only=on");
    const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: readOnlyUrl.href, VV_ADMIN_PUBLIC_ORIGIN: "https://shards.example" });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); await pool.end(); });

  beforeEach(async () => {
    await pool.query("DELETE FROM catalog_products WHERE id='aaa-new'");
    await pool.query("DELETE FROM pricing_settings WHERE id='invoice-pricing-v2'");
    await pool.query("UPDATE pricing_settings SET superseded_at=NULL WHERE id='invoice-pricing-v1'");
    await pool.query("UPDATE supplier_listings SET last_seen_at=now(),available_quantity=3,active=true,price_microusd=1020000 WHERE market_hash_name='Invoice live skin'");
    await pool.query("UPDATE catalog_products SET category_id='rifle' WHERE id='invoice-1'");
  });

  it("returns all 205 public CS2 skins across pages and cannot write checkout or financial records", async () => {
    const readonly = await app.get(DatabaseService).query<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only");
    expect(readonly.rows[0]?.default_transaction_read_only).toBe("on");
    const integration = app.get(IntegrationCatalogService);
    const first = await integration.listProducts({ limit: "200" });
    const second = await integration.listProducts({ limit: "200", cursor: first.nextCursor });
    expect(first.items).toHaveLength(200);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(205);
    for (const id of ["invoice-206", "invoice-207", "invoice-208", "invoice-100-hidden"]) expect(ids).not.toContain(id);
    expect(first.items.find((row) => row.id === "invoice-1")?.isActive).toBe(true);
    expect(first.items.find((row) => row.id === "invoice-2")?.isActive).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(256 * 1024);
    const publicPage = await app.get(CatalogService).list({ limit: "200" });
    expect(publicPage.pagination.total).toBe(205);
    expect(publicPage.items).toHaveLength(200);
    // Cart/detail may retain a formerly published product; invoice enumeration must not expose it.
    expect((await app.get(CatalogService).getBySlug("invoice-100-hidden")).availability).toBe("unavailable");
  });

  it("preserves half-up Shards prices and sees both supplier and pricing-version changes", async () => {
    const integration = app.get(IntegrationCatalogService);
    const catalog = app.get(CatalogService);
    // 1.02 USD * 100 RUB minor/USD * 8/5 = 163.2, rounded half-up to 163, not ceiling 164.
    const first = await integration.listOffers({});
    expect((await catalog.getBySlug("invoice-1")).price.amountMinor).toBe(163);
    expect(first.items.find((row) => row.productId === "invoice-1")?.price).toEqual({ currency: "COINS", amountMinor: 163, scale: 100 });
    await pool.query("UPDATE supplier_listings SET price_microusd=2020000 WHERE market_hash_name='Invoice live skin'");
    const updated = await integration.listOffers({});
    expect((await catalog.getBySlug("invoice-1")).price.amountMinor).toBe(323);
    expect(updated.items.find((row) => row.productId === "invoice-1")?.price).toEqual({ currency: "COINS", amountMinor: 323, scale: 100 });
    await pool.query("UPDATE pricing_settings SET superseded_at=now() WHERE id='invoice-pricing-v1'");
    await pool.query(`INSERT INTO pricing_settings(id,scope,source,supplier_currency,fiat_currency,supplier_to_fiat_rate_minor,coin_rate_numerator,coin_rate_denominator,markup_bps,min_price_coin_minor,round_to_coin_minor,valid_from)
      VALUES ('invoice-pricing-v2','sih-skins','sih','USD','RUB',101,8,5,0,1,1,now())`);
    const repriced = await integration.listOffers({});
    expect((await catalog.getBySlug("invoice-1")).price.amountMinor).toBe(328);
    expect(repriced.items.find((row) => row.productId === "invoice-1")?.price).toEqual({ currency: "COINS", amountMinor: 328, scale: 100 });
  });

  it("applies visibility before page size and preserves pricing for inactive supplier rows", async () => {
    const cursor = Buffer.from(JSON.stringify({ version: 1, afterId: "invoice-100" })).toString("base64url");
    const page = await app.get(IntegrationCatalogService).listOffers({ limit: "2", cursor });
    expect(page.items.map((row) => row.productId)).toEqual(["invoice-101", "invoice-102"]);
    const publicProduct = await app.get(CatalogService).getBySlug("invoice-101");
    expect(publicProduct.price.amountMinor).toBe(323);
    expect(page.items[0]).toMatchObject({ isActive: false, availability: { status: "out_of_stock" }, price: { currency: "COINS", amountMinor: 323, scale: 100 } });
  });

  it("derives availability from supplier freshness, quantity, active status, and category without hiding the row", async () => {
    const integration = app.get(IntegrationCatalogService);
    for (const update of ["last_seen_at=now()-interval '16 minutes'", "available_quantity=0", "active=false", "price_microusd=0"]) {
      await pool.query("UPDATE supplier_listings SET last_seen_at=now(),available_quantity=3,active=true,price_microusd=2020000 WHERE market_hash_name='Invoice live skin'");
      await pool.query(`UPDATE supplier_listings SET ${update} WHERE market_hash_name='Invoice live skin'`);
      const offer = (await integration.listOffers({})).items.find((row) => row.productId === "invoice-1");
      expect(offer).toMatchObject({ isActive: false, availability: { status: "out_of_stock" } });
      expect((await app.get(CatalogService).getBySlug("invoice-1")).availability).toBe("unavailable");
    }
    await pool.query("UPDATE supplier_listings SET last_seen_at=now(),available_quantity=3,active=true,price_microusd=2020000 WHERE market_hash_name='Invoice live skin'");
    await pool.query("UPDATE catalog_products SET category_id=NULL WHERE id='invoice-1'");
    expect((await integration.listProducts({})).items.find((row) => row.id === "invoice-1")?.isActive).toBe(false);
    await pool.query("UPDATE catalog_products SET category_id='rifle' WHERE id='invoice-1'");
    expect((await integration.listProducts({})).items.find((row) => row.id === "invoice-1")?.isActive).toBe(true);
  });

  it("continues after a stable ID without duplicating rows when an earlier product is inserted", async () => {
    const integration = app.get(IntegrationCatalogService);
    const first = await integration.listProducts({ limit: "200" });
    await pool.query(`INSERT INTO catalog_products (id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details)
      SELECT 'aaa-new', 'aaa-new', kind, category, game, product_type, 'New skin', description, price_coin_minor, availability, fulfillment_mode, popularity, meta, keywords, details FROM catalog_products WHERE id='invoice-3'`);
    const second = await integration.listProducts({ limit: "200", cursor: first.nextCursor });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(205);
    expect(ids).not.toContain("aaa-new");
  });
});
