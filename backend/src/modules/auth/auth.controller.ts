import { Controller, Get, Inject, Query, Redirect, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import {
  clearSecureCookie,
  CUSTOMER_SESSION_COOKIE,
  parseExactCookie,
  secureCustomerSessionCookie,
  secureCookie,
  STEAM_AUTH_BROWSER_COOKIE,
} from "../sessions/session-cookies";
import { AuthService } from "./auth.service";

function rawQuery(request: Request): string {
  const index = request.originalUrl.indexOf("?");
  return index >= 0 ? request.originalUrl.slice(index + 1) : "";
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("steam/start")
  @Redirect()
  async startSteam(
    @Query("returnTo") returnTo: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string; statusCode: 302 }> {
    const attempt = await this.auth.beginSteam(returnTo);
    response.setHeader("Set-Cookie", secureCookie(STEAM_AUTH_BROWSER_COOKIE, attempt.browserToken, attempt.maximumAgeSeconds));
    return { url: attempt.authUrl.toString(), statusCode: 302 };
  }

  @Get("steam/callback")
  @Redirect()
  async steamCallback(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string; statusCode: 302 }> {
    const browserToken = parseExactCookie(request.headers.cookie, STEAM_AUTH_BROWSER_COOKIE);
    const sessionToken = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    const completed = await this.auth.completeSteam(rawQuery(request), browserToken, sessionToken);
    response.setHeader("Set-Cookie", [
      secureCustomerSessionCookie(completed.sessionToken, completed.sessionMaximumAgeSeconds),
      clearSecureCookie(STEAM_AUTH_BROWSER_COOKIE),
    ]);
    return { url: completed.returnTo, statusCode: 302 };
  }
}
