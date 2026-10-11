import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { CurrentCustomerContext } from "../sessions/current-customer";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { WalletService, type WalletBalanceDto, type WalletTransactionHistoryDto } from "./wallet.service";

const walletBalanceSchema = {
  type: "object",
  required: ["postedCoinMinor", "heldCoinMinor", "availableCoinMinor"],
  properties: {
    postedCoinMinor: { type: "integer", minimum: 0 },
    heldCoinMinor: { type: "integer", minimum: 0 },
    availableCoinMinor: { type: "integer", minimum: 0 },
  },
};

const walletTransactionsSchema = {
  type: "object",
  required: ["transactions"],
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        required: ["amountCoinMinor", "balanceAfterCoinMinor", "createdAt", "direction", "id", "reason", "status"],
        properties: {
          amountCoinMinor: { type: "integer", minimum: 1 },
          balanceAfterCoinMinor: { type: "integer", minimum: 0 },
          createdAt: { type: "string", format: "date-time" },
          direction: { type: "string", enum: ["credit", "debit"] },
          id: { type: "string", format: "uuid" },
          orderId: { type: "string", format: "uuid" },
          reason: { type: "string", enum: ["top_up", "purchase"] },
          status: { type: "string", enum: ["completed"] },
        },
      },
    },
  },
};

@ApiTags("Wallet")
@UseGuards(CustomerSessionGuard)
@Controller("wallet")
export class WalletController {
  constructor(@Inject(WalletService) private readonly wallet: WalletService) {}

  @ApiOkResponse({ schema: walletTransactionsSchema })
  @Get("me/transactions")
  transactions(@CurrentCustomerContext() customer: CurrentCustomer): Promise<WalletTransactionHistoryDto> {
    return this.wallet.listUserTransactions(customer.userId);
  }

  @ApiOkResponse({ schema: walletBalanceSchema })
  @Get("me")
  me(@CurrentCustomerContext() customer: CurrentCustomer): Promise<WalletBalanceDto> {
    return this.wallet.getBalance(customer.userId);
  }
}
