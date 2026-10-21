import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HealthModule } from "./health.module";

describe("HealthModule", () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports liveness, readiness, and explicit capability reasons", async () => {
    await request(httpServer)
      .get("/health/live")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: "ok",
          service: "shards-api",
        });
      });

    await request(httpServer)
      .get("/health/ready")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: "degraded",
          service: "shards-api",
          dependencies: {
            postgres: "not_configured",
            redis: "not_configured",
          },
        });
      });

    await request(httpServer)
      .get("/health/capabilities")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          checkoutEnabled: false,
          coinsTopUpEnabled: false,
          skinFulfillmentEnabled: false,
          steamRefillEnabled: false,
          reasons: [
            "DATABASE_NOT_CONFIGURED",
            "REDIS_NOT_CONFIGURED",
            "ARCO_PAY_NOT_CONFIGURED",
            "SIH_NOT_CONFIGURED",
          ],
        });
      });
  });
});
