import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { CUSTOMER_SESSION_COOKIE, parseExactCookie } from "./session-cookies";
import { SessionsService } from "./sessions.service";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers["x-csrf-token"];
    let token: string | null;
    try {
      token = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    } catch {
      throw new ForbiddenException();
    }
    if (token === null || typeof header !== "string" || header.includes(",") || !this.sessions.verifyCsrfToken(token, header)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
