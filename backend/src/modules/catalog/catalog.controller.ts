import { Body, Controller, HttpCode, Post, Get, Inject, Param, Query } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { CatalogService } from "./catalog.service";
import type { CatalogListDto, CatalogListQuery, CatalogProductDto } from "./catalog.types";

const priceSchema = {
  type: "object",
  required: ["currency", "amountMinor", "scale", "display"],
  properties: {
    currency: { type: "string", enum: ["COINS"] },
    amountMinor: { type: "integer", minimum: 1 },
    scale: { type: "integer", enum: [2] },
    display: { type: "string" },
  },
};

export const productSchema = {
  type: "object",
  required: [
    "categoryId","condition","weapon","stattrak","marketHashName","priceRevision","pricingSettingId",
    "id",
    "slug",
    "kind",
    "category",
    "productType",
    "title",
    "description",
    "price",
    "availability",
    "fulfillmentMode",
    "createdAt",
    "popularity",
    "meta",
    "keywords",
    "details",
  ],
  properties: {
    categoryId:{type:"string"},condition:{type:"string"},weapon:{type:"string"},stattrak:{type:"boolean"},marketHashName:{type:"string"},priceRevision:{type:"string"},pricingSettingId:{type:"string"},
    id: { type: "string" },
    slug: { type: "string" },
    kind: { type: "string", enum: ["skins"] },
    category: { type: "string" },
    game: { type: "string" },
    productType: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    price: priceSchema,
    availability: { type: "string", enum: ["available", "on-request", "unavailable"] },
    fulfillmentMode: { type: "string", enum: ["automatic", "steam-trade", "manual"] },
    createdAt: { type: "string", format: "date-time" },
    popularity: { type: "integer" },
    image: { type: "string" },
    imageAlt: { type: "string" },
    meta: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    details: { type: "object", required: ["specifications", "fulfillment"], properties: {
      specifications: { type: "array", items: { type: "object", required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
      fulfillment: { type: "object", required: ["title", "description", "requirements"], properties: { title: { type: "string" }, description: { type: "string" }, requirements: { type: "array", items: { type: "string" } } } },
    } },
  },
};

@ApiTags("Catalog")
@Controller("catalog")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Post("lookup")
  @HttpCode(200)
  @ApiBody({schema:{type:"object",required:["slugs"],properties:{slugs:{type:"array",maxItems:50,items:{type:"string"}}}}})
  @ApiOkResponse({schema:{type:"object",required:["items"],properties:{items:{type:"array",items:productSchema}}}})
  lookup(@Body() body:{slugs?:unknown}|null|undefined) { return this.catalog.lookup(body?.slugs); }

  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["items", "facets", "pricing", "pagination"],
      properties: {
        items: { type: "array", items: productSchema },
        facets: { type: "object", required: ["kinds", "games", "productTypes", "conditions", "fulfillmentModes", "availability"], properties: Object.fromEntries(["kinds", "games", "productTypes", "conditions", "fulfillmentModes", "availability"].map(key => [key, { type: "array", items: { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" } } } }])) },
        pagination: { type: "object", required: ["limit", "offset", "total", "hasMore"], properties: { limit: { type: "integer" }, offset: { type: "integer" }, total: { type: "integer" }, hasMore: { type: "boolean" } } },
        pricing: { type: "object" },
      },
    },
  })
  @Get()
  list(@Query() query: CatalogListQuery): Promise<CatalogListDto> {
    return this.catalog.list(query);
  }

  @ApiOkResponse({ schema: productSchema })
  @Get(":slug")
  getBySlug(@Param("slug") slug: string): Promise<CatalogProductDto> {
    return this.catalog.getBySlug(slug);
  }
}
