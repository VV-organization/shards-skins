import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { CurrentCustomer } from "./sessions.service";

export const CURRENT_CUSTOMER = Symbol("CURRENT_CUSTOMER");

export type CustomerRequest = Request & {
  [CURRENT_CUSTOMER]?: CurrentCustomer;
};

export const CurrentCustomerContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentCustomer => {
    const customer = context.switchToHttp().getRequest<CustomerRequest>()[CURRENT_CUSTOMER];
    if (!customer) throw new Error("Authenticated customer is missing");
    return customer;
  },
);
