import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { PaymentsModule } from "../payments/payments.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Module({
  imports: [DatabaseModule, FulfillmentModule, PaymentsModule],
  controllers: [AdminController],
  providers: [AdminGuard, AdminService],
})
export class AdminModule {}
