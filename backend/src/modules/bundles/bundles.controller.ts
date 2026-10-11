import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { productSchema } from "../catalog/catalog.controller";
import { BundlesService, type BundleDto } from "./bundles.service";

export const bundleSchema = {
  type: "object",
  required: ["id", "title", "items", "originalTotalCoinMinor", "totalCoinMinor", "discountPercent", "availability"],
  properties: {
    id: { type: "string", enum: ["mono", "chroma", "metal"] },
    title: { type: "string" },
    items: { type: "array", items: productSchema },
    originalTotalCoinMinor: { type: "integer", minimum: 0 },
    totalCoinMinor: { type: "integer", minimum: 0 },
    discountPercent: { type: "integer", enum: [5] },
    availability: { type: "string", enum: ["available", "on-request"] },
  },
};
@ApiTags("Bundles")
@Controller("bundles")
export class BundlesController {
  constructor(@Inject(BundlesService) private readonly bundles: BundlesService) {}
  @ApiOkResponse({ schema: { type: "object", required: ["bundles"], properties: { bundles: { type: "array", items: bundleSchema } } } })
  @Get()
  list(): Promise<{ bundles: BundleDto[] }> { return this.bundles.list(); }
}
