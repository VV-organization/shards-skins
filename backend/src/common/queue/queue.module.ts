import { Module } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { buildQueueConnectionOptions } from "./queue.config";
import { QUEUE_CONNECTION_OPTIONS } from "./queue.tokens";

@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION_OPTIONS,
      useFactory: (config: AppConfig) => buildQueueConnectionOptions(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [QUEUE_CONNECTION_OPTIONS],
})
export class QueueModule {}
