import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
@Module({ imports: [AppConfigModule], controllers: [StorefrontController], providers: [StorefrontService] })
export class StorefrontModule {}
