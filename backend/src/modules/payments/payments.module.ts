import {GuestPaymentService} from './guest-payment.service';
import {GuestPaymentsController} from './guest-payments.controller';
import {QuotesModule} from "../quotes/quotes.module";
import {PaymentQuotesService} from "./payment-quotes.service";
import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { SessionsModule } from "../sessions/sessions.module";
import { UsersModule } from "../users/users.module";
import { WalletModule } from "../wallet/wallet.module";
import { PaymentsWebhookController } from "./payments-webhook.controller";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { ArcoPayClient } from "../providers/arco-pay/arco-pay.client";
import { PaymentHistoryController } from "./payment-history.controller";
import { PaymentHistoryService } from "./payment-history.service";

@Module({
  imports: [QuotesModule, DatabaseModule, SessionsModule, UsersModule, WalletModule, FulfillmentModule],
  controllers: [GuestPaymentsController,PaymentsController, PaymentsWebhookController, PaymentHistoryController],
  providers: [
    {
      provide: ArcoPayClient,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ArcoPayClient => new ArcoPayClient({
        apiKeyFile: config.arcoPay.apiKeyFile ?? "",
        bearerTokenFile: config.arcoPay.bearerTokenFile ?? "",
        shopId: config.arcoPay.shopId ?? "",
        callbackUrl: config.arcoPay.callbackUrl ?? "",
        paymentOrigin: config.arcoPay.paymentOrigin,
        baseUrl: config.arcoPay.apiUrl,
      }),
    },
    GuestPaymentService,
    PaymentQuotesService,
    PaymentsService,
    PaymentHistoryService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
