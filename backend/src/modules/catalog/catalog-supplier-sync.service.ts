import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import type { SihCatalogGame, SihSupplierItem } from "../providers/sih/sih.types";
import { getCatalogGameDefinition, type CatalogGame } from "./catalog-game";
import type { CatalogMetadataItem } from "./catalog-metadata.types";
import { createSihCatalogProjection } from "./catalog-product-projection";

export type SihCatalogClient = {
  getItems(command: { game: SihCatalogGame }): Promise<SihSupplierItem[]>;
};

export type CatalogSupplierSyncResult = {
  game: SihCatalogGame;
  runId: string;
  rowCount: number;
  promotedProductCount: number;
  source: "sih";
  status: "promoted";
};

export type SyncSihGameCommand = {
  client: SihCatalogClient;
  game: SihCatalogGame;
  observedAt?: Date;
};

type DatabaseTransactionClient = Parameters<Parameters<DatabaseService["transaction"]>[0]>[0];

function assertObservedAt(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("CATALOG_SYNC_OBSERVED_AT_INVALID");
  return value;
}

function snapshot(item: SihSupplierItem): Record<string, unknown> {
  return {
    availableQuantity: item.availableQuantity,
    game: item.game,
    imageUrl: item.imageUrl,
    marketHashName: item.marketHashName,
    priceMicrousd: item.priceMicrousd.toString(),
  };
}

@Injectable()
export class CatalogSupplierSyncService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async syncSihGame(command: SyncSihGameCommand): Promise<CatalogSupplierSyncResult> {
    if (command.game !== "cs2") throw new Error("CATALOG_GAME_UNSUPPORTED");
    const observedAt = assertObservedAt(command.observedAt ?? new Date());
    const items = await command.client.getItems({ game: command.game });
    if (items.some((item) => item.game !== command.game)) throw new Error("CATALOG_SYNC_GAME_MISMATCH");

