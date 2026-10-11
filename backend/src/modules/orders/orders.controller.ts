import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { OrdersService, type OrderHistoryDto } from "./orders.service";

const orderHistorySchema = {
  type: "object",
  required: ["orders"],
  properties: {
    orders: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "userId", "status", "totalCoinMinor", "recipientSnapshots", "createdAt", "lines"],
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string" },
          status: { type: "string", enum: ["held", "fulfilled", "partially_fulfilled", "failed", "manual_review"] },
          totalCoinMinor: { type: "integer", minimum: 0 },
          recipientSnapshots: { type: "array", items: { type: "object" } },
          createdAt: { type: "string", format: "date-time" },
          lines: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "fulfillmentStage", "productSlug", "kind", "title", "quantity", "unitPriceCoinMinor", "recipientSnapshot"],
              properties: {
                id: { type: "string", format: "uuid" },
                fulfillmentStage: { type: "string", enum: ["pending", "trade_offer_sent", "trade_protection", "delivered", "failed", "needs_review"] },
                productSlug: { type: "string" },
                kind: { type: "string", enum: ["steam", "skins"] },
                title: { type: "string" },
                quantity: { type: "integer", enum: [1] },
                unitPriceCoinMinor: { type: "integer", minimum: 0 },
                recipientSnapshot: { type: "object" },
              },
            },
          },
        },
      },
    },
  },
};

@ApiTags("Orders")
@UseGuards(CustomerSessionGuard)
@Controller("orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @ApiOkResponse({ schema: orderHistorySchema })
  @Get("me")
  me(@CurrentCustomerContext() customer: CurrentCustomer): Promise<OrderHistoryDto> {
    return this.orders.listUserOrders(customer.userId);
  }
}
