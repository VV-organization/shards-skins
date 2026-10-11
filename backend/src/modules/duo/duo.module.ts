import {Module} from '@nestjs/common';
import {CatalogModule} from '../catalog/catalog.module';
import {CartModule} from '../cart/cart.module';
import {QuotesModule} from '../quotes/quotes.module';
import {SessionsModule} from '../sessions/sessions.module';
import {DuoService} from './duo.service';
import {DuoController} from './duo.controller';
@Module({imports:[CatalogModule,CartModule,QuotesModule,SessionsModule],providers:[DuoService],controllers:[DuoController],exports:[DuoService]})
export class DuoModule{}
