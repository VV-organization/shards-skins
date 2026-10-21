import { expect, it } from 'vitest';
import { loadAppConfig } from '../../config/app-config';
import { StorefrontService } from './storefront.service';
it('exposes customer money terms without secrets or unavailable payment methods', async () => {
  const config = loadAppConfig({ ARCO_PAY_API_KEY_FILE: '/secret/private' });
  const terms = await new StorefrontService(config).getConfig();
  expect(terms).toMatchObject({ currency: 'Shards', rate: { fiatMinor: 100, coinMinor: 160 }, walletTopUp: { minimumCoinMinor: 10000, maximumCoinMinor: 10000000, stepCoinMinor: 100 }, steamFeeBps: 500, paymentMethods: [] });
  expect(JSON.stringify(terms)).not.toContain('/secret/');
});

it('enables configured checkout without an FX approval flag',async()=>{
 const config=loadAppConfig({DATABASE_URL:'postgres://local/shards_test',SHARDS_CHECKOUT_ENABLED:'true',SHARDS_FULFILLMENT_ENABLED:'true',SIH_API_KEY_FILE:'/fixture'});
 const service=new StorefrontService(config);
 expect((await service.getConfig()).capabilities.checkoutEnabled).toBe(true);
});
