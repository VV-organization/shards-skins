import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../common/database/database.module';
import {QuotesService} from './quotes.service';
@Module({imports:[DatabaseModule],providers:[QuotesService],exports:[QuotesService]})
export class QuotesModule {}
