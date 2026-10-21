import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { PaymentsService, type PaymentWebhookResultDto } from "./payments.service";

type RawBodyRequest = {
  rawBody?: Buffer;
};

const paymentWebhookResultSchema = {
  type: "object",
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: ["processed", "duplicate", "ignored", "unmatched", "rejected"],
    },
  },
};

@ApiTags("Payments")
@Controller("payments/webhooks")
export class PaymentsWebhookController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @ApiOkResponse({ schema: paymentWebhookResultSchema })
  @ApiHeader({
    name: "Payment-Sign",
    required: true,
    description: "ArcoPay RSA-SHA1 signature of the raw request body, encoded as base64.",
  })
  @HttpCode(200)
  @Post("arco-pay")
  handleArcoPayWebhook(
    @Headers("webhook-id") providerEventId: string | undefined,
    @Headers("payment-sign") webhookSignature: string | undefined,
    @Headers("x-arco-pay-signature") fakeSignature: string | undefined,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest,
  ): Promise<PaymentWebhookResultDto> {
    const signature = webhookSignature ?? fakeSignature;
    return this.payments.handleArcoPayWebhook({
      payload,
      ...(providerEventId === undefined ? {} : { providerEventId }),
      ...(request.rawBody === undefined ? {} : { rawBody: request.rawBody }),
      ...(signature === undefined ? {} : { signature }),
    });
  }
}
