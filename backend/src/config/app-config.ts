import { optionalString, optionalStringFromFile } from "./secret-file";
import { parseCatalogPublicGames, type CatalogGame } from "../modules/catalog/catalog-game";

export type AppNodeEnv = "development" | "test" | "production";
export type ArcoPayEnvironment = "sandbox" | "live";
export type ArcoPayProviderMode = "disabled" | "fake" | "real";

export type AppConfig = {
  commerce?: { guestSteamRefillEnabled?: boolean; checkoutEnabled: boolean; paymentsEnabled: boolean; fulfillmentEnabled: boolean };
  nodeEnv: AppNodeEnv;
  port: number;
  databaseUrl?: string;
  redisUrl?: string;
  admin: {
    apiTokenFile?: string;
  };
  steam: {
    webApiKeyFile?: string;
  };
  arcoPay: {
    environment: ArcoPayEnvironment;
    providerMode: ArcoPayProviderMode;
    apiKeyFile?: string;
    bearerTokenFile?: string;
    shopId?: string;
    callbackUrl?: string;
    paymentOrigin: string;
    fakeCheckoutBaseUrl?: string;
    publicOrigin?: string;
    publicKeyFile?: string;
    apiUrl: string;
  };
  sih: {
    apiKeyFile?: string;
    marketBaseUrl: string;
    maximumBodyBytes: number;
    requestTimeoutMs: number;
    steamRefillApiKeyFile?: string;
    steamRefillBaseUrl: string;
  };
  catalog: {
    publicGames: CatalogGame[];
  };
  notifications: {
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUsername?: string;
    smtpPasswordFile?: string;
    smtpFrom?: string;
    slackOrdersWebhookUrlFile?: string;
  };
  integration: {
    publicOrigin: string;
    adminOrigin: string;
    vvAdminWebhookUrl?: string;
    vvAdminSiteKey?: string;
    vvAdminWebhookSiteKey?: string;
    vvAdminWebhookSecretFile?: string;
    protocolAuthSecretFile?: string;
  };
  corsOrigins: string[];
};

function parseNodeEnv(value: string | undefined): AppNodeEnv {
  if (!value) return "development";
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("NODE_ENV must be development, test, or production.");
}

function parsePort(value: string | undefined): number {
  const normalized = value?.trim() || "5199";
  if (!/^\d+$/.test(normalized)) throw new Error("PORT must be between 1 and 65535.");
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  return port;
}

function parseBoundedInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const normalized = value?.trim() || String(defaultValue);
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseHttpsUrl(name: string, value: string | undefined, defaultValue: string): string {
  const normalized = value?.trim() || defaultValue;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  return url.toString().replace(/\/$/, "");
}

function parseArcoPayEnvironment(value: string | undefined): ArcoPayEnvironment {
  if (!value) return "sandbox";
  if (value === "sandbox" || value === "live") return value;
  throw new Error("ARCO_PAY_ENVIRONMENT must be sandbox or live.");
}

function parseArcoPayProviderMode(nodeEnv: AppNodeEnv, value: string | undefined): ArcoPayProviderMode {
  const normalized = value?.trim() || "disabled";
  if (normalized !== "disabled" && normalized !== "fake" && normalized !== "real") {
    throw new Error("ARCO_PAY_PROVIDER_MODE must be disabled, fake, or real.");
  }
  if (nodeEnv === "production" && normalized === "fake") {
    throw new Error("ARCO_PAY_PROVIDER_MODE=fake is not allowed in production.");
  }
  return normalized;
}

function parseHttpOrHttpsBaseUrl(name: string, value: string | undefined): string | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
  return url.toString().replace(/\/$/, "");
}

