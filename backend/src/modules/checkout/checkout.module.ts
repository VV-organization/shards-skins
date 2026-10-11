import {QuotesModule} from "../quotes/quotes.module";
import {QuotedCheckoutService} from "./quoted-checkout.service";
import { BundlesModule } from "../bundles/bundles.module";
import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { AppConfigModule } from "../../config/app-config.module";
import { CartModule } from "../cart/cart.module";
import { CatalogModule } from "../catalog/catalog.module";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { SessionsModule } from "../sessions/sessions.module";
import { UsersModule } from "../users/users.module";
import { WalletModule } from "../wallet/wallet.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";

@Module({
  imports: [QuotesModule, BundlesModule, AppConfigModule, DatabaseModule, CatalogModule, FulfillmentModule, UsersModule, WalletModule, SessionsModule, CartModule],
  controllers: [CheckoutController],
  providers: [QuotedCheckoutService, CheckoutService],
  exports: [QuotedCheckoutService, CheckoutService],
})
export class CheckoutModule {}
