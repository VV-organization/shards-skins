import {StorefrontService} from '../storefront/storefront.service';
import { Pool } from "pg";
import Redis from "ioredis";
import { Inject, Injectable, Optional } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { isArcoPayConfigured } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import type { CapabilitiesResponse, LivenessResponse, ReadinessResponse } from "./health.types";

@Injectable()
export class HealthService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,@Optional() @Inject(StorefrontService) private readonly storefront?:StorefrontService) {}

  liveness(): LivenessResponse {
    return {
      status: "ok",
      service: "shards-api",
    };
  }

  async readiness(): Promise<ReadinessResponse> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    return { status: postgres === "ok" && redis === "ok" ? "ok" : "degraded", service: "shards-api", dependencies: { postgres, redis } };
  }

  private async checkPostgres(): Promise<"ok" | "not_configured" | "unavailable"> {
    if (!this.config.databaseUrl) return "not_configured";
    const pool = new Pool({ connectionString: this.config.databaseUrl, connectionTimeoutMillis: 1500, query_timeout: 1500, max: 1 });
    try { await pool.query("SELECT 1"); return "ok"; }
    catch { return "unavailable"; }
    finally { await pool.end(); }
  }

  private async checkRedis(): Promise<"ok" | "not_configured" | "unavailable"> {
    if (!this.config.redisUrl) return "not_configured";
    const redis = new Redis(this.config.redisUrl, { lazyConnect: true, connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null });
    redis.on("error", () => undefined);
    try { await redis.connect(); await redis.ping(); return "ok"; }
    catch { return "unavailable"; }
    finally { redis.disconnect(); }
  }

  async capabilities(): Promise<CapabilitiesResponse> {
    const storefront=await this.storefront?.getConfig();
    const reasons = [
      ...(this.config.databaseUrl ? [] : ["DATABASE_NOT_CONFIGURED"]),
      ...(this.config.redisUrl ? [] : ["REDIS_NOT_CONFIGURED"]),
      ...(isArcoPayConfigured(this.config.arcoPay) ? [] : ["ARCO_PAY_NOT_CONFIGURED"]),
      ...(this.config.sih.apiKeyFile ? [] : ["SIH_NOT_CONFIGURED"]),
    ];

    const hasCore = Boolean(this.config.databaseUrl && this.config.redisUrl);
    const hasArcoPay = isArcoPayConfigured(this.config.arcoPay);
    const hasSih = Boolean(this.config.sih.apiKeyFile);

    return {
      checkoutEnabled: Boolean(storefront?.capabilities.checkoutEnabled) && hasCore && hasSih,
      coinsTopUpEnabled: Boolean(storefront?.capabilities.walletTopUpEnabled) && hasCore && hasArcoPay,
      skinFulfillmentEnabled: Boolean(this.config.commerce?.fulfillmentEnabled) && hasCore && hasSih,
      steamRefillEnabled: Boolean(storefront?.capabilities.steamRefillEnabled) && hasCore && hasArcoPay,
      reasons,
    };
  }
}
