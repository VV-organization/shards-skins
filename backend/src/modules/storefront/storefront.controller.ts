import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { StorefrontService } from './storefront.service';
const integer = { type: 'integer', minimum: 0 };
const shape = (properties: Record<string, object>) => ({ type: 'object', required: Object.keys(properties), properties });
@ApiTags('Storefront')
@Controller('storefront')
export class StorefrontController {
  constructor(@Inject(StorefrontService) private readonly storefront: StorefrontService) {}
  @Get('config')
  @ApiOkResponse({ schema: shape({
    currency: { type: 'string', enum: ['Shards'] },
    rate: shape({ fiatMinor: integer, coinMinor: integer }), rateVersion: { type: 'string' },
    walletTopUp: shape({minimumCoinMinor: integer, maximumCoinMinor: integer, stepCoinMinor: integer}),
    steamRefill: shape({minimumRubMinor: integer, maximumRubMinor: integer, stepRubMinor: integer}),
    steamFeeBps: integer, paymentMethods: { type: 'array', items: { type: 'string', enum: ['sbp'] } },
    capabilities: shape({ checkoutEnabled: { type: 'boolean' }, walletTopUpEnabled: { type: 'boolean' }, steamRefillEnabled: { type: 'boolean' } }),
  }) })
  config() { return this.storefront.getConfig(); }
}
