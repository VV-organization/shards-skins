import { Pool, type PoolClient } from "pg";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";

describe.skipIf(!process.env.SHARDS_TEST_DATABASE_URL)("storefront preview PostgreSQL contract", () => {
  let pool: Pool;
  let client: PoolClient;
  let service: CatalogService;
  let app: INestApplication;
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.SHARDS_TEST_DATABASE_URL });
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("UPDATE catalog_products SET public_enabled=false");
    await client.query(`INSERT INTO catalog_products
      (id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,category_id,public_enabled,ever_published,created_at)
      SELECT 'preview-'||i,'preview-'||i,'skins','Skins',CASE WHEN i=81 THEN 'rust' ELSE 'cs2' END,
      'rifle','Preview '||i,'',100+i,'unavailable','steam-trade',1000-i,'{}','{}',
      '{"specifications":[],"fulfillment":{"title":"","description":"","requirements":[]}}',
      'rifle',i BETWEEN 1 AND 80,true,'2026-01-01' FROM generate_series(0,81) i`);
    service = new CatalogService(client as never);
    const module = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await client.query("ROLLBACK"); client.release();
    await pool.end();
  });

  it("returns the exact first 60 public CS2 cards in catalog order", async () => {
    const full = await service.list({ limit: "60" });
    const preview = await request(app.getHttpServer() as Parameters<typeof request>[0]).get("/catalog/preview?limit=60").expect(200);
    expect(preview.body).toEqual({ items: full.items });
    expect(full.items).toHaveLength(60);
    expect(full.items[0]?.id).toBe("preview-1");
    expect(full.items[59]?.id).toBe("preview-60");
  });

  it("reads current price and stock on every request, without caching", async () => {
    await client.query("UPDATE pricing_settings SET supplier_to_fiat_rate_minor=100,coin_rate_numerator=1,coin_rate_denominator=1,markup_bps=0,min_price_coin_minor=1,round_to_coin_minor=1 WHERE scope='sih-skins' AND superseded_at IS NULL");
    const sync = await client.query<{id: string}>("INSERT INTO catalog_sync_runs(source,game,status,observed_at,row_count) VALUES ('sih','cs2','promoted',now(),1) RETURNING id");
    await client.query("INSERT INTO supplier_listings(supplier,game,market_hash_name,available_quantity,price_microusd,last_sync_run_id) VALUES ('sih','cs2','preview-supplier',1,1000000,$1)", [sync.rows[0]?.id]);
    await client.query("UPDATE catalog_products SET supplier_provider='sih',supplier_item_id='preview-supplier' WHERE id='preview-1'");
    const first = await service.preview("1");
    expect(first.items).toEqual((await service.list({ limit: "1" })).items);
    expect(first.items[0]?.availability).toBe("available");
    await client.query("UPDATE supplier_listings SET price_microusd=2000000,available_quantity=0 WHERE market_hash_name='preview-supplier'");
    const changed = await service.preview("1");
    expect(changed.items).toEqual((await service.list({ limit: "1" })).items);
    expect(changed.items[0]?.availability).toBe("unavailable");
    expect(changed.items[0]?.price).not.toEqual(first.items[0]?.price);
  });

  it("does not expose a newly hidden product", async () => {
    await client.query("UPDATE catalog_products SET public_enabled=false WHERE id='preview-1'");
    expect((await service.preview("1")).items[0]?.id).toBe("preview-2");
  });
});
