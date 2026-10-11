import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { createCatalogMetadataProviderRegistry } from "./catalog-metadata-providers";
import { CATALOG_GAMES, parseCatalogGame, type CatalogGame } from "./modules/catalog/catalog-game";
import { CatalogMetadataSyncService } from "./modules/catalog/catalog-metadata-sync.service";

function parseGames(args: string[]): CatalogGame[] {
  const gameArg = args.find((arg) => arg.startsWith("--game="));
  if (gameArg === undefined) return [...CATALOG_GAMES];
  const value = gameArg.slice("--game=".length).trim().toLowerCase();
  if (value === "all") return [...CATALOG_GAMES];
  const parsed = parseCatalogGame(value);
  if (parsed === null) throw new Error("CATALOG_METADATA_SYNC_GAME_INVALID");
  return [parsed];
}

async function main(): Promise<void> {
  const games = parseGames(process.argv.slice(2));
  const registry = createCatalogMetadataProviderRegistry();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const sync = app.get(CatalogMetadataSyncService);
    const results = [];
    for (const game of games) {
      results.push(await sync.syncGame({
        game,
        provider: registry.require(game),
      }));
    }
    process.stdout.write(JSON.stringify({
      games: results,
      status: "ok",
    }));
    process.stdout.write("\n");
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "CATALOG_METADATA_SYNC_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
