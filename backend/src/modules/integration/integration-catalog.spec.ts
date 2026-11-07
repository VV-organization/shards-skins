import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { loadAppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { CatalogService } from "../catalog/catalog.service";
import type { CatalogProductDto } from "../catalog/catalog.types";
import type { InvoiceCatalogPage } from "./integration-catalog.service";

const secret = "local-catalog-test-secret";
const basePath = "/admin/integration/catalog";
const requestId = "41c1b540-5f58-4cbb-9476-43adfb223b1b";
const product = (index: number): CatalogProductDto => ({
  categoryId: "rifle", condition: "FN", weapon: "AK-47", stattrak: false, marketHashName: `Skin ${index}`, priceRevision: "fixture", pricingSettingId: "fixture",
  id: `item-${index}`, slug: `skin-${index}`, kind: "skins", game: "cs2", category: "skins",
  productType: "rifle", title: `Skin ${index}`, description: "A skin",
  price: { currency: "COINS", amountMinor: 12345 + index, scale: 2, display: "123.45 Shards" },
  availability: index === 0 ? "on-request" : "available", fulfillmentMode: "steam-trade",
  createdAt: "2026-11-01T00:00:00.000Z", popularity: 0, image: "/catalog/test.png", imageAlt: "Skin",
  meta: [], keywords: [], details: { specifications: [], fulfillment: { title: "Trade", description: "", requirements: [] } },
});

function signed(path: string, timestamp = new Date().toISOString()) {
  const digest = createHash("sha256").update("").digest("hex");
  const canonical = ["vv-admin", timestamp, requestId, "GET", path, digest].join(".");
  return {
    "x-vv-actor-id": "local-operator", "x-vv-request-id": requestId, "x-vv-site-key": "shards",
    "x-vv-timestamp": timestamp,
    "x-vv-signature": `sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`,
  };
}

describe("Shards invoice catalog HTTP contract", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let temporaryDirectory: string;
  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "shards-catalog-test-"));
    const secretFile = join(temporaryDirectory, "secret");
    writeFileSync(secretFile, secret);
    const config = loadAppConfig({ NODE_ENV: "test", VV_ADMIN_PUBLIC_ORIGIN: "https://shards.example", VV_ADMIN_API_ORIGIN: "https://shards.example/api", VV_ADMIN_INTEGRATION_SECRET_FILE: secretFile });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(config)
      .overrideProvider(CatalogService).useValue({ listPublicProductsPage(query: { afterId?: string; limit: number }) {
        const all = Array.from({ length: 205 }, (_, index) => product(index));
        const offset = query.afterId === undefined ? 0 : all.findIndex((row) => row.id === query.afterId) + 1;
        const items = all.slice(offset, offset + query.limit);
        return Promise.resolve({ items, nextId: offset + query.limit < all.length ? items.at(-1)?.id ?? null : null });
      } }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });
  afterAll(async () => { await app.close(); rmSync(temporaryDirectory, { recursive: true, force: true }); });

  it("reads every page beyond 200 without changing native price, image, or product URL", async () => {
    const first = await request(server).get(`${basePath}/products?limit=200`).set(signed("/products?limit=200")).expect(200).expect("cache-control", "no-store");
    const firstPage = first.body as InvoiceCatalogPage;
    expect(firstPage.items).toHaveLength(200);
    expect(firstPage.items[1]).toMatchObject({ id: "item-1", title: "Skin 1", isActive: true, attributes: { publicUrl: "https://shards.example/catalog/skin-1" }, media: [{ url: "https://shards.example/catalog/test.png" }] });
    expect(firstPage.items[0]?.isActive).toBe(false);
    if (!firstPage.nextCursor) throw new Error("Missing continuation");
    const secondPath = `/products?cursor=${encodeURIComponent(firstPage.nextCursor)}&limit=200`;
    const second = await request(server).get(basePath + secondPath).set(signed(secondPath)).expect(200);
    const secondPage = second.body as InvoiceCatalogPage;
    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.items[0]?.id).toBe("item-200");
    expect(secondPage.nextCursor).toBeNull();
    const offers = await request(server).get(`${basePath}/offers?limit=200`).set(signed("/offers?limit=200")).expect(200);
    const offerPage = offers.body as InvoiceCatalogPage;
    expect(offerPage.items[1]).toMatchObject({ id: "item-1:offer", productId: "item-1", isActive: true, price: { currency: "COINS", amountMinor: 12346, scale: 100 } });
    expect(offerPage.items[0]?.isActive).toBe(false);
  });

  it("rejects unsigned, stale, wrong-site, and modified query/path signatures", async () => {
    await request(server).get(`${basePath}/products`).expect(401);
    await request(server).get(`${basePath}/products`).set(signed("/products", "2020-01-01T00:00:00.000Z")).expect(401);
    await request(server).get(`${basePath}/products`).set({ ...signed("/products"), "x-vv-site-key": "another-site" }).expect(401);
    await request(server).get(`${basePath}/products?limit=1`).set(signed("/products?limit=200")).expect(401);
    await request(server).get(`${basePath}/offers`).set(signed("/products")).expect(401);
    await request(server).get(`${basePath}/products`).set(signed(`/api${basePath}/products`)).expect(401);
  });

  it("rejects malformed pagination and does not expose catalog mutation routes", async () => {
    for (const path of ["/products?cursor=garbage", "/products?limit=0", "/products?limit=201", "/products?limit=1.5", "/products?limit=2&limit=3"]) {
      await request(server).get(basePath + path).set(signed(path)).expect(400);
    }
    await request(server).post(`${basePath}/products`).send({ title: "Forbidden" }).expect(404);
    await request(server).patch(`${basePath}/offers/item-1`).send({ price: 1 }).expect(404);
    await request(server).delete(`${basePath}/products/item-1`).expect(404);
  });
});
