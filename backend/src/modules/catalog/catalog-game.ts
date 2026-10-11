export const CATALOG_GAMES = ["cs2"] as const;

// Historical database records and provider fixtures retain their original types.
export type CatalogGame = "cs2" | "rust" | "tf2";
export type CatalogMetadataProviderKey = "csgo_api" | "scmm" | "tf2_autobot";
export type CatalogMetadataLocale = "ru" | "en";

export type CatalogGameDefinition = {
  key: CatalogGame;
  label: string;
  steamAppId: number;
  sihAppId: number;
  metadataProvider: CatalogMetadataProviderKey;
  metadataLocale: CatalogMetadataLocale;
  metadataRequiredForPublication: boolean;
};

const catalogGameSet = new Set<string>(CATALOG_GAMES);

const catalogGameDefinitions: Record<CatalogGame, CatalogGameDefinition> = {
  cs2: {
    key: "cs2",
    label: "CS2",
    steamAppId: 730,
    sihAppId: 730,
    metadataProvider: "csgo_api",
    metadataLocale: "ru",
    metadataRequiredForPublication: false,
  },
  rust: {
    key: "rust",
    label: "Rust",
    steamAppId: 252490,
    sihAppId: 252490,
    metadataProvider: "scmm",
    metadataLocale: "en",
    metadataRequiredForPublication: true,
  },
  tf2: {
    key: "tf2",
    label: "Team Fortress 2",
    steamAppId: 440,
    sihAppId: 440,
    metadataProvider: "tf2_autobot",
    metadataLocale: "en",
    metadataRequiredForPublication: true,
  },
};

export function isCatalogGame(value: string): value is CatalogGame {
  return catalogGameSet.has(value);
}

export function parseCatalogGame(value: string | undefined | null): CatalogGame | null {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  if (normalized === undefined || normalized === "") return null;
  return isCatalogGame(normalized) ? normalized : null;
}

export function getCatalogGameDefinition(game: CatalogGame): CatalogGameDefinition {
  return catalogGameDefinitions[game];
}

export function parseCatalogPublicGames(raw: string | undefined): CatalogGame[] {
  const values = (raw ?? "cs2")
    .split(",")
    .map((value) => value.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean);
  const publicGames: CatalogGame[] = [];
  for (const value of values.length === 0 ? ["cs2"] : values) {
    if (!isCatalogGame(value)) {
      throw new Error(`CATALOG_PUBLIC_GAMES contains unsupported game: ${value}.`);
    }
    if (!publicGames.includes(value)) publicGames.push(value);
  }
  return publicGames;
}
