import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import type { CatalogMetadataProvider } from "./providers/metadata/catalog-metadata-provider";
import { CatalogMetadataSyncService } from "./catalog-metadata-sync.service";
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

describe.skipIf(!databaseUrl)("catalog metadata sync", () => {
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
    await pool.query("DELETE FROM catalog_products WHERE supplier_provider = 'sih' AND supplier_item_id = 'P250 | Sand Dune (Field-Tested)'");
  });

  it("stores provider metadata for active SIH listings and republishes covered products", async () => {
    const suppliers = app.get(CatalogSupplierSyncService);
    await suppliers.syncSihGame({
      client: {
        getItems: () => Promise.resolve([
          {
            availableQuantity: 4,
            game: "cs2",
            imageUrl: "https://community.cloudflare.steamstatic.com/economy/image/cs2-metal-facemask",
            marketHashName: "P250 | Sand Dune (Field-Tested)",
            priceMicrousd: 3_500_000n,
          },
        ]),
      },
      game: "cs2",
      observedAt: new Date("2026-07-31T13:00:00.000Z"),
    });

    const providerCommands: Array<{ marketHashNames: readonly string[] }> = [];
    const provider: CatalogMetadataProvider = {
      game: "cs2",
      locale: "ru",
      provider: "csgo_api",
      fetch: (command) => {
        providerCommands.push({ marketHashNames: command.marketHashNames });
        return Promise.resolve({
          collapsedDuplicateCount: 0,
          filteredOutCount: 0,
          game: "cs2",
          items: [
            {
              provider: "csgo_api",
              game: "cs2",
              locale: "ru",
              marketHashName: "P250 | Sand Dune (Field-Tested)",
              providerItemId: "123",
              title: "P250 | Sand Dune (Field-Tested)",
              description: "Protects the face.",
              categoryName: "Armor",
              productType: "Mask",
              rarityName: null,
              imageUrl: "https://cdn.example/cs2/metal-facemask.png",
              tags: ["Armor", "Mask"],
              raw: { itemShortName: "metal.facemask" },
            },
          ],
          locale: "ru",
          metadata: { fixture: "metadata-sync" },
          observedAt: new Date("2026-07-31T13:01:00.000Z"),
          provider: "csgo_api",
          sourceHash: "metadata-sync-cs2",
          sourceItemCount: 1,
          sourceUrl: "https://cs2.scmm.app/api/item",
        });
      },
    };

    const result = await app.get(CatalogMetadataSyncService).syncGame({
      game: "cs2",
      observedAt: new Date("2026-07-31T13:02:00.000Z"),
      provider,
    });

    expect(providerCommands).toEqual([{ marketHashNames: ["P250 | Sand Dune (Field-Tested)"] }]);
    expect(result).toMatchObject({
      activeSihListingCount: 1,
      game: "cs2",
      metadataItemCount: 1,
      promotedProductCount: 1,
      provider: "csgo_api",
      sourceHash: "metadata-sync-cs2",
      sourceItemCount: 1,
      status: "ok",
    });

    const product = await pool.query<{
      description: string;
      image: string | null;
      public_enabled: boolean;
      title: string;
    }>(
      `
        SELECT title, description, image, public_enabled
        FROM catalog_products
        WHERE supplier_provider = 'sih'
          AND supplier_item_id = 'P250 | Sand Dune (Field-Tested)'
      `,
    );
    expect(product.rows).toEqual([
      {
        description: "Protects the face.",
        image: "https://cdn.example/cs2/metal-facemask.png",
        public_enabled: true,
        title: "P250 | Sand Dune (Field-Tested)",
      },
    ]);
  });
});
