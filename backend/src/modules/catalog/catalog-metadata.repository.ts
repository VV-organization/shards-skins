import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import type {
  CatalogMetadataCoverage,
  CatalogMetadataItem,
  CatalogMetadataItemInput,
  CatalogMetadataSnapshot,
  CatalogMetadataSnapshotInput,
} from "./catalog-metadata.types";
import type { CatalogGame, CatalogMetadataLocale, CatalogMetadataProviderKey } from "./catalog-game";

type DatabaseTransactionClient = Parameters<Parameters<DatabaseService["transaction"]>[0]>[0];

function assertMetadataSnapshot(input: CatalogMetadataSnapshotInput): void {
  if (!Number.isFinite(input.observedAt.getTime())) throw new Error("CATALOG_METADATA_OBSERVED_AT_INVALID");
  if (!Number.isSafeInteger(input.itemCount) || input.itemCount < 0) throw new Error("CATALOG_METADATA_ITEM_COUNT_INVALID");
  if (!Number.isSafeInteger(input.filteredCount) || input.filteredCount < 0) throw new Error("CATALOG_METADATA_FILTERED_COUNT_INVALID");
}

function assertMetadataItem(input: CatalogMetadataItemInput): void {
  if (input.marketHashName.trim() === "") throw new Error("CATALOG_METADATA_MARKET_HASH_NAME_REQUIRED");
  if (input.title.trim() === "") throw new Error("CATALOG_METADATA_TITLE_REQUIRED");
}