    return this.database.transaction(async (tx) => {
      const run = await tx.query<{ id: string }>(
        `
          INSERT INTO catalog_sync_runs (
            source,
            game,
            status,
            observed_at,
            finished_at,
            row_count
          )
          VALUES ('sih', $1, 'promoted', $2, clock_timestamp(), $3)
          RETURNING id
        `,
        [command.game, observedAt, items.length],
      );
      const runId = run.rows[0]?.id;
      if (runId === undefined) throw new Error("CATALOG_SYNC_RUN_NOT_STORED");

      for (const item of items) {
        await tx.query(
          `
            INSERT INTO supplier_listings (
              supplier,
              game,
              market_hash_name,
              active,
              available_quantity,
              price_microusd,
              image_url,
              snapshot,
              first_seen_at,
              last_seen_at,
              last_sync_run_id
            )
            VALUES ('sih', $1, $2, true, $3, $4, $5, $6, $7, $7, $8)
            ON CONFLICT (supplier, game, market_hash_name) DO UPDATE
            SET active = true,
                available_quantity = EXCLUDED.available_quantity,
                price_microusd = EXCLUDED.price_microusd,
                image_url = EXCLUDED.image_url,
                snapshot = EXCLUDED.snapshot,
                last_seen_at = EXCLUDED.last_seen_at,
                last_sync_run_id = EXCLUDED.last_sync_run_id
          `,
          [
            item.game,
            item.marketHashName,
            item.availableQuantity,
            item.priceMicrousd.toString(),
            item.imageUrl,
            snapshot(item),
            observedAt,
            runId,
          ],
        );
      }

      await tx.query(
        `
          UPDATE supplier_listings
          SET active = false,
              last_sync_run_id = $1
          WHERE supplier = 'sih'
            AND game = $2
            AND last_sync_run_id <> $1
            AND active = true
        `,
        [runId, command.game],
      );
      const promotedProductCount = await this.promoteSihGameListingsInTransaction(tx, command.game);

      return {
        game: command.game,
        promotedProductCount,
        runId,
        rowCount: items.length,
        source: "sih",
        status: "promoted",
      };
    });
  }

  async promoteActiveSihListings(game: SihCatalogGame): Promise<{ game: SihCatalogGame; promotedProductCount: number }> {
    if (game !== "cs2") throw new Error("CATALOG_GAME_UNSUPPORTED");
    const promotedProductCount = await this.database.transaction((tx) => this.promoteSihGameListingsInTransaction(tx, game));
    return { game, promotedProductCount };
  }

  private async promoteSihGameListingsInTransaction(
    tx: DatabaseTransactionClient,
    game: SihCatalogGame,
  ): Promise<number> {
    const listings = await tx.query<{
      available_quantity: number;
      image_url: string | null;
      market_hash_name: string;
      price_microusd: string;
      snapshot: Record<string, unknown>;
      last_seen_at: Date;
    }>(
      `
        SELECT market_hash_name, available_quantity, price_microusd::text, image_url, snapshot, last_seen_at
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
    const definition = getCatalogGameDefinition(game);
    const publicGame = this.config.catalog.publicGames.includes(game);
    const metadataByMarketHashName = await this.metadataByMarketHashName(
      tx,
      game,
      definition.metadataProvider,
      definition.metadataLocale,
      listings.rows.map((listing) => listing.market_hash_name),
    );

    await tx.query(
      `
        UPDATE catalog_products
        SET public_enabled = false,
            updated_at = clock_timestamp()
        WHERE supplier_provider = 'seed'
          AND kind = 'skins'
          AND lower(coalesce(game, '')) NOT IN ('cs2', 'rust', 'tf2')
          AND public_enabled = true
      `,
    );

    await tx.query(
      `
        UPDATE catalog_products
        SET public_enabled = false,
            updated_at = clock_timestamp()
        WHERE supplier_provider = 'sih'
          AND kind = 'skins'
          AND lower(game) = $1
          AND supplier_item_id NOT IN (
            SELECT market_hash_name
            FROM supplier_listings
            WHERE supplier = 'sih'
              AND game = $1
              AND active = true
              AND available_quantity > 0
              AND price_microusd > 0
          )
      `,
      [game],
    );

    let promotedProductCount = 0;
    for (const listing of listings.rows) {
      const metadata = metadataByMarketHashName.get(listing.market_hash_name);
      const projection = createSihCatalogProjection({
        availableQuantity: listing.available_quantity,
        game,
        imageUrl: listing.image_url,
        marketHashName: listing.market_hash_name,
        ...(metadata === undefined ? {} : { metadata }),
      });
      const publicEnabled = publicGame
        && metadata !== undefined
        && metadata.imageUrl !== null
        && metadata.imageUrl !== undefined
        && metadata.description !== null
        && metadata.description !== undefined;
      const updated = await tx.query(
        `
          UPDATE catalog_products
          SET kind = 'skins',
              category = $2,
              game = $3,
              product_type = $4,
              title = $5,
              description = $6,
              price_coin_minor = 1,
              availability = 'available',
              fulfillment_mode = 'steam-trade',
              popularity = $7,
              image = COALESCE($8, catalog_products.image),
              image_alt = $9,
              meta = $10,
              keywords = $11,
              details = $12::jsonb,
              supplier_provider = 'sih',
              supplier_item_id = $13,
              supplier_snapshot = $14::jsonb,
              supplier_fresh_at = $15,
              public_enabled = $16,
              updated_at = clock_timestamp()
          WHERE supplier_provider = 'sih'
            AND supplier_item_id = $1
            AND lower(game) = $17
        `,
        [
          listing.market_hash_name,
          projection.category,
          projection.game,
          projection.productType,
          projection.title,
          projection.description,
          projection.popularity,
          projection.image,
          projection.imageAlt,
          projection.meta,
          projection.keywords,
          JSON.stringify(projection.details),
          listing.market_hash_name,
          JSON.stringify(listing.snapshot),
          listing.last_seen_at,
          publicEnabled,
          game,
        ],
      );

      if ((updated.rowCount ?? 0) === 0) {
        await tx.query(
          `
            INSERT INTO catalog_products (
              id,
              slug,
              kind,
              category,
              game,
              product_type,
              title,
              description,
              price_coin_minor,
              availability,
              fulfillment_mode,
              popularity,
              image,
              image_alt,
              meta,
              keywords,
              details,
              supplier_provider,
              supplier_item_id,
              supplier_snapshot,
              supplier_fresh_at,
              public_enabled,
              created_at,
              updated_at
            )
            VALUES ($1, $2, 'skins', $3, $4, $5, $6, $7, 1, 'available', 'steam-trade', $8, $9, $10, $11, $12, $13::jsonb, 'sih', $14, $15::jsonb, $16, $17, clock_timestamp(), clock_timestamp())
            ON CONFLICT (id) DO UPDATE
            SET category = EXCLUDED.category,
                game = EXCLUDED.game,
                product_type = EXCLUDED.product_type,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                popularity = EXCLUDED.popularity,
                image = COALESCE(EXCLUDED.image, catalog_products.image),
                image_alt = EXCLUDED.image_alt,
                meta = EXCLUDED.meta,
                keywords = EXCLUDED.keywords,
                details = EXCLUDED.details,
                supplier_provider = EXCLUDED.supplier_provider,
                supplier_item_id = EXCLUDED.supplier_item_id,
                supplier_snapshot = EXCLUDED.supplier_snapshot,
                supplier_fresh_at = EXCLUDED.supplier_fresh_at,
                public_enabled = EXCLUDED.public_enabled,
                updated_at = clock_timestamp()
          `,
          [
            projection.id,
            projection.slug,
            projection.category,
            projection.game,
            projection.productType,
            projection.title,
            projection.description,
            projection.popularity,
            projection.image,
            projection.imageAlt,
            projection.meta,
            projection.keywords,
            JSON.stringify(projection.details),
            listing.market_hash_name,
            JSON.stringify(listing.snapshot),
            listing.last_seen_at,
            publicEnabled,
          ],
        );
      }
      if (publicEnabled) promotedProductCount += 1;
    }

    return promotedProductCount;
  }

  private async metadataByMarketHashName(
    tx: DatabaseTransactionClient,
    game: CatalogGame,
    provider: string,
    locale: string,
    marketHashNames: readonly string[],
  ): Promise<Map<string, CatalogMetadataItem>> {
    if (marketHashNames.length === 0) return new Map();
    const result = await tx.query<{
      provider: CatalogMetadataItem["provider"];
      game: CatalogMetadataItem["game"];
      locale: CatalogMetadataItem["locale"];
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
    }>(
      `
        SELECT provider, game, locale, market_hash_name, provider_item_id, title, description, category_name, product_type, rarity_name, image_url, tags, raw, snapshot_id, updated_at
        FROM catalog_metadata_items
        WHERE provider = $1
          AND game = $2
          AND locale = $3
          AND market_hash_name = ANY($4::text[])
      `,
      [provider, game, locale, marketHashNames],
    );
    return new Map(result.rows.map((row) => [
      row.market_hash_name,
      {
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
      },
    ]));
  }
}
