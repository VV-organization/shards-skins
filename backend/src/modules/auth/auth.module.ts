import { Module } from "@nestjs/common";

import { SessionsModule } from "../sessions/sessions.module";
import { UsersModule } from "../users/users.module";
import { UsersController } from "../users/users.controller";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SteamOpenIdVerifier } from "./steam-openid-verifier";

@Module({
  imports: [SessionsModule, UsersModule],
  controllers: [AuthController, UsersController],
  providers: [AuthService, SteamOpenIdVerifier],
  exports: [AuthService],
})
export class AuthModule {}
