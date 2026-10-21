import { describe, expect, it } from "vitest";

import type { AppConfig } from "../../config/app-config";
import { IntegrationService } from "./integration.service";

const config: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  databaseUrl: "postgres://shards:test@localhost:5432/shards",
  redisUrl: "redis://localhost:6379/0",
  admin: { apiTokenFile: "/run/secrets/admin-token" },
  steam: {},
  arcoPay: { bearerTokenFile: "/run/secrets/token", shopId:"1581", callbackUrl:"https://shards.example/payments/webhooks/arco-pay", paymentOrigin: "https://payment.paidlayer.com",
    apiUrl: "https://api.clickit.team/api/v1",
    environment: "sandbox",
    providerMode: "real",
    apiKeyFile: "/run/secrets/arcoPay",
    publicKeyFile: "/run/secrets/arcoPay-public",
    publicOrigin: "https://hkdk.events/source-id",
  },
  sih: {
    apiKeyFile: "/run/secrets/sih",
    marketBaseUrl: "https://api.sih.market",
    maximumBodyBytes: 4096,
    requestTimeoutMs: 2500,
    steamRefillApiKeyFile: "/run/secrets/sih-steam-refill",
    steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
  },
  catalog: { publicGames: ["cs2"] },
  notifications: {
    smtpHost: "smtp.purelymail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  integration: {
    publicOrigin: "https://shards.example",
    adminOrigin: "https://api.shards.example",
    vvAdminSiteKey: "shards",
    vvAdminWebhookSiteKey: "shards-webhook-site-key",
    vvAdminWebhookSecretFile: "/run/secrets/vv-admin-integration-secret",
  },
  corsOrigins: [],
};

describe("IntegrationService", () => {
  it("publishes the current VV Admin manifest with CS2 and Steam capabilities", () => {
    const manifest = new IntegrationService(config).manifest();

    expect(manifest).toMatchObject({
      site: {
        key: "shards",
        displayName: "Shards",
        publicOrigin: "https://shards.example",
        adminOrigin: "https://api.shards.example",
        adminAllowedHosts: ["api.shards.example"],
      },
      commerceEvents: {
        schemaVersion: 1,
        delivery: "site_to_vv_admin_webhook",
      },
    });
    expect(manifest).not.toHaveProperty("protocolVersion");
    expect(manifest.healthChecks.map((check) => check.key)).toEqual([
      "backend_http",
      "frontend_http",
      "postgres",
      "redis",
      "top_up_payment",
      "checkout_fulfillment",
      "quote_storage",
      "steam_refill",
      "visible_catalog",
      "catalog_cs2",
    ]);
    expect(manifest).not.toHaveProperty("catalog");
    expect(manifest).not.toHaveProperty("storeOrders");
    expect(manifest.syntheticScenarios).toEqual([
      expect.objectContaining({
        key: "checkout_payment_reached",
        label: "Проверить выход на оплату",
        kind: "synthetic_transaction",
        productionSafe: true,
        effect: "creates_synthetic_entities",
        requiresCleanup: true,
        run: {
          method: "POST",
          url: "https://api.shards.example/admin/integration/scenarios/checkout-payment-reached/run",
        },
      }),
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/secret|token|password/i);
  });

  it("reports readiness from configured dependencies", () => {
    expect(new IntegrationService(config).readiness()).toEqual({
      status: "ok",
      checks: {
        postgres: "ok",
        redis: "ok",
        arcoPay: "ok",
        sih: "ok",
        adminApi: "ok",
      },
    });
  });
});
