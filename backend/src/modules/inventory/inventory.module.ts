import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { SessionsModule } from "../sessions/sessions.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [DatabaseModule, SessionsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
