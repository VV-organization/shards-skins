import { expect, it } from 'vitest';
import { loadAppConfig } from '../../config/app-config';
import { StorefrontService } from './storefront.service';
it('exposes customer money terms without secrets or unavailable payment methods', async () => {
  const config = loadAppConfig({ ARC_PAY_SECRET_KEY_FILE: '/secret/private' });
  const terms = await new StorefrontService(config, {isConfigured:()=>false} as never).getConfig();
  expect(terms).toMatchObject({ currency: 'Shards', rate: { fiatMinor: 100, coinMinor: 160 }, walletTopUp: { minimumCoinMinor: 10000, maximumCoinMinor: 10000000, stepCoinMinor: 100 }, steamFeeBps: 500, paymentMethods: [] });
  expect(JSON.stringify(terms)).not.toContain('/secret/');
});

it('keeps checkout unavailable until active pricing has a verified FX snapshot',async()=>{
 const config=loadAppConfig({DATABASE_URL:'postgres://local/shards_test',SHARDS_CHECKOUT_ENABLED:'true',SIH_API_KEY_FILE:'/fixture'});
 const service=new StorefrontService(config,{isConfigured:()=>true,query:()=>Promise.resolve({rows:[{verified:false}]})} as never);
 expect((await service.getConfig()).capabilities.checkoutEnabled).toBe(false);
});
