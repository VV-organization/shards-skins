import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { IDEMPOTENCY_KEY_HEADER } from "../../common/http/http-headers";
import { CurrentCustomerContext } from "../sessions/current-customer";
import { CsrfGuard } from "../sessions/csrf.guard";
import { CustomerSessionGuard } from "../sessions/customer-session.guard";
import type { CurrentCustomer } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";
import { PaymentsService, type SteamRefillSessionDto, type TopUpSessionDto } from "./payments.service";

type CreateTopUpSessionBody = {
  coinAmountMinor: number;
};

type CreateSteamRefillSessionBody = {
  amountRub: number;
  steamLogin: string;
};

const topUpSessionSchema = {
  type: "object",
  required: ["id", "userId", "status", "provider", "coinAmountMinor", "fiatAmountMinor", "fiatCurrency", "rate", "checkoutUrl"],
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string" },
    status: { type: "string", enum: ["provider_configuration_required", "provider_creation_pending", "checkout_pending", "paid", "failed", "manual_review"] },
    provider: { type: "string", enum: ["arc_pay"] },
    coinAmountMinor: { type: "integer", minimum: 10_000, maximum: 10_000_000 },
    fiatAmountMinor: { type: "integer", minimum: 1 },
    fiatCurrency: { type: "string", enum: ["RUB"] },
    rate: {
      type: "object",
      required: ["fiatMinor", "coinMinor"],
      properties: {
        fiatMinor: { type: "integer", enum: [100] },
        coinMinor: { type: "integer", enum: [160] },
      },
    },
    checkoutUrl: { type: "string", nullable: true },
  },
};

const steamRefillSessionSchema = {
  type: "object",
  required: ["id", "userId", "status", "provider", "amountRubMinor", "feeRubMinor", "fiatAmountMinor", "fiatCurrency", "steamLogin", "checkoutUrl"],
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string" },
    status: { type: "string", enum: ["provider_configuration_required", "provider_creation_pending", "checkout_pending", "paid", "failed", "manual_review"] },
    provider: { type: "string", enum: ["arc_pay"] },
    amountRubMinor: { type: "integer", minimum: 5_000, maximum: 943_300 },
    feeRubMinor: { type: "integer", minimum: 250, maximum: 47_165 },
    fiatAmountMinor: { type: "integer", minimum: 5_250, maximum: 990_465 },
    fiatCurrency: { type: "string", enum: ["RUB"] },
    steamLogin: { type: "string" },
    checkoutUrl: { type: "string", nullable: true },
  },
};

@ApiTags("Payments")
@Controller("payments")
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  @ApiOkResponse({ schema: topUpSessionSchema })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: "Unique customer-scoped top-up session key.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      required: ["coinAmountMinor"],
      properties: {
        coinAmountMinor: { type: "integer", minimum: 10_000, maximum: 10_000_000 },
      },
    },
  })
  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @HttpCode(200)
  @Post("top-up/sessions")
  createTopUpSession(
    @CurrentCustomerContext() customer: CurrentCustomer,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: CreateTopUpSessionBody,
  ): Promise<TopUpSessionDto> {
    return this.requireSteamTopUp(customer.userId).then(() => this.payments.createTopUpSession({
      userId: customer.userId,
      idempotencyKey: idempotencyKey ?? "",
      coinAmountMinor: body.coinAmountMinor,
    }));
  }

  @ApiOkResponse({ schema: steamRefillSessionSchema })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: "Unique customer-scoped Steam refill payment session key.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      required: ["amountRub", "steamLogin"],
      properties: {
        amountRub: { type: "integer", minimum: 50, maximum: 9433 },
        steamLogin: { type: "string", minLength: 3, maxLength: 64 },
      },
    },
  })
  @HttpCode(200)
  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @Post("steam-refill/sessions")
  async createSteamRefillSession(
    @CurrentCustomerContext() customer: CurrentCustomer,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: CreateSteamRefillSessionBody,
  ): Promise<SteamRefillSessionDto> {
    const user = await this.users.requireUser(customer.userId);
    if (!user.email?.verified) throw new BadRequestException({ code: "VERIFIED_EMAIL_REQUIRED", message: "Подтвердите почту" });
    return this.payments.createSteamRefillSession({
      userId: user.id,
      idempotencyKey: idempotencyKey ?? "",
      amountRub: body.amountRub,
      steamLogin: body.steamLogin,
    });
  }
  private async requireSteamTopUp(userId: string): Promise<void> {
    const user = await this.users.requireUser(userId);
    if (!user.steam.connected) throw new BadRequestException({code:"STEAM_IDENTITY_REQUIRED",message:"Войдите через Steam"});
  }

}
