import { expect, it } from 'vitest';
import { loadAppConfig } from '../../config/app-config';
import { HealthService } from './health.service';
it('reports failed connections rather than treating configured URLs as healthy', async () => {
  const service = new HealthService(loadAppConfig({ DATABASE_URL: 'postgres://shards:x@127.0.0.1:1/shards', REDIS_URL: 'redis://127.0.0.1:1' }));
  expect(await service.readiness()).toMatchObject({ status: 'degraded', dependencies: { postgres: 'unavailable', redis: 'unavailable' } });
});
it('does not advertise disabled new money operations even when credentials are configured', async () => {
  const service = new HealthService(loadAppConfig({DATABASE_URL:'postgres://localhost/shards', REDIS_URL:'redis://localhost', ARCO_PAY_PROVIDER_MODE:'real', ARCO_PAY_API_KEY_FILE:'/nonexistent/key', ARCO_PAY_PUBLIC_KEY_FILE:'/nonexistent/hook', ARCO_PAY_PUBLIC_ORIGIN:'https://shards.example', SIH_API_KEY_FILE:'/nonexistent/sih'}));
  expect(await service.capabilities()).toMatchObject({ checkoutEnabled: false, coinsTopUpEnabled: false, skinFulfillmentEnabled: false, steamRefillEnabled: false });
});
