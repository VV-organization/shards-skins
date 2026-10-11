import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, it } from "vitest";

import { AppModule } from "../../app.module";
describe("CatalogModule", () => {
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

  it("does not serve seed catalog fallback when PostgreSQL is unavailable", async () => {
    await request(httpServer).get("/catalog").expect(503);
    await request(httpServer).get("/catalog/ak-47-redline").expect(503);
  });
});
