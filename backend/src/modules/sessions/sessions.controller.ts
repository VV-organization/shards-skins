import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiOkResponse } from "@nestjs/swagger";

import { UsersService, type CustomerUser } from "../users/users.service";
import { CsrfGuard } from "./csrf.guard";
import { CurrentCustomerContext } from "./current-customer";
import { CustomerSessionGuard } from "./customer-session.guard";
import { clearCustomerSessionCookie, CUSTOMER_SESSION_COOKIE, parseExactCookie } from "./session-cookies";
import { SessionsService, type CurrentCustomer } from "./sessions.service";

@Controller("session")
export class SessionsController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  @UseGuards(CustomerSessionGuard)
  @Get("me")
  @ApiOkResponse({ schema: { type: "object", required: ["id", "steam"], properties: {
    id: { type: "string" }, steam: { type: "object", required: ["connected"], properties: { connected: { type: "boolean" }, steamId64: { type: "string" } } },
    email: { type: "object", required: ["address", "verified"], properties: { address: { type: "string" }, verified: { type: "boolean", enum: [true] } } },
  } } })
  async me(@CurrentCustomerContext() customer: CurrentCustomer): Promise<CustomerUser> {
    const user = await this.users.requireUser(customer.userId);
    return {
      id: user.id,
      steam: user.steam,
      ...(user.email ? { email: user.email } : {}),
    };
  }

  @UseGuards(CustomerSessionGuard)
  @Get("csrf")
  @ApiOkResponse({ schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } })
  csrf(@Req() request: Request): { token: string } {
    const token = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    if (token === null) throw new Error("Authenticated request has no customer cookie");
    return { token: this.sessions.createCsrfToken(token) };
  }

  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    if (token !== null) await this.sessions.revoke(token);
    response.setHeader("Set-Cookie", clearCustomerSessionCookie());
  }
}
