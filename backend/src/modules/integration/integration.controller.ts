import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import { AdminGuard } from "../admin/admin.guard";
import { IntegrationHealthService, type IntegrationHealthResult } from "./integration-health.service";
import { IntegrationSyntheticScenarioService } from "./integration-synthetic-scenario.service";
import { IntegrationService } from "./integration.service";
import { VvAdminScenarioAuthVerifier } from "./vv-admin-scenario-auth";

const CHECKOUT_PAYMENT_REACHED_PATH =
  "/admin/integration/scenarios/checkout-payment-reached/run";

@ApiTags("Integration")
@Controller()
export class IntegrationController {
  constructor(
    @Inject(IntegrationService)
    private readonly integration: IntegrationService,
    @Inject(IntegrationSyntheticScenarioService)
    private readonly syntheticScenarios: IntegrationSyntheticScenarioService,
    @Inject(VvAdminScenarioAuthVerifier)
    private readonly scenarioAuth: VvAdminScenarioAuthVerifier,
    @Inject(IntegrationHealthService)
    private readonly integrationHealth: IntegrationHealthService,
  ) {}

  @ApiOkResponse({ description: "VV Admin Integration Protocol v1 manifest." })
  @Get(".well-known/vv-admin/manifest.json")
  manifest() {
    return this.integration.manifest();
  }

  @ApiHeader({
    name: "X-Admin-Token",
    required: true,
    description: "Backend-only admin token loaded from ADMIN_API_TOKEN_FILE.",
  })
  @ApiOkResponse({ description: "Shards integration readiness for VV Admin." })
  @UseGuards(AdminGuard)
  @Get("admin/integration/readiness")
  readiness() {
    return this.integration.readiness();
  }

  @UseGuards(AdminGuard)
  @Get("admin/integration/health/operations")
  operations(){return this.integrationHealth.operations();}

  @Get("admin/integration/health/redis")
  async redisHealth(@Res({ passthrough: true }) response: Response): Promise<IntegrationHealthResult> {
    return respondHealth(response, await this.integrationHealth.redis());
  }

  @Get("admin/integration/health/top-up")
  topUpHealth(@Res({ passthrough: true }) response: Response): IntegrationHealthResult {
    return respondHealth(response, this.integrationHealth.topUp());
  }

  @Get("admin/integration/health/checkout")
  checkoutHealth(@Res({ passthrough: true }) response: Response): IntegrationHealthResult {
    return respondHealth(response, this.integrationHealth.checkout());
  }

  @Get("admin/integration/health/quote-storage")
  async quoteStorageHealth(@Res({ passthrough: true }) response: Response): Promise<IntegrationHealthResult> {
    return respondHealth(response, await this.integrationHealth.quoteStorage());
  }

  @Get("admin/integration/health/steam-refill")
  steamRefillHealth(@Res({ passthrough: true }) response: Response): IntegrationHealthResult {
    return respondHealth(response, this.integrationHealth.steamRefill());
  }

  @Get("admin/integration/health/catalog-visible")
  async visibleCatalogHealth(@Res({ passthrough: true }) response: Response): Promise<IntegrationHealthResult> {
    return respondHealth(response, await this.integrationHealth.visibleCatalog());
  }

  @Get("admin/integration/health/catalog/:game")
  async catalogGameHealth(
    @Param("game") game: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<IntegrationHealthResult> {
    return respondHealth(response, await this.integrationHealth.catalogGame(readCatalogGame(game)));
  }

  @HttpCode(200)
  @Post("admin/integration/scenarios/checkout-payment-reached/run")
  async runCheckoutPaymentReached(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    requireSignedScenarioRequest(
      this.scenarioAuth,
      headers,
      CHECKOUT_PAYMENT_REACHED_PATH,
      body,
    );
    const input = readScenarioRunBody(body);
    return this.syntheticScenarios.runCheckoutPaymentReached(input);
  }

}

function respondHealth(response: Response, result: IntegrationHealthResult): IntegrationHealthResult {
  if (result.status !== "ok") response.status(503);
  return result;
}

function readCatalogGame(game: string): "cs2" | "rust" | "tf2" {
  if (game === "cs2") return game;
  throw new BadRequestException("Catalog game is invalid");
}

function requireSignedScenarioRequest(
  verifier: VvAdminScenarioAuthVerifier,
  headers: Record<string, string | string[] | undefined>,
  path: string,
  body: unknown,
): void {
  const signature = singleHeader(headers["x-vv-admin-signature"]);
  const timestamp = singleHeader(headers["x-vv-admin-timestamp"]);
  if (!signature || !timestamp) throw new UnauthorizedException();
  if (
    !verifier.verify({
      body: JSON.stringify(body ?? {}),
      path,
      signature,
      timestamp,
    })
  ) {
    throw new UnauthorizedException();
  }
}

function readScenarioRunBody(body: unknown): { readonly runId: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Scenario run body is invalid");
  }
  const runId = (body as { runId?: unknown }).runId;
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new BadRequestException("runId is required");
  }
  return { runId: runId.trim() };
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
