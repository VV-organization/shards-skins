import type { CatalogGame, CatalogMetadataLocale, CatalogMetadataProviderKey } from "./catalog-game";

export type CatalogMetadataSnapshotInput = {
  provider: CatalogMetadataProviderKey;
  game: CatalogGame;
  locale: CatalogMetadataLocale;
  sourceUrl: string;
  sourceHash: string;
  observedAt: Date;
  itemCount: number;
  filteredCount: number;
  metadata: Record<string, unknown>;
};

export type CatalogMetadataSnapshot = CatalogMetadataSnapshotInput & {
  id: string;
};

export type CatalogMetadataItemInput = {
  provider: CatalogMetadataProviderKey;
  game: CatalogGame;
  locale: CatalogMetadataLocale;
  marketHashName: string;
  providerItemId?: string | null;
  title: string;
  description?: string | null;
  categoryName?: string | null;
  productType?: string | null;
  rarityName?: string | null;
  imageUrl?: string | null;
  tags: string[];
  raw: Record<string, unknown>;
};

export type CatalogMetadataItem = CatalogMetadataItemInput & {
  snapshotId: string;
  updatedAt: Date;
};

export type CatalogMetadataCoverage = {
  provider: CatalogMetadataProviderKey;
  game: CatalogGame;
  locale: CatalogMetadataLocale;
  itemCount: number;
};
