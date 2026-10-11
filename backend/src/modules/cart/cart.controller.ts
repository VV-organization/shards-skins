import { SteamCustomerGuard } from "../sessions/steam-customer.guard";
import { Body, Controller, Delete, Get, Inject, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { bundleSchema } from "../bundles/bundles.controller";
import { CsrfGuard } from "../sessions/csrf.guard";
import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { CartService, type CartDto } from "./cart.service";

type SetCartItemBody = {
  quantity: number;
  recipient?: {
    steamLogin?: string;
  };
};

const cartSchema = {
  type: "object",
  required: ["items", "bundles", "totalCoinMinor"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["productId", "productSlug", "kind", "title", "quantity", "unitPriceCoinMinor", "lineTotalCoinMinor", "recipient"],
        properties: {
          productId: { type: "string" },
          productSlug: { type: "string" },
          kind: { type: "string", enum: ["skins", "steam", "apple_gift_card"] },
          title: { type: "string" },
          quantity: { type: "integer", minimum: 1, maximum: 50 },
          unitPriceCoinMinor: { type: "integer", minimum: 1 },
          lineTotalCoinMinor: { type: "integer", minimum: 1 },
          recipient: { type: "object" },
        },
      },
    },
    bundles: { type: "array", items: bundleSchema },
    totalCoinMinor: { type: "integer", minimum: 0 },
  },
};

@ApiTags("Cart")
@UseGuards(CustomerSessionGuard, SteamCustomerGuard)
@Controller("cart")
export class CartController {
  constructor(@Inject(CartService) private readonly cart: CartService) {}

  @ApiOkResponse({ schema: cartSchema })
  @Get()
  get(@CurrentCustomerContext() customer: CurrentCustomer): Promise<CartDto> {
    return this.cart.getCart(customer.userId);
  }

  @ApiOkResponse({ schema: cartSchema })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      required: ["quantity"],
      properties: {
        quantity: { type: "integer", minimum: 1, maximum: 50 },
        recipient: {
          type: "object",
          properties: {
            steamLogin: { type: "string" },
          },
        },
      },
    },
  })
  @UseGuards(CsrfGuard)
  @Put("items/:productSlug")
  setItem(
    @CurrentCustomerContext() customer: CurrentCustomer,
    @Param("productSlug") productSlug: string,
    @Body() body: SetCartItemBody,
  ): Promise<CartDto> {
    return this.cart.setItem({
      userId: customer.userId,
      productSlug,
      quantity: body.quantity,
      ...(body.recipient === undefined ? {} : { recipient: body.recipient }),
    });
  }

  @ApiOkResponse({ schema: cartSchema })
  @UseGuards(CsrfGuard)
  @Delete("items/:productSlug")
  removeItem(
    @CurrentCustomerContext() customer: CurrentCustomer,
    @Param("productSlug") productSlug: string,
  ): Promise<CartDto> {
    return this.cart.removeItem(customer.userId, productSlug);
  }

  @ApiOkResponse({ schema: cartSchema })
  @UseGuards(CsrfGuard)
  @Delete()
  clear(@CurrentCustomerContext() customer: CurrentCustomer): Promise<CartDto> {
    return this.cart.clearCart(customer.userId);
  }
}
