import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { isArcPayConfigured, type AppConfig } from '../../config/app-config';
@Injectable()
export class StorefrontService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  getConfig() {
    return {
      currency: 'Shards' as const,
      rate: { fiatMinor: 100, coinMinor: 160 },
      rateVersion: 'shards-8-5-v1',
      walletTopUp: { minimumCoinMinor: 10000, maximumCoinMinor: 10000000, stepCoinMinor: 100 },
      steamRefill: { minimumRubMinor: 5000, maximumRubMinor: 943300, stepRubMinor: 100 },
      steamFeeBps: 500,
      paymentMethods: this.config.commerce?.paymentsEnabled && isArcPayConfigured(this.config.arcPay) ? ['sbp'] : [],
      capabilities: {
        checkoutEnabled: Boolean(this.config.commerce?.checkoutEnabled && this.config.databaseUrl && this.config.sih.apiKeyFile),
        walletTopUpEnabled: Boolean(this.config.commerce?.paymentsEnabled && this.config.databaseUrl && isArcPayConfigured(this.config.arcPay)),
        steamRefillEnabled: Boolean(this.config.commerce?.paymentsEnabled && this.config.commerce.fulfillmentEnabled && this.config.databaseUrl && this.config.sih.steamRefillApiKeyFile && isArcPayConfigured(this.config.arcPay)),
      },
    };
  }
}
