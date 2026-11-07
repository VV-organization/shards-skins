import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { CatalogService } from "../catalog/catalog.service";
import type { CatalogProductDto } from "../catalog/catalog.types";

export type InvoiceCatalogPage = {
  items: Record<string, unknown>[];
  nextCursor: string | null;
};
type PageInput = { cursor?: unknown; limit?: unknown };
const pageSize = 200;

@Injectable()
export class IntegrationCatalogService {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listProducts(input: PageInput): Promise<InvoiceCatalogPage> {
    const page = await this.readPage(input);
    return {
      items: page.items.map((product) => ({
        id: product.id, title: product.title, slug: product.slug,
        isActive: product.availability === "available",
        media: product.image ? [{
          id: `${product.id}:image`,
          url: new URL(product.image, `${this.config.integration.publicOrigin}/`).href,
          alt: product.imageAlt ?? product.title,
        }] : [],
        attributes: {
          publicUrl: `${this.config.integration.publicOrigin}/catalog/${encodeURIComponent(product.slug)}`,
          game: "cs2",
        },
      })),
      nextCursor: page.nextCursor,
    };
  }

  async listOffers(input: PageInput): Promise<InvoiceCatalogPage> {
    const page = await this.readPage(input);
    return {
      items: page.items.map((product) => ({
        id: `${product.id}:offer`, productId: product.id, title: product.title,
        isActive: product.availability === "available",
        // Catalog DTO scale=2 is decimal precision; protocol scale=100 is its divisor.
        price: { currency: "COINS", amountMinor: product.price.amountMinor, scale: 100 },
        availability: { status: product.availability === "available" ? "in_stock" : "out_of_stock" },
        attributes: {},
      })),
      nextCursor: page.nextCursor,
    };
  }

  private async readPage(input: PageInput): Promise<{ items: CatalogProductDto[]; nextCursor: string | null }> {
    const afterId = decodeCursor(input.cursor);
    const limit = readLimit(input.limit);
    // Reuse storefront visibility and supplier pricing; this read does not persist checkout quotes.
    const page = await this.catalog.listPublicProductsPage({ ...(afterId === undefined ? {} : { afterId }), limit });
    if (page.nextId !== null && page.items.length === 0) {
      throw new ServiceUnavailableException("CATALOG_PAGE_INCOMPLETE");
    }
    for (const product of page.items) {
      if (product.kind !== "skins" || product.game?.toLowerCase() !== "cs2" ||
        !Number.isSafeInteger(product.price.amountMinor) || product.price.amountMinor <= 0) {
        throw new ServiceUnavailableException("CATALOG_READ_MODEL_INVALID");
      }
    }
    return {
      items: page.items,
      nextCursor: page.nextId !== null
        ? Buffer.from(JSON.stringify({ version: 1, afterId: page.nextId })).toString("base64url")
        : null,
    };
  }
}

function readLimit(value: unknown): number {
  if (value === undefined) return pageSize;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > pageSize) {
    throw new BadRequestException("CATALOG_LIMIT_INVALID");
  }
  return Number(value);
}

function decodeCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || !("version" in decoded) || decoded.version !== 1 || !("afterId" in decoded) ||
      typeof decoded.afterId !== "string" || decoded.afterId.length === 0 || decoded.afterId.length > 512 || decoded.afterId.includes("\0") || Object.keys(decoded).length !== 2) throw new Error();
    return decoded.afterId;
  } catch {
    throw new BadRequestException("CATALOG_CURSOR_INVALID");
  }
}
