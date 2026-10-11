import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { InventoryService, type InventoryDto } from "./inventory.service";

const inventoryActionSchema = {
  type: "object",
  required: ["enabled", "reason"],
  properties: {
    enabled: { type: "boolean" },
    reason: { type: "string", enum: ["available", "not_supported", "steam_trade_url_required"] },
  },
};

const inventorySchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "orderId", "productSlug", "title", "unitPriceCoinMinor", "acquiredAt", "status", "actions"],
        properties: {
          id: { type: "string", format: "uuid" },
          orderId: { type: "string", format: "uuid" },
          productSlug: { type: "string" },
          title: { type: "string" },
          unitPriceCoinMinor: { type: "integer", minimum: 1 },
          acquiredAt: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["owned"] },
          actions: {
            type: "object",
            required: ["sellToSite", "withdrawToSteam"],
            properties: {
              sellToSite: inventoryActionSchema,
              withdrawToSteam: inventoryActionSchema,
            },
          },
        },
      },
    },
  },
};

@ApiTags("Inventory")
@UseGuards(CustomerSessionGuard)
@Controller("inventory")
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @ApiOkResponse({ schema: inventorySchema })
  @Get("me")
  me(@CurrentCustomerContext() customer: CurrentCustomer): Promise<InventoryDto> {
    return this.inventory.listUserInventory(customer.userId);
  }

}
