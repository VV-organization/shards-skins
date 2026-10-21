import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isArcoPayConfigured, loadAppConfig } from "./app-config";

describe("loadAppConfig", () => {
  it("parses runtime urls, secret-file paths, and CORS origins without exposing secret values", () => {
    expect(loadAppConfig({
      NODE_ENV: "test",
      PORT: "4100",
      DATABASE_URL: "postgres://shards:test@localhost:5432/shards",
      REDIS_URL: "redis://localhost:6379/0",
      ARCO_PAY_ENVIRONMENT: "sandbox",
      ARCO_PAY_PROVIDER_MODE: "fake",
      ARCO_PAY_API_KEY_FILE: "/run/secrets/arcoPay-secret",
      ARCO_PAY_FAKE_CHECKOUT_BASE_URL: "http://localhost:3999",
      ARCO_PAY_PUBLIC_ORIGIN: "https://hkdk.events/source-id/",
      ARCO_PAY_PUBLIC_KEY_FILE: "/run/secrets/arco-pay-webhook-secret",
      STEAM_WEB_API_KEY_FILE: "/run/secrets/steam-web-api-key",
      SIH_API_KEY_FILE: "/run/secrets/sih-api-key",
      SIH_STEAM_REFILL_API_KEY_FILE: "/run/secrets/sih-steam-refill-api-key",
      SIH_MARKET_BASE_URL: "https://api.sih.market",
      SIH_STEAM_REFILL_BASE_URL: "https://core.steaminventoryhelper.com",
      SIH_REQUEST_TIMEOUT_MS: "2500",
      SIH_RESPONSE_MAX_BYTES: "4096",
      ADMIN_API_TOKEN_FILE: "/run/secrets/admin-api-token",
      PURELYMAIL_SMTP_USERNAME: "support@shards.example",
      PURELYMAIL_SMTP_PASSWORD_FILE: "/run/secrets/purelymail-smtp-password",
      PURELYMAIL_SMTP_FROM: "Shards <support@shards.example>",
      SLACK_ORDERS_WEBHOOK_URL_FILE: "/run/secrets/slack-apple-orders",
      VV_ADMIN_PUBLIC_ORIGIN: "https://shards.example",
      VV_ADMIN_API_ORIGIN: "https://api.shards.example",
      VV_ADMIN_WEBHOOK_URL: "https://admin.example/commerce/webhook",
      VV_ADMIN_SITE_KEY: "shards",
      VV_ADMIN_WEBHOOK_SITE_KEY: "shards-webhook-site-key",
      VV_ADMIN_WEBHOOK_SECRET_FILE: "/run/secrets/vv-admin-webhook-secret",
      CATALOG_PUBLIC_GAMES: "cs2",
      CORS_ORIGINS: "https://shards.example, https://admin.shards.example",
    })).toEqual({
      commerce: { checkoutEnabled: false, paymentsEnabled: false, fulfillmentEnabled: false, guestSteamRefillEnabled: false },
      nodeEnv: "test",
      port: 4100,
      databaseUrl: "postgres://shards:test@localhost:5432/shards",
      redisUrl: "redis://localhost:6379/0",
      admin: {
        apiTokenFile: "/run/secrets/admin-api-token",
      },
      steam: {
        webApiKeyFile: "/run/secrets/steam-web-api-key",
      },
      arcoPay: { paymentOrigin: "https://payment.paidlayer.com",
        apiUrl: "https://api.clickit.team/api/v1",
        environment: "sandbox",
        providerMode: "fake",
        apiKeyFile: "/run/secrets/arcoPay-secret",
        fakeCheckoutBaseUrl: "http://localhost:3999",
        publicOrigin: "https://hkdk.events/source-id",
        publicKeyFile: "/run/secrets/arco-pay-webhook-secret",
      },
      sih: {
        apiKeyFile: "/run/secrets/sih-api-key",
        marketBaseUrl: "https://api.sih.market",
        maximumBodyBytes: 4096,
        requestTimeoutMs: 2500,
        steamRefillApiKeyFile: "/run/secrets/sih-steam-refill-api-key",
        steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
      },
      catalog: {
        publicGames: ["cs2"],
      },
      notifications: {
        smtpHost: "smtp.purelymail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: "support@shards.example",
        smtpPasswordFile: "/run/secrets/purelymail-smtp-password",
        smtpFrom: "Shards <support@shards.example>",
        slackOrdersWebhookUrlFile: "/run/secrets/slack-apple-orders",
      },
      integration: {
        publicOrigin: "https://shards.example",
        adminOrigin: "https://api.shards.example",
        vvAdminWebhookUrl: "https://admin.example/commerce/webhook",
        vvAdminSiteKey: "shards",
        vvAdminWebhookSiteKey: "shards-webhook-site-key",
        vvAdminWebhookSecretFile: "/run/secrets/vv-admin-webhook-secret",
        protocolAuthSecretFile: "/run/secrets/vv-admin-webhook-secret",
      },
      corsOrigins: ["https://shards.example", "https://admin.shards.example"],
    });
  });

  it("fails closed on invalid ports and payment provider environments", () => {
    expect(() => loadAppConfig({ PORT: "0" })).toThrow("PORT must be between 1 and 65535.");
    expect(() => loadAppConfig({ ARCO_PAY_ENVIRONMENT: "qa" })).toThrow("ARCO_PAY_ENVIRONMENT must be sandbox or live.");
    expect(loadAppConfig({ ARCO_PAY_PROVIDER_MODE: "real" }).arcoPay.providerMode).toBe("real");
    expect(() => loadAppConfig({ ARCO_PAY_PROVIDER_MODE: "invalid" })).toThrow("ARCO_PAY_PROVIDER_MODE must be disabled, fake, or real.");
    expect(() => loadAppConfig({ NODE_ENV: "production", ARCO_PAY_PROVIDER_MODE: "fake" })).toThrow("ARCO_PAY_PROVIDER_MODE=fake is not allowed in production.");
    expect(() => loadAppConfig({ ARCO_PAY_FAKE_CHECKOUT_BASE_URL: "not-url" })).toThrow("ARCO_PAY_FAKE_CHECKOUT_BASE_URL must be a valid HTTP(S) URL.");
    expect(() => loadAppConfig({ ARCO_PAY_PUBLIC_ORIGIN: "http://shards.example" })).toThrow("ARCO_PAY_PUBLIC_ORIGIN must be a valid HTTPS base URL.");
    expect(() => loadAppConfig({ ARCO_PAY_PUBLIC_ORIGIN: "https://shards.example/path?query=1" })).toThrow("ARCO_PAY_PUBLIC_ORIGIN must be a valid HTTPS base URL.");
    expect(() => loadAppConfig({ VV_ADMIN_PUBLIC_ORIGIN: "http://shards.example" })).toThrow("VV_ADMIN_PUBLIC_ORIGIN must be a valid HTTPS base URL.");
    expect(() => loadAppConfig({ VV_ADMIN_SITE_KEY: "393a977013443bb19069045d36af4890" })).toThrow("VV_ADMIN_SITE_KEY must be a lowercase protocol key.");
    expect(() => loadAppConfig({ SIH_REQUEST_TIMEOUT_MS: "499" })).toThrow("SIH_REQUEST_TIMEOUT_MS must be between 500 and 120000.");
    expect(() => loadAppConfig({ SIH_RESPONSE_MAX_BYTES: "1023" })).toThrow("SIH_RESPONSE_MAX_BYTES must be between 1024 and 16777216.");
    expect(() => loadAppConfig({ CATALOG_PUBLIC_GAMES: "cs2,dota2" })).toThrow("CATALOG_PUBLIC_GAMES contains unsupported game: dota2.");
    expect(() => loadAppConfig({ NODE_ENV: "production", PURELYMAIL_SMTP_USERNAME: "support@shardsapp24.com" })).toThrow("PURELYMAIL_SMTP_PASSWORD_FILE is required");
    expect(loadAppConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://shards:local@localhost/shards",
      COOKIE_HMAC_SECRET: "c".repeat(32),
      DATA_ENCRYPTION_SECRET: "d".repeat(32),
      PURELYMAIL_SMTP_USERNAME: "support@shardsapp24.com",
      PURELYMAIL_SMTP_PASSWORD_FILE: "/run/secrets/purelymail-smtp-password",
      PURELYMAIL_SMTP_FROM: "Shards <support@shardsapp24.com>",
    }).notifications).toMatchObject({
      smtpHost: "smtp.purelymail.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: "support@shardsapp24.com",
      smtpPasswordFile: "/run/secrets/purelymail-smtp-password",
      smtpFrom: "Shards <support@shardsapp24.com>",
    });
  });

  it("loads DATABASE_URL from a secret file without requiring the value in env", () => {
    const directory = mkdtempSync(join(tmpdir(), "shards-config-"));
    const databaseUrlFile = join(directory, "database-url");
    writeFileSync(databaseUrlFile, "postgres://shards:secret@postgres:5432/shards\n", "utf8");

    expect(loadAppConfig({
      DATABASE_URL_FILE: databaseUrlFile,
    }).databaseUrl).toBe("postgres://shards:secret@postgres:5432/shards");
  });
});

describe("isArcoPayConfigured", () => {
  const credentials = {
    ARCO_PAY_BEARER_TOKEN_FILE: "/run/secrets/token",
    ARCO_PAY_SHOP_ID: "1581",
    ARCO_PAY_CALLBACK_URL: "https://shards.example/payments/webhooks/arco-pay",
    ARCO_PAY_PROVIDER_MODE: "real",
    ARCO_PAY_API_KEY_FILE: "/run/secrets/arco-pay-key",
    ARCO_PAY_PUBLIC_KEY_FILE: "/run/secrets/arco-pay-webhook",
    ARCO_PAY_PUBLIC_ORIGIN: "https://shards.example",
  };

  it("requires real mode and all settlement credentials before enabling payments", () => {
    expect(isArcoPayConfigured(loadAppConfig(credentials).arcoPay)).toBe(true);
    for (const missing of Object.keys(credentials)) {
      const incomplete = { ...credentials, [missing]: "" };
      expect(isArcoPayConfigured(loadAppConfig(incomplete).arcoPay)).toBe(false);
    }
    expect(isArcoPayConfigured(loadAppConfig({ ...credentials, ARCO_PAY_PROVIDER_MODE: "fake" }).arcoPay)).toBe(false);
  });
});
