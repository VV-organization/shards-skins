import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SessionsModule } from "../sessions/sessions.module";
import { UsersModule } from "../users/users.module";
import { EmailAuthController } from "./email-auth.controller";
import { EmailAuthRuntimeProvider, EmailAuthService } from "./email-auth.service";

@Module({
  imports: [DatabaseModule, NotificationsModule, SessionsModule, UsersModule],
  controllers: [EmailAuthController],
  providers: [EmailAuthRuntimeProvider, EmailAuthService],
  exports: [EmailAuthService],
})
export class EmailAuthModule {}
