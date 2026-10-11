import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AppModule } from '../../app.module';

// Fixed discounted Frags bundles are intentionally absent from the Shards contract.
describe.skipIf(!process.env.SHARDS_TEST_DATABASE_URL)('Shards fixed-bundle boundary', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.SHARDS_TEST_DATABASE_URL;
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); delete process.env.DATABASE_URL; });
  it('does not expose donor bundle reads or cart mutations', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server).get('/bundles').expect(404);
    await request(server).put('/cart/bundles/mono').send({}).expect(404);
    await request(server).delete('/cart/bundles/mono').expect(404);
  });
});
