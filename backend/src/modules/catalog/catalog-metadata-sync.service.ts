import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import { getCatalogGameDefinition, type CatalogGame } from "./catalog-game";
import { CatalogMetadataRepository } from "./catalog-metadata.repository";
import { CatalogSupplierSyncService } from "./catalog-supplier-sync.service";
import type { CatalogMetadataProvider, CatalogMetadataProviderResult } from "./providers/metadata/catalog-metadata-provider";

export type CatalogMetadataSyncCommand = {
  game: CatalogGame;
  observedAt?: Date;
  provider: CatalogMetadataProvider;
};

export type CatalogMetadataSyncResult = {
  activeSihListingCount: number;
  collapsedDuplicateCount: number;
  filteredOutCount: number;
  game: CatalogGame;
  metadataItemCount: number;
  promotedProductCount: number;
  provider: string;
  snapshotId: string;
  sourceHash: string;
  sourceItemCount: number;
  sourceUrl: string;
  status: "ok";
};

function assertObservedAt(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("CATALOG_METADATA_SYNC_OBSERVED_AT_INVALID");
  return value;
}

function validateProviderResult(result: CatalogMetadataProviderResult, command: CatalogMetadataSyncCommand): void {
  const definition = getCatalogGameDefinition(command.game);
  if (
    command.provider.game !== command.game ||
    command.provider.provider !== definition.metadataProvider ||
    command.provider.locale !== definition.metadataLocale ||
    result.game !== command.game ||
    result.provider !== definition.metadataProvider ||
    result.locale !== definition.metadataLocale ||
    !Array.isArray(result.items)
  ) {
    throw new Error("CATALOG_METADATA_SYNC_PROVIDER_MISMATCH");
  }
}

@Injectable()
export class CatalogMetadataSyncService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogMetadataRepository) private readonly metadata: CatalogMetadataRepository,
    @Inject(CatalogSupplierSyncService) private readonly suppliers: CatalogSupplierSyncService,
  ) {}

  async syncGame(command: CatalogMetadataSyncCommand): Promise<CatalogMetadataSyncResult> {
    if (command.game !== "cs2") throw new Error("CATALOG_GAME_UNSUPPORTED");
    const observedAt = assertObservedAt(command.observedAt ?? new Date());
    const definition = getCatalogGameDefinition(command.game);
    const activeMarketHashNames = await this.activeSihMarketHashNames(command.game);
    const providerResult = await command.provider.fetch({
      game: command.game,
      locale: definition.metadataLocale,
      marketHashNames: activeMarketHashNames,
    });
    validateProviderResult(providerResult, command);
    const snapshot = await this.metadata.createMetadataSnapshot({
      provider: providerResult.provider,
      game: providerResult.game,
      locale: providerResult.locale,
      sourceUrl: providerResult.sourceUrl,
      sourceHash: providerResult.sourceHash,
      observedAt,
      itemCount: providerResult.sourceItemCount,
      filteredCount: providerResult.filteredOutCount,
      metadata: {
        ...providerResult.metadata,
        activeSihListingCount: activeMarketHashNames.length,
        collapsedDuplicateCount: providerResult.collapsedDuplicateCount,
      },
    });
    await this.metadata.replaceMetadataItems(snapshot.id, providerResult.items);
    const promoted = await this.suppliers.promoteActiveSihListings(command.game);
    return {
      activeSihListingCount: activeMarketHashNames.length,
      collapsedDuplicateCount: providerResult.collapsedDuplicateCount,
      filteredOutCount: providerResult.filteredOutCount,
      game: command.game,
      metadataItemCount: providerResult.items.length,
      promotedProductCount: promoted.promotedProductCount,
      provider: providerResult.provider,
      snapshotId: snapshot.id,
      sourceHash: providerResult.sourceHash,
      sourceItemCount: providerResult.sourceItemCount,
      sourceUrl: providerResult.sourceUrl,
      status: "ok",
    };
  }

  private async activeSihMarketHashNames(game: CatalogGame): Promise<string[]> {
    const result = await this.database.query<{ market_hash_name: string }>(
      `
        SELECT market_hash_name
        FROM supplier_listings
        WHERE supplier = 'sih'
          AND game = $1
          AND active = true
          AND available_quantity > 0
          AND price_microusd > 0
        ORDER BY market_hash_name ASC
      `,
      [game],
    );
    return result.rows.map((row) => row.market_hash_name);
  }
}
