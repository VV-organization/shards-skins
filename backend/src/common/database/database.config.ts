import type { AppConfig } from "../../config/app-config";

export type DatabaseConnectionOptions =
  | {
      enabled: true;
      databaseUrl: string;
    }
  | {
      enabled: false;
      reason: "DATABASE_URL_MISSING";
    };

export function buildDatabaseConnectionOptions(config: AppConfig): DatabaseConnectionOptions {
  if (!config.databaseUrl) {
    if (config.nodeEnv === "production") throw new Error("DATABASE_URL is required in production.");
    return {
      enabled: false,
      reason: "DATABASE_URL_MISSING",
    };
  }

  return {
    enabled: true,
    databaseUrl: config.databaseUrl,
  };
}
