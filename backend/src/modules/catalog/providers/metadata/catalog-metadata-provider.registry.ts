import { CATALOG_GAMES, getCatalogGameDefinition, type CatalogGame } from "../../catalog-game";
import type { CatalogMetadataProvider } from "./catalog-metadata-provider";

function invalidRegistration(): never {
  throw new Error("CATALOG_METADATA_PROVIDER_REGISTRATION_INVALID");
}

function isSupportedGame(value: unknown): value is CatalogGame {
  return typeof value === "string" && CATALOG_GAMES.some((game) => game === value);
}

export class CatalogMetadataProviderRegistry {
  private readonly byGame = new Map<CatalogGame, CatalogMetadataProvider>();
  private readonly registeredGames: readonly CatalogGame[];

  constructor(providers: readonly CatalogMetadataProvider[]) {
    if (providers.length === 0) throw new Error("CATALOG_METADATA_PROVIDER_REGISTRY_EMPTY");
    const games: CatalogGame[] = [];
    for (const provider of providers) {
      const candidate: unknown = provider;
      if (typeof candidate !== "object" || candidate === null || !isSupportedGame(provider.game)) {
        invalidRegistration();
      }
      const definition = getCatalogGameDefinition(provider.game);
      if (
        provider.provider !== definition.metadataProvider ||
        provider.locale !== definition.metadataLocale ||
        typeof provider.fetch !== "function"
      ) {
        invalidRegistration();
      }
      if (this.byGame.has(provider.game)) throw new Error("CATALOG_METADATA_PROVIDER_DUPLICATE_GAME");
      this.byGame.set(provider.game, provider);
      games.push(provider.game);
    }
    this.registeredGames = Object.freeze(games);
  }

  games(): readonly CatalogGame[] {
    return this.registeredGames;
  }

  require(game: CatalogGame): CatalogMetadataProvider {
    const provider = this.byGame.get(game);
    if (provider === undefined) throw new Error("CATALOG_METADATA_PROVIDER_NOT_REGISTERED");
    return provider;
  }
}
