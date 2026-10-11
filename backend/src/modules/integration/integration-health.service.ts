import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";

import { DatabaseService } from "../../common/database/database.service";
import type { AppConfig } from "../../config/app-config";
import { isArcPayConfigured } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { type CatalogGame } from "../catalog/catalog-game";

export type IntegrationHealthResult = {
  readonly status: "ok" | "down";
  readonly reasons?: readonly string[];
  readonly total?: number;
  readonly byGame?: Partial<Record<CatalogGame, number>>;
};

@Injectable()
export class IntegrationHealthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async postgres(): Promise<IntegrationHealthResult> {
    try {
      await this.database.query("SELECT 1");
      return { status: "ok" };
    } catch (error) {
      return down(error, "POSTGRES_UNAVAILABLE");
    }
  }

  async redis(): Promise<IntegrationHealthResult> {
    if (!this.config.redisUrl) return { status: "down", reasons: ["REDIS_URL_MISSING"] };
    const client = new Redis(this.config.redisUrl, {
      connectTimeout: 2000,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });
    try {
      await client.connect();
      await client.ping();
      return { status: "ok" };
    } catch (error) {
      return down(error, "REDIS_UNAVAILABLE");
    } finally {
      client.disconnect();
    }
  }

  topUp(): IntegrationHealthResult {
    const ok = isArcPayConfigured(this.config.arcPay);
    return ok ? { status: "ok" } : { status: "down", reasons: ["ARC_PAY_TOP_UP_NOT_CONFIGURED"] };
  }

  checkout(): IntegrationHealthResult {
    const ok = Boolean(this.config.databaseUrl && this.config.redisUrl && this.config.arcPay.publicOrigin);
    return ok ? { status: "ok" } : { status: "down", reasons: ["CHECKOUT_NOT_CONFIGURED"] };
  }

  quoteStorage(): Promise<IntegrationHealthResult> {
    return this.countRows(
      `
        SELECT count(*)::text AS total
        FROM supplier_listings
        WHERE active = true
          AND available_quantity > 0
          AND price_microusd > 0
      `,
      [],
      "QUOTE_STORAGE_EMPTY",
    );
  }

  steamRefill(): IntegrationHealthResult {
    return this.config.sih.steamRefillApiKeyFile
      ? { status: "ok" }
      : { status: "down", reasons: ["SIH_STEAM_REFILL_NOT_CONFIGURED"] };
  }

  async visibleCatalog(): Promise<IntegrationHealthResult> {
    const byGame: Partial<Record<CatalogGame, number>> = {};
    let total = 0;
    const reasons: string[] = [];
    for (const game of this.config.catalog.publicGames) {
      const result = await this.catalogGame(game);
      byGame[game] = result.total ?? 0;
      total += result.total ?? 0;
      if (result.status !== "ok") reasons.push(...(result.reasons ?? []));
    }
    return total > 0 && reasons.length === 0
      ? { status: "ok", total, byGame }
      : { status: "down", total, byGame, reasons: reasons.length ? [...new Set(reasons)] : ["CATALOG_EMPTY"] };
  }

  catalogGame(game: CatalogGame): Promise<IntegrationHealthResult> {
    return this.countRows(
      `
        SELECT count(*)::text AS total
        FROM catalog_products
        WHERE kind = 'skins'
          AND lower(coalesce(game, '')) = $1
          AND public_enabled = true
      `,
      [game],
      `CATALOG_${game.toUpperCase()}_EMPTY`,
    );
  }

  private async countRows(
    sql: string,
    params: readonly unknown[],
    emptyReason: string,
  ): Promise<IntegrationHealthResult> {
    try {
      const result = await this.database.query<{ total: string }>(sql, params);
      const total = Number(result.rows[0]?.total ?? "0");
      return total > 0 ? { status: "ok", total } : { status: "down", total, reasons: [emptyReason] };
    } catch (error) {
      return down(error, emptyReason);
    }
  }
}

function down(error: unknown, fallback: string): IntegrationHealthResult {
  return {
    status: "down",
    reasons: [error instanceof Error ? error.message : fallback],
  };
}
