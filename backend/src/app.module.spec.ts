import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "./app.module";

describe("AppModule", () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it("mounts the public health boundary", async () => {
    await request(httpServer)
      .get("/health/live")
      .set("x-request-id", "shards:test_request")
      .expect(200, {
        status: "ok",
        service: "shards-api",
      })
      .expect("x-request-id", "shards:test_request");
  });

  it("generates a request id when the caller does not provide one", async () => {
    await request(httpServer)
      .get("/health/live")
      .expect(200)
      .expect("x-request-id", /^[0-9a-f-]{36}$/);
  });

  it("mounts the public VV Admin integration manifest", async () => {
    await request(httpServer)
      .get("/.well-known/vv-admin/manifest.json")
      .expect(200)
      .expect(({body}) => {
        expect(body).toMatchObject({site:{key:"shards"},commerceEvents:{schemaVersion:1}});
        expect(body).not.toHaveProperty("catalog");
        expect(body).not.toHaveProperty("storeOrders");
      });
  });

  it("does not mount excluded customer or admin APIs", async () => {
    for (const path of ["/digital-goods/me", "/admin/integration/catalog/products", "/admin/integration/health/apple-gift-cards"])
      await request(httpServer).get(path).expect(404);
    await request(httpServer).patch("/admin/integration/store-orders/orders/1/processing").send({isProcessed:true}).expect(404);
  });
});
