import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { createCatalogMetadataProviderRegistry } from "./catalog-metadata-providers";
import type { AppConfig } from "./config/app-config";
import { APP_CONFIG } from "./config/app-config.module";
import { CatalogMetadataSyncService } from "./modules/catalog/catalog-metadata-sync.service";
import { CatalogSupplierSyncService } from "./modules/catalog/catalog-supplier-sync.service";
import { SihClient } from "./modules/providers/sih/sih.client";

async function main(): Promise<void> {
  const registry = createCatalogMetadataProviderRegistry();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const config = app.get<AppConfig>(APP_CONFIG);
    const supplierSync = app.get(CatalogSupplierSyncService);
    const metadataSync = app.get(CatalogMetadataSyncService);
    const sih = app.get(SihClient, { strict: false });
    const games = [];
    for (const game of config.catalog.publicGames) {
      const supplier = await supplierSync.syncSihGame({ client: sih, game });
      const metadata = await metadataSync.syncGame({
        game,
        provider: registry.require(game),
      });
      games.push({
        activeSihListingCount: metadata.activeSihListingCount,
        game,
        metadataItemCount: metadata.metadataItemCount,
        promotedProductCount: metadata.promotedProductCount,
        provider: metadata.provider,
        sihRowCount: supplier.rowCount,
        sihRunId: supplier.runId,
        snapshotId: metadata.snapshotId,
        sourceHash: metadata.sourceHash,
      });
    }
    process.stdout.write(JSON.stringify({
      games,
      status: "ok",
    }));
    process.stdout.write("\n");
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "CATALOG_SYNC_ALL_GAMES_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
