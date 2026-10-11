import { describe, expect, it } from "vitest";

import type { AppConfig } from "../../config/app-config";
import { buildDatabaseConnectionOptions } from "./database.config";

const baseConfig: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  admin: {},
  steam: {},
  arcPay: { environment: "sandbox", providerMode: "disabled", apiUrl: "https://api.arcpay.space/v1" },
  sih: {
    marketBaseUrl: "https://api.sih.market",
    maximumBodyBytes: 16_777_216,
    requestTimeoutMs: 60_000,
    steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
  },
  catalog: {
    publicGames: ["cs2"],
  },
  notifications: {
    smtpHost: "smtp.purelymail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  integration: {
    publicOrigin: "https://shards.example",
    adminOrigin: "https://shards.example",
  },
  corsOrigins: [],
};

describe("buildDatabaseConnectionOptions", () => {
  it("keeps the database disabled until DATABASE_URL is configured", () => {
    expect(buildDatabaseConnectionOptions(baseConfig)).toEqual({
      enabled: false,
      reason: "DATABASE_URL_MISSING",
    });
  });

  it("exposes a configured database url without connecting during module bootstrap", () => {
    expect(buildDatabaseConnectionOptions({
      ...baseConfig,
      databaseUrl: "postgres://shards:shards@localhost:55432/shards",
    })).toEqual({
      enabled: true,
      databaseUrl: "postgres://shards:shards@localhost:55432/shards",
    });
  });
});
