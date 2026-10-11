import { BundlesModule } from "../bundles/bundles.module";
import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { CatalogModule } from "../catalog/catalog.module";
import { SessionsModule } from "../sessions/sessions.module";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";

@Module({
  imports: [BundlesModule, DatabaseModule, CatalogModule, SessionsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