function rowToMetadataItem(row: {
  provider: CatalogMetadataProviderKey;
  game: CatalogGame;
  locale: CatalogMetadataLocale;
  market_hash_name: string;
  provider_item_id: string | null;
  title: string;
  description: string | null;
  category_name: string | null;
  product_type: string | null;
  rarity_name: string | null;
  image_url: string | null;
  tags: string[];
  raw: Record<string, unknown>;
  snapshot_id: string;
  updated_at: Date;
}): CatalogMetadataItem {
  return {
    provider: row.provider,
    game: row.game,
    locale: row.locale,
    marketHashName: row.market_hash_name,
    providerItemId: row.provider_item_id,
    title: row.title,
    description: row.description,
    categoryName: row.category_name,
    productType: row.product_type,
    rarityName: row.rarity_name,
    imageUrl: row.image_url,
    tags: row.tags,
    raw: row.raw,
    snapshotId: row.snapshot_id,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class CatalogMetadataRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createMetadataSnapshot(input: CatalogMetadataSnapshotInput): Promise<CatalogMetadataSnapshot> {
    assertMetadataSnapshot(input);
    const result = await this.database.query<{ id: string }>(
      `
        INSERT INTO catalog_metadata_snapshots (
          provider,
          game,
          locale,
          source_url,
          source_hash,
          observed_at,
          item_count,
          filtered_count,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (provider, game, locale, source_hash) DO UPDATE
        SET observed_at = EXCLUDED.observed_at,
            item_count = EXCLUDED.item_count,
            filtered_count = EXCLUDED.filtered_count,
            metadata = EXCLUDED.metadata
        RETURNING id
      `,
      [
        input.provider,
        input.game,
        input.locale,
        input.sourceUrl,
        input.sourceHash,
        input.observedAt,
        input.itemCount,
        input.filteredCount,
        JSON.stringify(input.metadata),
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("CATALOG_METADATA_SNAPSHOT_NOT_STORED");
    return { ...input, id };
  }

  async replaceMetadataItems(snapshotId: string, items: CatalogMetadataItemInput[]): Promise<number> {
    for (const item of items) assertMetadataItem(item);
    return this.database.transaction(async (tx) => this.replaceMetadataItemsInTransaction(tx, snapshotId, items));
  }

  async findMetadataForListings(game: CatalogGame, marketHashNames: readonly string[]): Promise<CatalogMetadataItem[]> {
    if (marketHashNames.length === 0) return [];
    const result = await this.database.query<Parameters<typeof rowToMetadataItem>[0]>(
      `
        SELECT
          provider,
          game,
          locale,
          market_hash_name,
          provider_item_id,
          title,
          description,
          category_name,
          product_type,
          rarity_name,
          image_url,
          tags,
          raw,
          snapshot_id,
          updated_at
        FROM catalog_metadata_items
        WHERE game = $1
          AND market_hash_name = ANY($2::text[])
        ORDER BY market_hash_name ASC
      `,
      [game, marketHashNames],
    );
    return result.rows.map(rowToMetadataItem);
  }

  async getMetadataCoverage(
    game: CatalogGame,
    provider: CatalogMetadataProviderKey,
    locale: CatalogMetadataLocale,
  ): Promise<CatalogMetadataCoverage> {
    const result = await this.database.query<{ total: string }>(
      `
        SELECT count(*)::text AS total
        FROM catalog_metadata_items
        WHERE provider = $1
          AND game = $2
          AND locale = $3
      `,
      [provider, game, locale],
    );
    return {
      provider,
      game,
      locale,
      itemCount: Number(result.rows[0]?.total ?? 0),
    };
  }

  async getLatestMetadataSnapshot(
    provider: CatalogMetadataProviderKey,
    game: CatalogGame,
    locale: CatalogMetadataLocale,
  ): Promise<CatalogMetadataSnapshot | null> {
    const result = await this.database.query<{
      id: string;
      provider: CatalogMetadataProviderKey;
      game: CatalogGame;
      locale: CatalogMetadataLocale;
      source_url: string;
      source_hash: string;
      observed_at: Date;
      item_count: number;
      filtered_count: number;
      metadata: Record<string, unknown>;
    }>(
      `
        SELECT id, provider, game, locale, source_url, source_hash, observed_at, item_count, filtered_count, metadata
        FROM catalog_metadata_snapshots
        WHERE provider = $1
          AND game = $2
          AND locale = $3
        ORDER BY observed_at DESC, created_at DESC
        LIMIT 1
      `,
      [provider, game, locale],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      provider: row.provider,
      game: row.game,
      locale: row.locale,
      sourceUrl: row.source_url,
      sourceHash: row.source_hash,
      observedAt: row.observed_at,
      itemCount: row.item_count,
      filteredCount: row.filtered_count,
      metadata: row.metadata,
    };
  }

  private async replaceMetadataItemsInTransaction(
    tx: DatabaseTransactionClient,
    snapshotId: string,
    items: CatalogMetadataItemInput[],
  ): Promise<number> {
    let rowCount = 0;
    for (const item of items) {
      await tx.query(
        `
          INSERT INTO catalog_metadata_items (
            provider,
            game,
            locale,
            market_hash_name,
            provider_item_id,
            title,
            description,
            category_name,
            product_type,
            rarity_name,
            image_url,
            tags,
            raw,
            snapshot_id,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::jsonb, $14, clock_timestamp())
          ON CONFLICT (provider, game, locale, market_hash_name) DO UPDATE
          SET provider_item_id = EXCLUDED.provider_item_id,
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              category_name = EXCLUDED.category_name,
              product_type = EXCLUDED.product_type,
              rarity_name = EXCLUDED.rarity_name,
              image_url = EXCLUDED.image_url,
              tags = EXCLUDED.tags,
              raw = EXCLUDED.raw,
              snapshot_id = EXCLUDED.snapshot_id,
              updated_at = clock_timestamp()
        `,
        [
          item.provider,
          item.game,
          item.locale,
          item.marketHashName,
          item.providerItemId ?? null,
          item.title,
          item.description ?? null,
          item.categoryName ?? null,
          item.productType ?? null,
          item.rarityName ?? null,
          item.imageUrl ?? null,
          item.tags,
          JSON.stringify(item.raw),
          snapshotId,
        ],
      );
      rowCount += 1;
    }
    return rowCount;
  }
}
