import { Global, Module } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG, AppConfigModule } from "../../config/app-config.module";
import { buildDatabaseConnectionOptions } from "./database.config";
import { DatabaseService } from "./database.service";
import { DATABASE_CONNECTION_OPTIONS } from "./database.tokens";

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: DATABASE_CONNECTION_OPTIONS,
      useFactory: (config: AppConfig) => buildDatabaseConnectionOptions(config),
      inject: [APP_CONFIG],
    },
    DatabaseService,
  ],
  exports: [DATABASE_CONNECTION_OPTIONS, DatabaseService],
})
export class DatabaseModule {}
