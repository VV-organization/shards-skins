import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { isArcoPayConfigured, type AppConfig } from '../../config/app-config';
@Injectable()
export class StorefrontService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  getConfig() {
    const paymentReady=Boolean(this.config.commerce?.paymentsEnabled&&this.config.databaseUrl&&isArcoPayConfigured(this.config.arcoPay));
    return Promise.resolve({
      currency: 'Shards' as const,
      rate: { fiatMinor: 100, coinMinor: 160 },
      rateVersion: 'shards-8-5-v1',
      walletTopUp: { minimumCoinMinor: 10000, maximumCoinMinor: 10000000, stepCoinMinor: 100 },
      steamRefill: { minimumRubMinor: 5000, maximumRubMinor: 943300, stepRubMinor: 100 },
      steamFeeBps: 500,
      paymentMethods: paymentReady ? ['card', 'sbp'] : [],
      capabilities: {
        guestSteamRefillEnabled: Boolean(paymentReady && this.config.commerce?.guestSteamRefillEnabled && this.config.commerce.fulfillmentEnabled && this.config.sih.steamRefillApiKeyFile),
        checkoutEnabled: Boolean(this.config.commerce?.checkoutEnabled && this.config.commerce.fulfillmentEnabled && this.config.databaseUrl && this.config.sih.apiKeyFile),
        walletTopUpEnabled: paymentReady,
        steamRefillEnabled: Boolean(paymentReady && this.config.commerce?.fulfillmentEnabled && this.config.databaseUrl && this.config.sih.steamRefillApiKeyFile && isArcoPayConfigured(this.config.arcoPay)),
      },
    });
  }
}
