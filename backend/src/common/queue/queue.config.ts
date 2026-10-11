import type { AppConfig } from "../../config/app-config";

export type QueueConnectionOptions =
  | {
      enabled: true;
      redisUrl: string;
    }
  | {
      enabled: false;
      reason: "REDIS_URL_MISSING";
    };

export function buildQueueConnectionOptions(config: AppConfig): QueueConnectionOptions {
  if (!config.redisUrl) {
    return {
      enabled: false,
      reason: "REDIS_URL_MISSING",
    };
  }

  return {
    enabled: true,
    redisUrl: config.redisUrl,
  };
}
