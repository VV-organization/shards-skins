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
  providers: [SessionsService, CustomerSessionGuard, CsrfGuard],
  exports: [SessionsService, CustomerSessionGuard, CsrfGuard],
})
export class SessionsModule {}
