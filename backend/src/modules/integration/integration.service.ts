import { Inject, Injectable } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { isArcPayConfigured } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";

type IntegrationManifest = {
  readonly site: {
    readonly key: string;
    readonly displayName: "Shards";
    readonly publicOrigin: string;
    readonly adminOrigin: string;
    readonly adminAllowedHosts: readonly string[];
  };
  readonly commerceEvents: {
    readonly schemaVersion: 1;
    readonly delivery: "site_to_vv_admin_webhook";
  };
  readonly healthChecks: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: "http_status" | "json_status";
    readonly method: "GET";
    readonly url: string;
    readonly timeoutMs: number;
    readonly intervalSeconds: number;
    readonly expect?: Record<string, unknown>;
  }[];
  readonly syntheticScenarios: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: "synthetic_transaction";
    readonly productionSafe: boolean;
    readonly effect: "creates_synthetic_entities";
    readonly requiresCleanup: boolean;
    readonly timeoutMs: number;
    readonly intervalSeconds: number;
    readonly run: { readonly method: "POST"; readonly url: string };
  }[];
  readonly actions: readonly {
    readonly key: string;
    readonly label: string;
    readonly category:
      | "payments.reconcile"
      | "fulfillment.reconcile"
      | "manual_fulfillment.list"
      | "manual_fulfillment.complete";
    readonly method: "GET" | "POST";
    readonly url: string;
    readonly effect: "read_only" | "recovery";
    readonly requiresIdempotencyKey: boolean;
  }[];
};

type IntegrationReadiness = {
  readonly status: "ok" | "degraded";
  readonly checks: {
    readonly postgres: "ok" | "not_configured";
    readonly redis: "ok" | "not_configured";
    readonly arcPay: "ok" | "not_configured";
    readonly sih: "ok" | "not_configured";
    readonly adminApi: "ok" | "not_configured";
  };
};

@Injectable()
export class IntegrationService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  manifest(): IntegrationManifest {
    const publicOrigin = this.config.integration.publicOrigin;
    const adminOrigin = this.config.integration.adminOrigin;
    const siteKey = this.config.integration.vvAdminSiteKey ?? "shards";
    return {
      site: {
        key: siteKey,
        displayName: "Shards",
        publicOrigin,
        adminOrigin,
        adminAllowedHosts: [new URL(adminOrigin).hostname],
      },
      commerceEvents: {
        schemaVersion: 1,
        delivery: "site_to_vv_admin_webhook",
      },
      healthChecks: [
        {
          key: "backend_http",
          label: "Backend",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/health/live`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "frontend_http",
          label: "Frontend",
          kind: "http_status",
          method: "GET",
          url: `${publicOrigin}/`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "postgres",
          label: "База данных",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/health/ready`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "redis",
          label: "Redis",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/admin/integration/health/redis`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "top_up_payment",
          label: "Arc Pay пополнение",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/admin/integration/health/top-up`,
          timeoutMs: 10000,
          intervalSeconds: 21600,
        },
        {
          key: "checkout_fulfillment",
          label: "Checkout и выдача",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/admin/integration/health/checkout`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "quote_storage",
          label: "Хранилище котировок",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/admin/integration/health/quote-storage`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "steam_refill",
          label: "Steam refill",
          kind: "http_status",
          method: "GET",
          url: `${adminOrigin}/admin/integration/health/steam-refill`,
          timeoutMs: 5000,
          intervalSeconds: 21600,
        },
        {
          key: "visible_catalog",
          label: "Товары в каталоге",
          kind: "json_status",
          method: "GET",
          url: `${adminOrigin}/admin/integration/health/catalog-visible`,
          timeoutMs: 10000,
          intervalSeconds: 21600,
          expect: { status: "ok" },
        },
        ...this.config.catalog.publicGames.map((game) => ({
          key: `catalog_${game}`,
          label: `Каталог ${game.toUpperCase()}`,
          kind: "http_status" as const,
          method: "GET" as const,
          url: `${adminOrigin}/admin/integration/health/catalog/${game}`,
          timeoutMs: 10000,
          intervalSeconds: 21600,
        })),

      ],
      syntheticScenarios: [
        {
          key: "checkout_payment_reached",
          label: "Проверить выход на оплату",
          kind: "synthetic_transaction",
          productionSafe: true,
          effect: "creates_synthetic_entities",
          requiresCleanup: true,
          timeoutMs: 60000,
          intervalSeconds: 21600,
          run: {
            method: "POST",
            url: `${adminOrigin}/admin/integration/scenarios/checkout-payment-reached/run`,
          },
        },
      ],
      actions: [
        {
          key: "payments_reconcile",
          label: "Reconcile payment provider top-ups",
          category: "payments.reconcile",
          method: "POST",
          url: `${adminOrigin}/admin/operations/payments/reconcile`,
          effect: "recovery",
          requiresIdempotencyKey: true,
        },
        {
          key: "fulfillment_reconcile",
          label: "Reconcile submitted SIH fulfillment",
          category: "fulfillment.reconcile",
          method: "POST",
          url: `${adminOrigin}/admin/operations/fulfillment/reconcile`,
          effect: "recovery",
          requiresIdempotencyKey: true,
        },
        {
          key: "operations_overview",
          label: "Read Shards admin operations overview",
          category: "manual_fulfillment.list",
          method: "GET",
          url: `${adminOrigin}/admin/operations/overview`,
          effect: "read_only",
          requiresIdempotencyKey: false,
        },

      ],
    };
  }

  readiness(): IntegrationReadiness {
    const checks = {
      postgres: this.config.databaseUrl ? "ok" : "not_configured",
      redis: this.config.redisUrl ? "ok" : "not_configured",
      arcPay:
        isArcPayConfigured(this.config.arcPay)
          ? "ok"
          : "not_configured",
      sih:
        this.config.sih.apiKeyFile && this.config.sih.steamRefillApiKeyFile
          ? "ok"
          : "not_configured",
      adminApi: this.config.admin.apiTokenFile ? "ok" : "not_configured",
    } as const;
    return {
      status: Object.values(checks).every((status) => status === "ok")
        ? "ok"
        : "degraded",
      checks,
    };
  }
}
