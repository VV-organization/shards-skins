import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { CatalogSupplierSyncService } from "./modules/catalog/catalog-supplier-sync.service";
import type { SihCatalogGame } from "./modules/providers/sih/sih.types";

function parseGame(args: string[]): SihCatalogGame {
  const gameArg = args.find((arg) => arg.startsWith("--game="));
  const game = gameArg?.slice("--game=".length) || "cs2";
  if (game === "cs2" || game === "rust" || game === "tf2") return game;
  throw new Error("CATALOG_PROMOTE_GAME_INVALID");
}

async function main(): Promise<void> {
  const game = parseGame(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const sync = app.get(CatalogSupplierSyncService);
    const result = await sync.promoteActiveSihListings(game);
    process.stdout.write(JSON.stringify({
      game: result.game,
      promotedProductCount: result.promotedProductCount,
      status: "ok",
    }));
    process.stdout.write("\n");
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "CATALOG_PROMOTE_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
