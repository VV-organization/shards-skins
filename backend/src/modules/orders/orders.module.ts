import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { SessionsModule } from "../sessions/sessions.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [DatabaseModule, SessionsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
