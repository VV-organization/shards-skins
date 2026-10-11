import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { CURRENT_CUSTOMER, type CustomerRequest } from "./current-customer";
import { CUSTOMER_SESSION_COOKIE, parseExactCookie } from "./session-cookies";
import { SessionsService } from "./sessions.service";

@Injectable()
export class CustomerSessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    let token: string | null;
    try {
      token = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    } catch {
      throw new UnauthorizedException();
    }
    if (token === null) throw new UnauthorizedException();
    const customer = await this.sessions.authenticate(token);
    if (customer === null) throw new UnauthorizedException();
    request[CURRENT_CUSTOMER] = customer;
    return true;
  }
}