function parseHttpsPublicBaseUrl(name: string, value: string | undefined): string | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid HTTPS base URL.`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`${name} must be a valid HTTPS base URL.`);
  }
  return url.toString().replace(/\/$/, "");
}

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  const normalized = optionalString(value);
  if (normalized === undefined) return defaultValue;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseProtocolKey(name: string, value: string | undefined): string | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) return undefined;
  if (/^[a-z][a-z0-9_]*$/.test(normalized)) return normalized;
  throw new Error(`${name} must be a lowercase protocol key.`);
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const databaseUrl = optionalString(env.DATABASE_URL) ?? optionalStringFromFile(env.DATABASE_URL_FILE);
  const redisUrl = optionalString(env.REDIS_URL);
  const arcoPayApiKeyFile = optionalString(env.ARCO_PAY_API_KEY_FILE);
  const bearerTokenFile = optionalString(env.ARCO_PAY_BEARER_TOKEN_FILE);
  const shopId = optionalString(env.ARCO_PAY_SHOP_ID);
  if (shopId !== undefined && !/^[1-9]\d*$/.test(shopId)) throw new Error("ARCO_PAY_SHOP_ID must be a positive integer.");
  const callbackUrl = parseHttpsPublicBaseUrl("ARCO_PAY_CALLBACK_URL", env.ARCO_PAY_CALLBACK_URL);
  const arcoPayProviderMode = parseArcoPayProviderMode(nodeEnv, env.ARCO_PAY_PROVIDER_MODE);
  const arcoPayFakeCheckoutBaseUrl = parseHttpOrHttpsBaseUrl("ARCO_PAY_FAKE_CHECKOUT_BASE_URL", env.ARCO_PAY_FAKE_CHECKOUT_BASE_URL);
  const arcoPayPublicOrigin = parseHttpsPublicBaseUrl("ARCO_PAY_PUBLIC_ORIGIN", env.ARCO_PAY_PUBLIC_ORIGIN);
  const arcoPayPublicKeyFile = optionalString(env.ARCO_PAY_PUBLIC_KEY_FILE);
  const steamWebApiKeyFile = optionalString(env.STEAM_WEB_API_KEY_FILE);
  const sihApiKeyFile = optionalString(env.SIH_API_KEY_FILE);
  const sihSteamRefillApiKeyFile = optionalString(env.SIH_STEAM_REFILL_API_KEY_FILE);
  const adminApiTokenFile = optionalString(env.ADMIN_API_TOKEN_FILE);
  const smtpHost = optionalString(env.PURELYMAIL_SMTP_HOST) ?? "smtp.purelymail.com";
  const smtpPort = parseBoundedInteger("PURELYMAIL_SMTP_PORT", env.PURELYMAIL_SMTP_PORT, 465, 1, 65_535);
  const smtpSecure = parseBoolean("PURELYMAIL_SMTP_SECURE", env.PURELYMAIL_SMTP_SECURE, true);
  const smtpUsername = optionalString(env.PURELYMAIL_SMTP_USERNAME);
  const smtpPasswordFile = optionalString(env.PURELYMAIL_SMTP_PASSWORD_FILE);
  const smtpFrom = optionalString(env.PURELYMAIL_SMTP_FROM);
  const slackOrdersWebhookUrlFile = optionalString(env.SLACK_ORDERS_WEBHOOK_URL_FILE);
  const integrationPublicOrigin =
    parseHttpsPublicBaseUrl("VV_ADMIN_PUBLIC_ORIGIN", env.VV_ADMIN_PUBLIC_ORIGIN) ??
    "https://shards.example";
  const integrationAdminOrigin =
    parseHttpsPublicBaseUrl("VV_ADMIN_API_ORIGIN", env.VV_ADMIN_API_ORIGIN) ??
    integrationPublicOrigin;
  const vvAdminWebhookUrl = parseHttpsPublicBaseUrl(
    "VV_ADMIN_WEBHOOK_URL",
    env.VV_ADMIN_WEBHOOK_URL,
  );
  const vvAdminSiteKey = parseProtocolKey("VV_ADMIN_SITE_KEY", env.VV_ADMIN_SITE_KEY);
  const vvAdminWebhookSiteKey = optionalString(env.VV_ADMIN_WEBHOOK_SITE_KEY);
  const vvAdminWebhookSecretFile = optionalString(
    env.VV_ADMIN_WEBHOOK_SECRET_FILE,
  );
  const protocolAuthSecretFile = optionalString(
    env.VV_ADMIN_INTEGRATION_SECRET_FILE,
  ) ?? vvAdminWebhookSecretFile;

  if (nodeEnv === "production" && smtpUsername !== undefined && smtpPasswordFile === undefined) {
    throw new Error("PURELYMAIL_SMTP_PASSWORD_FILE is required when PURELYMAIL_SMTP_USERNAME is configured in production.");
  }
  if (nodeEnv === "production" && smtpUsername !== undefined && smtpFrom === undefined) {
    throw new Error("PURELYMAIL_SMTP_FROM is required when PURELYMAIL_SMTP_USERNAME is configured in production.");
  }

  if (nodeEnv === "production") {
    if (!databaseUrl) throw new Error("DATABASE_URL is required in production.");
    for (const key of ["COOKIE_HMAC_SECRET", "DATA_ENCRYPTION_SECRET"] as const) {
      if (!env[key] || env[key].length < 32) throw new Error(`${key} must contain at least 32 characters in production.`);
    }
  }
  return {
    commerce: {
      guestSteamRefillEnabled: parseBoolean("GUEST_STEAM_REFILL_ENABLED", env.GUEST_STEAM_REFILL_ENABLED, false),
      checkoutEnabled: parseBoolean("SHARDS_CHECKOUT_ENABLED", env.SHARDS_CHECKOUT_ENABLED, false),
      paymentsEnabled: parseBoolean("SHARDS_PAYMENTS_ENABLED", env.SHARDS_PAYMENTS_ENABLED, false),
      fulfillmentEnabled: parseBoolean("SHARDS_FULFILLMENT_ENABLED", env.SHARDS_FULFILLMENT_ENABLED, false),
    },
    nodeEnv,
    port: parsePort(env.PORT),
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(redisUrl ? { redisUrl } : {}),
    admin: {
      ...(adminApiTokenFile ? { apiTokenFile: adminApiTokenFile } : {}),
    },
    steam: {
      ...(steamWebApiKeyFile ? { webApiKeyFile: steamWebApiKeyFile } : {}),
    },
    arcoPay: {
      apiUrl: parseHttpsUrl("ARCO_PAY_API_URL", env.ARCO_PAY_API_URL, "https://api.clickit.team/api/v1"),
      paymentOrigin: parseHttpsPublicBaseUrl("ARCO_PAY_PAYMENT_ORIGIN", env.ARCO_PAY_PAYMENT_ORIGIN) ?? "https://payment.paidlayer.com",
      ...(bearerTokenFile ? { bearerTokenFile } : {}),
      ...(shopId ? { shopId } : {}),
      ...(callbackUrl ? { callbackUrl } : {}),
      environment: parseArcoPayEnvironment(env.ARCO_PAY_ENVIRONMENT),
      providerMode: arcoPayProviderMode,
      ...(arcoPayApiKeyFile ? { apiKeyFile: arcoPayApiKeyFile } : {}),
      ...(arcoPayFakeCheckoutBaseUrl ? { fakeCheckoutBaseUrl: arcoPayFakeCheckoutBaseUrl } : {}),
      ...(arcoPayPublicOrigin ? { publicOrigin: arcoPayPublicOrigin } : {}),
      ...(arcoPayPublicKeyFile ? { publicKeyFile: arcoPayPublicKeyFile } : {}),
    },
    sih: {
      ...(sihApiKeyFile ? { apiKeyFile: sihApiKeyFile } : {}),
      marketBaseUrl: parseHttpsUrl("SIH_MARKET_BASE_URL", env.SIH_MARKET_BASE_URL, "https://api.sih.market"),
      maximumBodyBytes: parseBoundedInteger("SIH_RESPONSE_MAX_BYTES", env.SIH_RESPONSE_MAX_BYTES, 16_777_216, 1_024, 16_777_216),
      requestTimeoutMs: parseBoundedInteger("SIH_REQUEST_TIMEOUT_MS", env.SIH_REQUEST_TIMEOUT_MS, 60_000, 500, 120_000),
      ...(sihSteamRefillApiKeyFile ? { steamRefillApiKeyFile: sihSteamRefillApiKeyFile } : {}),
      steamRefillBaseUrl: parseHttpsUrl("SIH_STEAM_REFILL_BASE_URL", env.SIH_STEAM_REFILL_BASE_URL, "https://core.steaminventoryhelper.com"),
    },
    catalog: {
      publicGames: parseCatalogPublicGames(env.CATALOG_PUBLIC_GAMES),
    },
    notifications: {
      smtpHost,
      smtpPort,
      smtpSecure,
      ...(smtpUsername ? { smtpUsername } : {}),
      ...(smtpPasswordFile ? { smtpPasswordFile } : {}),
      ...(smtpFrom ? { smtpFrom } : {}),
      ...(slackOrdersWebhookUrlFile ? { slackOrdersWebhookUrlFile } : {}),
    },
    integration: {
      publicOrigin: integrationPublicOrigin,
      adminOrigin: integrationAdminOrigin,
      ...(vvAdminWebhookUrl ? { vvAdminWebhookUrl } : {}),
      ...(vvAdminSiteKey ? { vvAdminSiteKey } : {}),
      ...(vvAdminWebhookSiteKey ? { vvAdminWebhookSiteKey } : {}),
      ...(vvAdminWebhookSecretFile ? { vvAdminWebhookSecretFile } : {}),
      ...(protocolAuthSecretFile ? { protocolAuthSecretFile } : {}),
    },
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
  };
}

export function isArcoPayConfigured(config: AppConfig["arcoPay"]): boolean {
  return config.providerMode === "real" && Boolean(
    config.apiKeyFile && config.bearerTokenFile && config.shopId &&
    config.callbackUrl && config.publicKeyFile && config.publicOrigin,
  );
}
