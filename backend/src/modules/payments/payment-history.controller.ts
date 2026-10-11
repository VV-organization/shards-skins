import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { PaymentHistoryDto } from "./payment-history.dto";
import { PaymentHistoryService } from "./payment-history.service";

@ApiTags("Payments")
@UseGuards(CustomerSessionGuard)
@Controller("payments/me")
export class PaymentHistoryController {
  constructor(@Inject(PaymentHistoryService) private readonly history: PaymentHistoryService) {}

  @ApiOkResponse({ type: PaymentHistoryDto })
  @Get("history")
  list(@CurrentCustomerContext() customer: CurrentCustomer): Promise<PaymentHistoryDto> {
    return this.history.listForUser(customer.userId);
  }
}
