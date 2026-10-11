import { Body, Controller, Delete, Get, Headers, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { productSchema } from '../catalog/catalog.controller';
import { SteamCustomerGuard } from '../sessions/steam-customer.guard';
import { CsrfGuard } from '../sessions/csrf.guard';
import { CurrentCustomerContext } from '../sessions/current-customer';
import { CustomerSessionGuard } from '../sessions/customer-session.guard';
import type { CurrentCustomer } from '../sessions/sessions.service';
import { CartService, type CartDto } from './cart.service';

const versionBody = { type: 'object', required: ['expectedCartVersion'], properties: { expectedCartVersion: { type: 'integer', minimum: 0 } } };
export const cartSchema = {
  type: 'object', required: ['version', 'items', 'totalCoinMinor', 'canCheckout'], properties: {
    version: { type: 'integer', minimum: 0 }, canCheckout: { type: 'boolean' }, totalCoinMinor: { type: 'integer', minimum: 0 },
    items: { type: 'array', items: { type: 'object',
      required: ['productId','productSlug','kind','title','quantity','unitPriceCoinMinor','lineTotalCoinMinor','recipient','product','availability'],
      properties: {
        productId: { type: 'string' }, productSlug: { type: 'string' }, kind: { type: 'string', enum: ['skins'] }, title: { type: 'string' },
        quantity: { type: 'integer', enum: [1] }, unitPriceCoinMinor: { type: 'integer' }, lineTotalCoinMinor: { type: 'integer' },
        recipient: { type: 'object' }, product: productSchema, availability: { type: 'string', enum: ['available','unavailable','price_changed'] },
      },
    } },
  },
};
@ApiTags('Cart')
@UseGuards(CustomerSessionGuard, SteamCustomerGuard)
@Controller('cart')
export class CartController {
  constructor(@Inject(CartService) private readonly cart: CartService) {}
  @ApiOkResponse({ schema: cartSchema })
  @Get()
  get(@CurrentCustomerContext() customer: CurrentCustomer): Promise<CartDto> { return this.cart.getCart(customer.userId); }

  @ApiOkResponse({ schema: cartSchema })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ required: true, schema: { ...versionBody, required: ['expectedCartVersion','quantity'], properties: { ...versionBody.properties, quantity: { type: 'integer', enum: [1] } } } })
  @UseGuards(CsrfGuard)
  @Put('items/:productSlug')
  setItem(@CurrentCustomerContext() customer: CurrentCustomer, @Param('productSlug') productSlug: string,
    @Body() body: { quantity: number; expectedCartVersion: number } | undefined, @Headers('idempotency-key') key: string): Promise<CartDto> {
    return this.cart.setItem({ userId: customer.userId, productSlug, quantity: body?.quantity ?? 0, expectedCartVersion: body?.expectedCartVersion ?? -1, idempotencyKey: key });
  }

  @ApiOkResponse({ schema: cartSchema })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ required: true, schema: versionBody })
  @UseGuards(CsrfGuard)
  @Delete('items/:productSlug')
  removeItem(@CurrentCustomerContext() customer: CurrentCustomer, @Param('productSlug') productSlug: string,
    @Body() body: { expectedCartVersion: number } | undefined, @Headers('idempotency-key') key: string): Promise<CartDto> {
    return this.cart.removeItem({ userId: customer.userId, productSlug, expectedCartVersion: body?.expectedCartVersion ?? -1, idempotencyKey: key });
  }

  @ApiOkResponse({ schema: cartSchema })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ required: true, schema: versionBody })
  @UseGuards(CsrfGuard)
  @Delete()
  clear(@CurrentCustomerContext() customer: CurrentCustomer, @Body() body: { expectedCartVersion: number } | undefined, @Headers('idempotency-key') key: string): Promise<CartDto> {
    return this.cart.clearCart({ userId: customer.userId, expectedCartVersion: body?.expectedCartVersion ?? -1, idempotencyKey: key });
  }
}
