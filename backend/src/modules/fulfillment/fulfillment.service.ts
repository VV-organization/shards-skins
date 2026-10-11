import {Injectable} from '@nestjs/common';
import type {DatabaseService} from '../../common/database/database.service';
import type {CheckoutRecipientSnapshot} from '../checkout/checkout.service';
export type FulfillmentOrderLineInput={id:string;productSlug:string;kind:'steam';title:string;unitPriceCoinMinor:number;recipientSnapshot:CheckoutRecipientSnapshot};
/** Payment settlement only enqueues. All provider execution belongs to FulfillmentOperationService. */
@Injectable()
export class FulfillmentService {
 async enqueueOrderLineCommands(client:Pick<DatabaseService,'query'>,command:{orderId:string;lines:FulfillmentOrderLineInput[]}){
  for(const line of command.lines){
   if(line.recipientSnapshot.kind!=='steam-refill'||line.unitPriceCoinMinor!==0)throw new Error('INVALID_DIRECT_STEAM_COMMAND');
   await client.query(`INSERT INTO fulfillment_commands(order_id,order_line_id,provider,command_type,status,idempotency_key,payload_snapshot) VALUES ($1,$2,'sih','sih_steam_refill','pending',$3,$4::jsonb) ON CONFLICT(order_line_id,command_type) DO NOTHING`,[command.orderId,line.id,`${command.orderId}:${line.id}:sih_steam_refill`,JSON.stringify({orderId:command.orderId,orderLineId:line.id,productSlug:line.productSlug,kind:'steam',title:line.title,unitPriceCoinMinor:0,recipientSnapshot:line.recipientSnapshot})]);
  }
 }
}
