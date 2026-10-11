import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { SessionsModule } from "../sessions/sessions.module";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
  imports: [DatabaseModule, SessionsModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
