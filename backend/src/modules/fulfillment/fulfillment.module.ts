import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { SihClient } from "../providers/sih/sih.client";
import { SessionsModule } from "../sessions/sessions.module";
import { UsersModule } from "../users/users.module";
import { WalletModule } from "../wallet/wallet.module";
import { FulfillmentHistoryController } from "./fulfillment-history.controller";
import { FulfillmentHistoryService } from "./fulfillment-history.service";
import { FulfillmentService } from "./fulfillment.service";

@Module({
  imports: [DatabaseModule, SessionsModule, UsersModule, WalletModule],
  controllers: [FulfillmentHistoryController],
  providers: [
    {
      provide: SihClient,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SihClient => new SihClient({
        ...(config.sih.apiKeyFile ? { apiKeyFile: config.sih.apiKeyFile } : {}),
        marketBaseUrl: config.sih.marketBaseUrl,
        maximumBodyBytes: config.sih.maximumBodyBytes,
        requestTimeoutMs: config.sih.requestTimeoutMs,
        ...(config.sih.steamRefillApiKeyFile ? { steamRefillApiKeyFile: config.sih.steamRefillApiKeyFile } : {}),
        steamRefillBaseUrl: config.sih.steamRefillBaseUrl,
      }),
    },
    FulfillmentHistoryService,
    FulfillmentService,
  ],
  exports: [FulfillmentHistoryService, FulfillmentService],
})
export class FulfillmentModule {}
