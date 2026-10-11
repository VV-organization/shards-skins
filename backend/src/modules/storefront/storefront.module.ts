import {DatabaseModule} from '../../common/database/database.module';
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
@Module({ imports: [AppConfigModule,DatabaseModule], controllers: [StorefrontController], providers: [StorefrontService], exports:[StorefrontService] })
export class StorefrontModule {}
