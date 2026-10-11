import { Module } from "@nestjs/common";

import { AppConfigModule } from "../../config/app-config.module";
import { DatabaseModule } from "../../common/database/database.module";
import { AdminModule } from "../admin/admin.module";
import { PaymentsModule } from "../payments/payments.module";
import { WalletModule } from "../wallet/wallet.module";
import { IntegrationController } from "./integration.controller";
import { IntegrationHealthService } from "./integration-health.service";
import { IntegrationSyntheticScenarioService } from "./integration-synthetic-scenario.service";
import { IntegrationService } from "./integration.service";
import { VvAdminDispatcher } from "./vv-admin-dispatcher";
import { VvAdminOutboxService } from "./vv-admin-outbox.service";
import { VvAdminScenarioAuthVerifier } from "./vv-admin-scenario-auth";

@Module({
  imports: [AppConfigModule, AdminModule, DatabaseModule, PaymentsModule, WalletModule],
  controllers: [IntegrationController],
  providers: [
    IntegrationHealthService,
    IntegrationService,
    IntegrationSyntheticScenarioService,
    VvAdminScenarioAuthVerifier,
    VvAdminOutboxService,
    VvAdminDispatcher,
  ],
  exports: [VvAdminOutboxService, VvAdminDispatcher],
})
export class IntegrationModule {}
