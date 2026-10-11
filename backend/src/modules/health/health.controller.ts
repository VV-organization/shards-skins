import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { HealthService } from "./health.service";
import type { CapabilitiesResponse, LivenessResponse, ReadinessResponse } from "./health.types";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status", "service"],
      properties: {
        status: { type: "string", enum: ["ok"] },
        service: { type: "string", enum: ["shards-api"] },
      },
    },
  })
  @Get("live")
  live(): LivenessResponse {
    return this.healthService.liveness();
  }

  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status", "service", "dependencies"],
      properties: {
        status: { type: "string", enum: ["ok", "degraded"] },
        service: { type: "string", enum: ["shards-api"] },
        dependencies: {
          type: "object",
          required: ["postgres", "redis"],
          properties: {
            postgres: { type: "string", enum: ["ok", "not_configured", "unavailable"] },
            redis: { type: "string", enum: ["ok", "not_configured", "unavailable"] },
          },
        },
      },
    },
  })
  @Get("ready")
  ready(): Promise<ReadinessResponse> {
    return this.healthService.readiness();
  }

  @ApiOkResponse({
    schema: {
      type: "object",
      required: [
        "checkoutEnabled",
        "coinsTopUpEnabled",
        "skinFulfillmentEnabled",
        "steamRefillEnabled",
        "reasons",
      ],
      properties: {
        checkoutEnabled: { type: "boolean" },
        coinsTopUpEnabled: { type: "boolean" },
        skinFulfillmentEnabled: { type: "boolean" },
        steamRefillEnabled: { type: "boolean" },
        reasons: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  })
  @Get("capabilities")
  capabilities(): CapabilitiesResponse {
    return this.healthService.capabilities();
  }
}
