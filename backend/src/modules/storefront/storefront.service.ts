import {DatabaseService} from '../../common/database/database.service';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { isArcPayConfigured, type AppConfig } from '../../config/app-config';
@Injectable()
export class StorefrontService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(DatabaseService) private readonly database:DatabaseService) {}
  async getConfig() {
    let verifiedFx=false;
    if(this.database.isConfigured())try{const pricing=await this.database.query<{verified:boolean}>("SELECT coalesce(metadata->>'fxVerified','false')='true' AS verified FROM pricing_settings WHERE scope='sih-skins' AND superseded_at IS NULL");verifiedFx=pricing.rows.length===1&&pricing.rows[0]?.verified===true;}catch{verifiedFx=false;}
    const paymentReady=Boolean(this.config.commerce?.paymentsEnabled&&this.config.databaseUrl&&isArcPayConfigured(this.config.arcPay)&&(this.config.arcPay.checkoutAllowedOrigins===undefined||this.config.arcPay.checkoutAllowedOrigins.length>0));
    return {
      currency: 'Shards' as const,
      rate: { fiatMinor: 100, coinMinor: 160 },
      rateVersion: 'shards-8-5-v1',
      walletTopUp: { minimumCoinMinor: 10000, maximumCoinMinor: 10000000, stepCoinMinor: 100 },
      steamRefill: { minimumRubMinor: 5000, maximumRubMinor: 943300, stepRubMinor: 100 },
      steamFeeBps: 500,
      paymentMethods: paymentReady ? ['sbp'] : [],
      capabilities: {
        checkoutEnabled: Boolean(verifiedFx && this.config.commerce?.checkoutEnabled && this.config.commerce.fulfillmentEnabled && this.config.databaseUrl && this.config.sih.apiKeyFile),
        walletTopUpEnabled: paymentReady,
        steamRefillEnabled: Boolean(paymentReady && this.config.commerce?.fulfillmentEnabled && this.config.databaseUrl && this.config.sih.steamRefillApiKeyFile && isArcPayConfigured(this.config.arcPay)),
      },
    };
  }
}
