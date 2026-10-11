import { SteamCustomerGuard } from "./steam-customer.guard";
import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { UsersModule } from "../users/users.module";
import { CustomerSessionGuard } from "./customer-session.guard";
import { CsrfGuard } from "./csrf.guard";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [SessionsController],
  providers: [SteamCustomerGuard, SessionsService, CustomerSessionGuard, CsrfGuard],
  exports: [UsersModule, SteamCustomerGuard, SessionsService, CustomerSessionGuard, CsrfGuard],
})
export class SessionsModule {}
