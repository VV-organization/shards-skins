import { Controller, Get, Header, Inject, Query, Req, UnauthorizedException } from "@nestjs/common";
import { ApiOkResponse, ApiQuery, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { Request } from "express";

import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { optionalStringFromFile } from "../../config/secret-file";
import { authenticateCatalogProtocolRequest } from "./catalog-protocol.auth";
import { IntegrationCatalogService } from "./integration-catalog.service";

const routePrefix = "/admin/integration/catalog";
const pageSchema = {
  type: "object", required: ["items", "nextCursor"], properties: {
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    nextCursor: { type: "string", nullable: true },
  },
};

@ApiTags("Integration catalog")
@ApiUnauthorizedResponse({ description: "A current VV Admin catalog HMAC signature is required." })
@Controller(routePrefix)
export class IntegrationCatalogController {
  constructor(
    @Inject(IntegrationCatalogService) private readonly catalog: IntegrationCatalogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get("products")
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Read-only public CS2 products for VV Admin invoices.", schema: pageSchema })
  products(@Req() request: Request, @Query("cursor") cursor?: unknown, @Query("limit") limit?: unknown) {
    this.authenticate(request);
    return this.catalog.listProducts({ cursor, limit });
  }

  @Get("offers")
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Read-only native COINS prices for VV Admin invoices.", schema: pageSchema })
  offers(@Req() request: Request, @Query("cursor") cursor?: unknown, @Query("limit") limit?: unknown) {
    this.authenticate(request);
    return this.catalog.listOffers({ cursor, limit });
  }

  private authenticate(request: Request): void {
    try {
      const secret = optionalStringFromFile(this.config.integration.protocolAuthSecretFile);
      if (!secret || !request.originalUrl.startsWith(`${routePrefix}/`)) throw new Error();
      // VV catalog HMAC signs the resource-relative path plus the original query, not /api or the capability base.
      authenticateCatalogProtocolRequest({
        method: request.method, path: request.originalUrl.slice(routePrefix.length),
        body: "", headers: request.headers,
      }, secret, this.config.integration.vvAdminSiteKey ?? "shards");
    } catch {
      throw new UnauthorizedException("CATALOG_PROTOCOL_AUTH_FAILED");
    }
  }
}
