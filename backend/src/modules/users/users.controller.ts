import { BadRequestException, Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { CsrfGuard } from "../sessions/csrf.guard";
import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { parseOwnedTradeUrl } from "./steam-trade-url";
import { UsersService } from "./users.service";

@Controller("me")
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @Put("steam-trade-url")
  async putSteamTradeUrl(
    @CurrentCustomerContext() customer: CurrentCustomer,
    @Body() body: { tradeUrl?: unknown },
  ): Promise<{ configured: true }> {
    if (typeof body.tradeUrl !== "string") throw new Error("Invalid Steam Trade URL");
    const user = await this.users.requireUser(customer.userId);
    if (!user.steam.connected || user.steam.steamId64 === undefined) {
      throw new BadRequestException("Steam account is required");
    }
    const credential = parseOwnedTradeUrl(body.tradeUrl, user.steam.steamId64);
    await this.users.saveSteamTradeCredential(customer.userId, credential);
    return { configured: true };
  }

  @UseGuards(CustomerSessionGuard)
  @Get("steam-trade-url/status")
  @ApiOkResponse({ schema: { type: "object", required: ["configured"], properties: { configured: { type: "boolean" } } } })
  async steamTradeUrlStatus(@CurrentCustomerContext() customer: CurrentCustomer): Promise<{ configured: boolean }> {
    return { configured: await this.users.hasSteamTradeCredential(customer.userId) };
  }
}
