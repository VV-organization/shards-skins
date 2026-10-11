import type { CatalogGame, CatalogMetadataLocale, CatalogMetadataProviderKey } from "../../catalog-game";
import type { CatalogMetadataItemInput } from "../../catalog-metadata.types";

export type CatalogMetadataFetchCommand = {
  game: CatalogGame;
  locale: CatalogMetadataLocale;
  marketHashNames: readonly string[];
  deadlineAtMs?: number;
};

export type CatalogMetadataProviderResult = {
  provider: CatalogMetadataProviderKey;
  game: CatalogGame;
  locale: CatalogMetadataLocale;
  sourceUrl: string;
  sourceHash: string;
  observedAt: Date;
  sourceItemCount: number;
  filteredOutCount: number;
  collapsedDuplicateCount: number;
  metadata: Record<string, unknown>;
  items: CatalogMetadataItemInput[];
};

export interface CatalogMetadataProvider {
  readonly game: CatalogGame;
  readonly locale: CatalogMetadataLocale;
  readonly provider: CatalogMetadataProviderKey;
  fetch(command: CatalogMetadataFetchCommand): Promise<CatalogMetadataProviderResult>;
}

export class CatalogMetadataProviderUnavailableError extends Error {
  constructor() {
    super("CATALOG_METADATA_PROVIDER_UNAVAILABLE");
    this.name = CatalogMetadataProviderUnavailableError.name;
  }
}
