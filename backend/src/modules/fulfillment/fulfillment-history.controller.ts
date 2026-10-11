import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { FulfillmentHistoryService, type FulfillmentTradeHistoryDto } from "./fulfillment-history.service";

const fulfillmentTradeHistorySchema = {
  type: "object",
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "createdAt", "direction", "title", "itemId", "orderNumber", "status"],
        properties: {
          createdAt: { type: "string", format: "date-time" },
          direction: { type: "string", enum: ["purchase", "withdrawal"] },
          id: { type: "string", format: "uuid" },
          itemId: { type: "string", format: "uuid" },
          orderNumber: { type: "string" },
          status: { type: "string", enum: ["pending", "processing", "trade_protection", "completed"] },
          title: { type: "string" },
        },
      },
    },
  },
};

@ApiTags("Fulfillment")
@UseGuards(CustomerSessionGuard)
@Controller("fulfillment")
export class FulfillmentHistoryController {
  constructor(@Inject(FulfillmentHistoryService) private readonly fulfillmentHistory: FulfillmentHistoryService) {}

  @ApiOkResponse({ schema: fulfillmentTradeHistorySchema })
  @Get("me/trades")
  me(@CurrentCustomerContext() customer: CurrentCustomer): Promise<FulfillmentTradeHistoryDto> {
    return this.fulfillmentHistory.listUserTradeEvents(customer.userId);
  }
}
