import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { createCatalogMetadataProviderRegistry } from "./catalog-metadata-providers";
import type { AppConfig } from "./config/app-config";
import { APP_CONFIG } from "./config/app-config.module";
import type { CatalogGame } from "./modules/catalog/catalog-game";
import {
  CatalogMetadataSyncService,
  type CatalogMetadataSyncResult,
} from "./modules/catalog/catalog-metadata-sync.service";
import {
  CatalogSupplierSyncService,
  type CatalogSupplierSyncResult,
  type SihCatalogClient,
} from "./modules/catalog/catalog-supplier-sync.service";
import type { CatalogMetadataProvider } from "./modules/catalog/providers/metadata/catalog-metadata-provider";
import { SihClient } from "./modules/providers/sih/sih.client";

export type CatalogSyncWorkerOptions = {
  help: boolean;
  intervalMs: number;
  once: boolean;
};

type MetadataProviderRegistry = {
  require(game: CatalogGame): CatalogMetadataProvider;
};

type CatalogSyncWorkerDependencies = {
  games: readonly CatalogGame[];
  metadataProviders: MetadataProviderRegistry;
  metadataSync: Pick<CatalogMetadataSyncService, "syncGame">;
  sihClient: SihCatalogClient;
  supplierSync: Pick<CatalogSupplierSyncService, "syncSihGame">;
};

export type CatalogSyncWorkerCycleResult = {
  failures: Array<{
    error: string;
    game: CatalogGame;
  }>;
  games: Array<{
    activeSihListingCount: number;
    game: CatalogGame;
    metadataItemCount: number;
    promotedProductCount: number;
    provider: string;
    sihPromotedProductCount: number;
    sihRowCount: number;
    sihRunId: string;
    snapshotId: string;
  }>;
  status: "completed" | "partial";
};

function parseIntervalMs(value: string | undefined): number {
  const normalized = value?.trim() || "86400000";
  if (!/^\d+$/.test(normalized)) throw new Error("CATALOG_SYNC_WORKER_INTERVAL_MS_INVALID");
  const intervalMs = Number(normalized);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60_000 || intervalMs > 604_800_000) {
    throw new Error("CATALOG_SYNC_WORKER_INTERVAL_MS_INVALID");
  }
  return intervalMs;
}

export function parseCatalogSyncWorkerOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CatalogSyncWorkerOptions {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, intervalMs: 0, once: true };
  if (argv.includes("--watch") && argv.includes("--once")) throw new Error("CATALOG_SYNC_WORKER_MODE_INVALID");
  return {
    help: false,
    intervalMs: parseIntervalMs(env.CATALOG_SYNC_WORKER_INTERVAL_MS),
    once: !argv.includes("--watch"),
  };
}

export async function runCatalogSyncWorkerCycle(
  dependencies: CatalogSyncWorkerDependencies,
): Promise<CatalogSyncWorkerCycleResult> {
  const games: CatalogSyncWorkerCycleResult["games"] = [];
  const failures: CatalogSyncWorkerCycleResult["failures"] = [];
  for (const game of dependencies.games) {
    try {
      const supplier = await dependencies.supplierSync.syncSihGame({
        client: dependencies.sihClient,
        game,
      });
      const metadata = await dependencies.metadataSync.syncGame({
        game,
        provider: dependencies.metadataProviders.require(game),
      });
      games.push(cycleGameResult(game, supplier, metadata));
    } catch (error) {
      failures.push({
        error: error instanceof Error ? error.message : "CATALOG_SYNC_GAME_FAILED",
        game,
      });
    }
  }
  return { failures, games, status: failures.length === 0 ? "completed" : "partial" };
}

function cycleGameResult(
  game: CatalogGame,
  supplier: CatalogSupplierSyncResult,
  metadata: CatalogMetadataSyncResult,
): CatalogSyncWorkerCycleResult["games"][number] {
  return {
    activeSihListingCount: metadata.activeSihListingCount,
    game,
    metadataItemCount: metadata.metadataItemCount,
    promotedProductCount: metadata.promotedProductCount,
    provider: metadata.provider,
    sihPromotedProductCount: supplier.promotedProductCount,
    sihRowCount: supplier.rowCount,
    sihRunId: supplier.runId,
    snapshotId: metadata.snapshotId,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const options = parseCatalogSyncWorkerOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: catalog-sync-worker [--watch]\nRuns SIH and metadata catalog sync for configured public games.\n");
    return;
  }

  const metadataProviders = createCatalogMetadataProviderRegistry();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const state = { stopped: false };
  const stop = (): void => {
    state.stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const config = app.get<AppConfig>(APP_CONFIG);
    const dependencies: CatalogSyncWorkerDependencies = {
      games: config.catalog.publicGames,
      metadataProviders,
      metadataSync: app.get(CatalogMetadataSyncService),
      sihClient: app.get(SihClient, { strict: false }),
      supplierSync: app.get(CatalogSupplierSyncService),
    };
    for (;;) {
      try {
        const result = await runCatalogSyncWorkerCycle(dependencies);
        process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), result })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "CATALOG_SYNC_WORKER_CYCLE_FAILED";
        process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), error: message, status: "cycle_failed" })}\n`);
      }
      if (options.once || state.stopped) break;
      await sleep(options.intervalMs);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "CATALOG_SYNC_WORKER_FAILED"}\n`);
    process.exitCode = 1;
  });
}
