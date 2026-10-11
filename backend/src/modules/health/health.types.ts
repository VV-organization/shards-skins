export type HealthStatus = "ok" | "degraded";
export type DependencyState = "ok" | "not_configured" | "unavailable";

export type LivenessResponse = {
  status: "ok";
  service: "shards-api";
};

export type ReadinessResponse = {
  status: HealthStatus;
  service: "shards-api";
  dependencies: {
    postgres: DependencyState;
    redis: DependencyState;
  };
};

export type CapabilitiesResponse = {
  checkoutEnabled: boolean;
  coinsTopUpEnabled: boolean;
  skinFulfillmentEnabled: boolean;
  steamRefillEnabled: boolean;
  reasons: string[];
};
