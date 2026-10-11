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
    name: "Webhook-Id",
    required: false,
    description: "Provider webhook idempotency id. In fake mode this may also be present in the JSON payload.",
  })
  @ApiHeader({
    name: "Webhook-Signature",
    required: true,
    description: "payment provider HMAC signature in `t=<unix>,v1=<hex>` format. Fake mode also accepts X-Arc-Pay-Signature.",
  })
  @ApiHeader({
    name: "Webhook-Timestamp",
    required: false,
    description: "Unix timestamp included in the payment provider signed payload.",
  })
  @HttpCode(200)
  @Post("arc-pay")
  handleArcPayWebhook(
    @Headers("webhook-id") providerEventId: string | undefined,
    @Headers("webhook-signature") webhookSignature: string | undefined,
    @Headers("x-arc-pay-signature") fakeSignature: string | undefined,
    @Headers("webhook-timestamp") timestamp: string | undefined,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest,
  ): Promise<PaymentWebhookResultDto> {
    const signature = webhookSignature ?? fakeSignature;
    return this.payments.handleArcPayWebhook({
      payload,
      ...(providerEventId === undefined ? {} : { providerEventId }),
      ...(request.rawBody === undefined ? {} : { rawBody: request.rawBody }),
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(signature === undefined ? {} : { signature }),
    });
  }
}
