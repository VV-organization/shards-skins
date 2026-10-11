import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { CatalogMetadataRepository } from "./catalog-metadata.repository";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("catalog metadata repository", () => {
  let app: INestApplication;
  let pool: Pool;
  let repository: CatalogMetadataRepository;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    app = await createApp();
    repository = app.get(CatalogMetadataRepository);
    await pool.query("TRUNCATE catalog_metadata_items, catalog_metadata_snapshots RESTART IDENTITY");
  });

  it("stores metadata snapshots and replaces item data by provider/game/locale/market hash", async () => {
    const firstSnapshot = await repository.createMetadataSnapshot({
      provider: "scmm",
      game: "rust",
      locale: "en",
      sourceUrl: "https://rust.scmm.app/api/item",
      sourceHash: "rust-source-v1",
      observedAt: new Date("2026-07-31T10:00:00.000Z"),
      itemCount: 1,
      filteredCount: 0,
      metadata: { fixture: true },
    });

    await repository.replaceMetadataItems(firstSnapshot.id, [
      {
        provider: "scmm",
        game: "rust",
        locale: "en",
        marketHashName: "Metal Facemask",
        providerItemId: "metal-facemask",
        title: "Metal Facemask",
        description: "A protective Rust headwear item.",
        categoryName: "Armor",
        productType: "Headwear",
        rarityName: "Common",
        imageUrl: "https://cdn.example/rust/metal-facemask.png",
        tags: ["rust", "armor"],
        raw: { shortname: "metal.facemask" },
      },
    ]);

    const secondSnapshot = await repository.createMetadataSnapshot({
      provider: "scmm",
      game: "rust",
      locale: "en",
      sourceUrl: "https://rust.scmm.app/api/item",
      sourceHash: "rust-source-v2",
      observedAt: new Date("2026-07-31T10:05:00.000Z"),
      itemCount: 1,
      filteredCount: 0,
      metadata: { fixture: true },
    });

    await repository.replaceMetadataItems(secondSnapshot.id, [
      {
        provider: "scmm",
        game: "rust",
        locale: "en",
        marketHashName: "Metal Facemask",
        providerItemId: "metal-facemask",
        title: "Metal Facemask",
        description: "Updated Rust item description.",
        categoryName: "Armor",
        productType: "Mask",
        rarityName: "Common",
        imageUrl: "https://cdn.example/rust/metal-facemask-v2.png",
        tags: ["rust", "armor", "mask"],
        raw: { shortname: "metal.facemask", updated: true },
      },
    ]);

    const metadata = await repository.findMetadataForListings("rust", [
      "Metal Facemask",
      "Nonexistent Item",
    ]);

    expect(metadata).toEqual([
      expect.objectContaining({
        provider: "scmm",
        game: "rust",
        locale: "en",
        marketHashName: "Metal Facemask",
        title: "Metal Facemask",
        description: "Updated Rust item description.",
        categoryName: "Armor",
        productType: "Mask",
        rarityName: "Common",
        imageUrl: "https://cdn.example/rust/metal-facemask-v2.png",
        tags: ["rust", "armor", "mask"],
      }),
    ]);

    const coverage = await repository.getMetadataCoverage("rust", "scmm", "en");
    expect(coverage).toEqual({
      game: "rust",
      provider: "scmm",
      locale: "en",
      itemCount: 1,
    });
  });
});
