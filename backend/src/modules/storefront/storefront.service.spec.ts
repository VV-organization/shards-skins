import { expect, it } from 'vitest';
import { loadAppConfig } from '../../config/app-config';
import { StorefrontService } from './storefront.service';
it('exposes customer money terms without secrets or unavailable payment methods', () => {
  const config = loadAppConfig({ ARC_PAY_SECRET_KEY_FILE: '/secret/private' });
  const terms = new StorefrontService(config).getConfig();
  expect(terms).toMatchObject({ currency: 'Shards', rate: { fiatMinor: 100, coinMinor: 160 }, walletTopUp: { minimumCoinMinor: 10000, maximumCoinMinor: 10000000, stepCoinMinor: 100 }, steamFeeBps: 500, paymentMethods: [] });
  expect(JSON.stringify(terms)).not.toContain('/secret/');
});
