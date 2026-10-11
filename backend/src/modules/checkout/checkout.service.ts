// Shared checkout response types; the only execution path is QuotedCheckoutService.
import {BadRequestException,HttpException} from '@nestjs/common';
import type {CatalogProductDto} from '../catalog/catalog.types';
export type CheckoutRecipientSnapshot =
  | {
    kind: "steam-trade";
    steamId64: string;
    steamTradePartnerAccountId: string;
  }
  | {
    kind: "steam-refill";
    steamLogin: string;
  }
  | {
    kind: "delivery-email";
    email: string;
    verificationId: string;
  };

export type CheckoutOrderLineDto = {
  bundleId?: string;
  id: string;
  productSlug: string;
  kind: CatalogProductDto["kind"];
  title: string;
  quantity: 1;
  unitPriceCoinMinor: number;
  recipientSnapshot: CheckoutRecipientSnapshot;
};

export type CheckoutOrderDto = {
  id: string;
  userId: string;
  status: "held";
  totalCoinMinor: number;
  recipientSnapshots: CheckoutRecipientSnapshot[];
  lines: CheckoutOrderLineDto[];
};

export class CheckoutInsufficientBalanceError extends HttpException {
  readonly code = "CHECKOUT_INSUFFICIENT_BALANCE";

  constructor(readonly requiredCoinMinor: number, readonly availableCoinMinor: number) {
    super({
      statusCode: 402,
      code: "CHECKOUT_INSUFFICIENT_BALANCE",
      message: "Insufficient Coins balance for checkout",
      requiredCoinMinor,
      availableCoinMinor,
    }, 402);
  }
}

export class CheckoutSteamTradeUrlRequiredError extends BadRequestException {
  readonly code = "STEAM_TRADE_URL_REQUIRED";

  constructor() {
    super({
      statusCode: 400,
      code: "STEAM_TRADE_URL_REQUIRED",
      message: "Steam Trade URL is required for skin checkout",
    });
  }
}
