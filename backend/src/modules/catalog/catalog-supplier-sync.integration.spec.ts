import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import type { SihSupplierItem } from "../providers/sih/sih.types";
import { CatalogSupplierSyncService } from "./catalog-supplier-sync.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("catalog supplier sync persistence", () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.CATALOG_PUBLIC_GAMES = "cs2";
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.CATALOG_PUBLIC_GAMES;
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    app = await createApp();
    await pool.query("TRUNCATE catalog_metadata_items, catalog_metadata_snapshots, supplier_listings, catalog_sync_runs RESTART IDENTITY");
    await pool.query(
      `
        DELETE FROM catalog_products
        WHERE supplier_provider = 'sih'
          AND supplier_item_id IN (
            'AK-47 | Redline (Field-Tested)',
            'Desert Eagle | Printstream (Minimal Wear)',
            'Metal Facemask',
            'Shared Market Item'
          )
      `,
    );
  });

  it("stores latest SIH listings and deactivates missing items for the synced game", async () => {
    const sync = app.get(CatalogSupplierSyncService);
    const firstItems: SihSupplierItem[] = [
      {
        availableQuantity: 4,
        game: "cs2",
        imageUrl: "https://community.cloudflare.steamstatic.com/economy/image/ak",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        priceMicrousd: 1_011_000n,
      },
      {
        availableQuantity: 1,
        game: "cs2",
        imageUrl: null,
        marketHashName: "Desert Eagle | Printstream (Minimal Wear)",
        priceMicrousd: 2_050_000n,
      },
    ];
    const secondItems: SihSupplierItem[] = [
      {
        availableQuantity: 2,
        game: "cs2",
        imageUrl: "https://community.cloudflare.steamstatic.com/economy/image/ak",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        priceMicrousd: 1_100_000n,
      },
    ];
    const client = {
      getItems: () => Promise.resolve(firstItems),
    };

    const firstRun = await sync.syncSihGame({
      client,
      game: "cs2",
      observedAt: new Date("2026-07-27T12:00:00.000Z"),
    });

    expect(firstRun).toMatchObject({
      game: "cs2",
      promotedProductCount: 0,
      source: "sih",
      status: "promoted",
      rowCount: 2,
    });

    client.getItems = () => Promise.resolve(secondItems);
    await sync.syncSihGame({
      client,
      game: "cs2",
      observedAt: new Date("2026-07-27T12:00:00.000Z"),
    });

    const runs = await pool.query<{ status: string; row_count: number }>(
      "SELECT status, row_count FROM catalog_sync_runs WHERE source = 'sih' AND game = 'cs2' ORDER BY started_at ASC",
    );
    expect(runs.rows).toEqual([
      { status: "promoted", row_count: 2 },
      { status: "promoted", row_count: 1 },
    ]);

    const listings = await pool.query<{
      active: boolean;
      available_quantity: number;
      market_hash_name: string;
      price_microusd: string;
    }>(
      `
        SELECT market_hash_name, active, available_quantity, price_microusd::text
        FROM supplier_listings
        WHERE supplier = 'sih' AND game = 'cs2'
        ORDER BY market_hash_name ASC
      `,
    );
    expect(listings.rows).toEqual([
      {
        active: true,
        available_quantity: 2,
        market_hash_name: "AK-47 | Redline (Field-Tested)",
        price_microusd: "1100000",
      },
      {
        active: false,
        available_quantity: 1,
        market_hash_name: "Desert Eagle | Printstream (Minimal Wear)",
        price_microusd: "2050000",
      },
    ]);

    const products = await pool.query<{
      game: string;
      public_enabled: boolean;
      slug: string;
      supplier_item_id: string;
      supplier_provider: string;
    }>(
      `
        SELECT slug, game, supplier_provider, supplier_item_id, public_enabled
        FROM catalog_products
        WHERE supplier_provider = 'sih'
          AND supplier_item_id IN ('AK-47 | Redline (Field-Tested)', 'Desert Eagle | Printstream (Minimal Wear)')
        ORDER BY supplier_item_id ASC
      `,
    );
    expect(products.rows).toEqual([
      {
        game: "cs2",
        public_enabled: false,
        slug: "ak-47-redline-field-tested-d1830255",
        supplier_item_id: "AK-47 | Redline (Field-Tested)",
        supplier_provider: "sih",
      },
      {
        game: "cs2",
        public_enabled: false,
        slug: "desert-eagle-printstream-minimal-wear-b26c34c3",
        supplier_item_id: "Desert Eagle | Printstream (Minimal Wear)",
        supplier_provider: "sih",
      },
    ]);
  });

  it("rejects other games before contacting SIH", async () => {
    const sync = app.get(CatalogSupplierSyncService);
    await expect(sync.syncSihGame({game: "rust", client: {getItems: () => Promise.reject(new Error("unexpected supplier call"))}})).rejects.toThrow("CATALOG_GAME_UNSUPPORTED");
  });
  it("rejects an empty or malformed snapshot before replacing the last good catalog", async()=>{
    const sync=app.get(CatalogSupplierSyncService);
    const item:SihSupplierItem={availableQuantity:1,game:"cs2",imageUrl:null,marketHashName:"AK-47 | Redline (Field-Tested)",priceMicrousd:1000000n};
    await sync.syncSihGame({game:"cs2",client:{getItems:()=>Promise.resolve([item])}});
    await expect(sync.syncSihGame({game:"cs2",client:{getItems:()=>Promise.resolve([])}})).rejects.toThrow();
    await expect(sync.syncSihGame({game:"cs2",client:{getItems:()=>Promise.resolve([{...item,priceMicrousd:-1n}])}})).rejects.toThrow();
    const result=await pool.query<{active:boolean}>("SELECT active FROM supplier_listings WHERE market_hash_name=$1",[item.marketHashName]);
    expect(result.rows[0]?.active).toBe(true);
  });

});
