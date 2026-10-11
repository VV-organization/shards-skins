import {Inject,Injectable} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseService} from '../../common/database/database.service';
import {APP_CONFIG} from '../../config/app-config.module';
import type {AppConfig} from '../../config/app-config';
import {SihClient,SihProviderError} from '../providers/sih/sih.client';
import type {SihSkinOrder} from '../providers/sih/sih.types';
import {decryptCredential,type EncryptedSteamTradeCredential} from '../users/users.service';
import {WalletService} from '../wallet/wallet.service';
type Client=Pick<DatabaseService,'query'>;
type Payload={schemaVersion?:number;game?:string;marketHashName?:string;supplierCostCapMicrousd?:string;recipientSnapshot?:{steamId64?:string};recipientCredential?:EncryptedSteamTradeCredential;steamCheckTransactionId?:string;amountRub?:number;steamLogin?:string};
export type FulfillmentLease={id:string;orderId:string;lineId:string;userId:string;type:string;providerOperationId:string;leaseToken:string;payload:Payload;requestHash:string;attemptId:string;createdAt:string};
export type OperationBatch={checked:number;reconciled:number;errors:number;commands:OperationResult[]};
export type OperationResult={status:'none'|'submitted'|'completed'|'failed'|'manual_review'|'retry'|'stale';commandId?:string};
type Outcome={kind:'finished'|'failed'|'submitted'|'manual_review'|'retry';errorCode?:string;response?:unknown};
function json(value:unknown){return JSON.stringify(value,(_key,value:unknown)=>typeof value==='bigint'?value.toString():value);}
function hash(value:unknown){return createHash('sha256').update(json(value)).digest('hex');}
@Injectable()
export class FulfillmentOperationService {
 private readonly workerId=randomUUID();
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService,@Inject(SihClient)private readonly sih:SihClient,@Inject(WalletService)private readonly wallet:WalletService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
 async claim(mode:'submit'|'reconcile'|'review'):Promise<FulfillmentLease|null>{
  return this.database.transaction(async client=>{
   const rows=await client.query<{id:string;order_id:string;order_line_id:string;user_id:string;command_type:string;provider_operation_id:string;payload_snapshot:Payload;request_snapshot_hash:string|null;created_at:Date}>(`SELECT c.id,c.order_id,c.order_line_id,o.user_id,c.command_type,c.provider_operation_id,c.payload_snapshot,c.request_snapshot_hash,c.created_at FROM fulfillment_commands c JOIN orders o ON o.id=c.order_id WHERE c.provider='sih' AND c.command_type IN ('sih_skin_purchase','sih_steam_refill') AND c.status=ANY($1::text[]) AND c.available_at<=clock_timestamp() AND (c.lease_expires_at IS NULL OR c.lease_expires_at<=clock_timestamp()) ORDER BY c.available_at,c.created_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,[mode==='submit'?['pending']:mode==='review'?['submitted','awaiting_confirmation','manual_review']:['submitted','awaiting_confirmation']]);
   const row=rows.rows[0];if(!row)return null;
   const leaseToken=randomUUID(),attemptId=randomUUID(),requestHash=row.request_snapshot_hash??hash(row.payload_snapshot);
   await client.query(`UPDATE fulfillment_commands SET status=$2,lease_token=$3,lease_owner=$4,lease_expires_at=clock_timestamp()+interval '3 minutes',locked_at=clock_timestamp(),attempt_count=attempt_count+1,request_snapshot_hash=$5 WHERE id=$1`,[row.id,mode==='submit'?'processing':'reconciling',leaseToken,this.workerId,requestHash]);
   await client.query(`INSERT INTO fulfillment_provider_attempts(id,command_id,order_id,order_line_id,provider,operation,status,idempotency_key,request_snapshot) VALUES ($1,$2,$3,$4,'sih',$5,'pending',$6,$7::jsonb)`,[attemptId,row.id,row.order_id,row.order_line_id,mode,`${row.provider_operation_id}:${leaseToken}`,json({providerOperationId:row.provider_operation_id,leaseToken,requestHash,payload:row.payload_snapshot})]);
   return {id:row.id,orderId:row.order_id,lineId:row.order_line_id,userId:row.user_id,type:row.command_type,providerOperationId:row.provider_operation_id,leaseToken,payload:row.payload_snapshot,requestHash,attemptId,createdAt:row.created_at.toISOString()};
  });
 }
 private async markDispatched(lease:FulfillmentLease):Promise<boolean>{
  const result=await this.database.query(`UPDATE fulfillment_commands SET dispatched_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND lease_expires_at>clock_timestamp() AND dispatched_at IS NULL`,[lease.id,lease.leaseToken]);return result.rowCount===1;
 }
 async submitNext(skinTestMode=false):Promise<OperationResult>{
  if(!this.config.commerce?.fulfillmentEnabled)return {status:'none'};
  const lease=await this.claim('submit');if(!lease)return {status:'none'};
  if(hash(lease.payload)!==lease.requestHash)return await this.complete(lease,{kind:'manual_review',errorCode:'IMMUTABLE_REQUEST_CHANGED'});
  const p=lease.payload;
  if(lease.type==='sih_steam_refill'){
   if(!p.steamCheckTransactionId||!p.steamLogin||!Number.isSafeInteger(p.amountRub)||Number(p.amountRub)<50||Number(p.amountRub)>9433)return await this.complete(lease,{kind:'manual_review',errorCode:'STEAM_PRECHECK_MISSING'});
   if(!await this.markDispatched(lease))return {status:'stale',commandId:lease.id};
   try{
    const result=await this.sih.paySteamRefill({amountRub:p.amountRub as number,steamUsername:p.steamLogin,transactionId:p.steamCheckTransactionId});
    return await this.complete(lease,result.paymentAmountRub===BigInt(p.amountRub as number)?{kind:'finished',response:result}:{kind:'manual_review',errorCode:'STEAM_AMOUNT_MISMATCH',response:result});
   }catch(error){return await this.complete(lease,{kind:'manual_review',errorCode:error instanceof SihProviderError&&error.disposition==='permanent'?'STEAM_REFUND_REVIEW_REQUIRED':'STEAM_PAY_OUTCOME_UNKNOWN'});}
  }
  if(p.schemaVersion!==1||p.game!=='cs2'||!p.marketHashName||!p.supplierCostCapMicrousd||!/^\d+$/.test(p.supplierCostCapMicrousd)||!p.recipientCredential||!p.recipientSnapshot?.steamId64)return await this.complete(lease,{kind:'manual_review',errorCode:'IMMUTABLE_SKIN_REQUEST_MISSING'});
  const cap=BigInt(p.supplierCostCapMicrousd);
  if(cap<=0n)return await this.complete(lease,{kind:'manual_review',errorCode:'INVALID_COST_CAP'});
  let credential;try{credential=decryptCredential(p.recipientCredential);}catch{return await this.complete(lease,{kind:'manual_review',errorCode:'RECIPIENT_SNAPSHOT_UNREADABLE'});}
  try{
   const current=await this.sih.getMinimumItem({game:'cs2',marketHashName:p.marketHashName});
   if(!current||current.availableQuantity<1||current.marketHashName!==p.marketHashName||current.priceMicrousd>cap)return await this.complete(lease,{kind:'failed',errorCode:'SUPPLIER_STOCK_OR_COST_CHANGED'});
  }catch{return await this.complete(lease,{kind:'retry',errorCode:'SUPPLIER_PREFLIGHT_UNAVAILABLE'});}
  if(!await this.markDispatched(lease))return {status:'stale',commandId:lease.id};
  try{
   const result=await this.sih.createSkinOrder({customId:lease.providerOperationId,amountMicrousd:cap,game:'cs2',marketHashName:p.marketHashName,steamId64:p.recipientSnapshot.steamId64,tradeToken:credential.token,test:skinTestMode});
   if(result.projection==='create_acknowledgement')return await this.complete(lease,{kind:'submitted',response:result});
   return await this.complete(lease,this.skinOutcome(lease,result));
  }catch(error){
   return await this.complete(lease,error instanceof SihProviderError&&error.disposition==='permanent'?{kind:'failed',errorCode:'SUPPLIER_REJECTED'}:{kind:'submitted',errorCode:'SUPPLIER_CREATE_OUTCOME_UNKNOWN'});
  }
 }
 async reconcileNext(includeReview=false):Promise<OperationResult>{
  const lease=await this.claim(includeReview?'review':'reconcile');if(!lease)return {status:'none'};
  if(lease.type==='sih_steam_refill')return await this.complete(lease,{kind:'manual_review',errorCode:'STEAM_PAY_OUTCOME_UNKNOWN'});
  if(hash(lease.payload)!==lease.requestHash)return await this.complete(lease,{kind:'manual_review',errorCode:'IMMUTABLE_REQUEST_CHANGED'});
  try{return await this.complete(lease,this.skinOutcome(lease,await this.sih.getSkinOrder({customId:lease.providerOperationId})));}
  catch(error){return await this.complete(lease,(error instanceof SihProviderError&&error.disposition==='permanent')||Date.now()-Date.parse(lease.createdAt)>86400000?{kind:'manual_review',errorCode:'SUPPLIER_LOOKUP_INCONCLUSIVE'}:{kind:'submitted',errorCode:'SUPPLIER_LOOKUP_UNAVAILABLE'});}
 }
 private skinOutcome(lease:FulfillmentLease,result:SihSkinOrder):Outcome{
  const p=lease.payload;
  if(result.customId!==lease.providerOperationId||result.marketHashName!==p.marketHashName||result.steamId64!==p.recipientSnapshot?.steamId64||!p.supplierCostCapMicrousd||result.amountMicrousd>BigInt(p.supplierCostCapMicrousd))return {kind:'manual_review',errorCode:'SUPPLIER_IDENTITY_OR_COST_MISMATCH',response:result};
  if(result.protection?.status==='failed'||result.protection?.error)return {kind:'manual_review',errorCode:'SUPPLIER_PROTECTION_REVIEW',response:result};
  if(result.status==='finished')return {kind:result.protection?.status==='processing'?'submitted':'finished',response:result};
  if(result.status==='failed'||result.status==='penalized')return {kind:'failed',response:result};
  return {kind:'submitted',response:result};
 }
 async complete(lease:FulfillmentLease,outcome:Outcome):Promise<OperationResult>{
  return this.database.transaction(async client=>{
   // Every sibling transition serializes under the same wallet -> order lock order.
   await this.wallet.lockUserBalance(client,lease.userId);
   await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[lease.orderId]);
   await client.query('SELECT id FROM order_lines WHERE id=$1 FOR UPDATE',[lease.lineId]);
   const fenced=await client.query<{id:string}>(`SELECT id FROM fulfillment_commands WHERE id=$1 AND lease_token=$2 AND lease_expires_at>clock_timestamp() FOR UPDATE`,[lease.id,lease.leaseToken]);
   if(!fenced.rows[0])return {status:'stale',commandId:lease.id};
   const state=outcome.kind==='finished'?'completed':outcome.kind==='retry'?'pending':outcome.kind;
   const terminal=['finished','failed','manual_review'].includes(outcome.kind);
   await client.query(`UPDATE fulfillment_commands SET status=$3,last_error_code=$4,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,locked_at=NULL,finished_at=CASE WHEN $5 THEN clock_timestamp() ELSE NULL END,available_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2`,[lease.id,lease.leaseToken,state,outcome.errorCode??null,terminal]);
   await client.query(`UPDATE fulfillment_provider_attempts SET status=$2,response_snapshot=$3::jsonb,error_code=$4,finished_at=clock_timestamp() WHERE id=$1`,[lease.attemptId,state,json(outcome.response??{}),outcome.errorCode??null]);
   if(terminal)await client.query(`INSERT INTO audit_events(action,target_type,target_id,metadata) VALUES ('fulfillment.transition','fulfillment_command',$1,$2::jsonb)`,[lease.id,json({providerOperationId:lease.providerOperationId,status:state,errorCode:outcome.errorCode??null})]);
   const lineStatus=outcome.kind==='finished'?'supplier_finished':outcome.kind==='failed'?'supplier_failed':outcome.kind==='manual_review'?'manual_review':'supplier_submitted';
   await client.query('UPDATE order_lines SET status=$2 WHERE id=$1',[lease.lineId,lineStatus]);
   if(outcome.kind==='manual_review'&&lease.type==='sih_steam_refill')await client.query(`UPDATE steam_refill_payments SET metadata=metadata||jsonb_build_object('refundStatus',$2::text) WHERE order_id=$1`,[lease.orderId,outcome.errorCode==='STEAM_REFUND_REVIEW_REQUIRED'?'manual_refund_required':'outcome_review_required']);
   if(outcome.kind==='manual_review')await client.query("UPDATE orders SET status='manual_review',updated_at=clock_timestamp() WHERE id=$1",[lease.orderId]);
   if(outcome.kind==='finished'||outcome.kind==='failed')await this.settle(client,lease.orderId,lease.userId);
   return {status:outcome.kind==='finished'?'completed':outcome.kind,commandId:lease.id};
  });
 }
 private async settle(client:Client,orderId:string,userId:string):Promise<boolean>{
  const totals=await client.query<{open:number;count:number;finished:number;capture:string}>(`SELECT count(*)::integer AS count,count(*) FILTER(WHERE status NOT IN ('supplier_finished','supplier_failed'))::integer AS open,count(*) FILTER(WHERE status='supplier_finished')::integer AS finished,coalesce(sum(unit_price_coin_minor*quantity) FILTER(WHERE status='supplier_finished'),0)::text AS capture FROM order_lines WHERE order_id=$1`,[orderId]);
  const total=totals.rows[0];if(!total||total.count===0||total.open>0)return false;
  const hold=await client.query<{status:string}>('SELECT status FROM wallet_holds WHERE order_id=$1 AND user_id=$2 FOR UPDATE',[orderId,userId]);
  if(hold.rows[0]?.status==='active')await this.wallet.settleOrderHoldWithClient(client,{orderId,userId,captureCoinMinor:Number(total.capture),idempotencyKey:`fulfillment-settle:${orderId}`,reason:'fulfillment_terminal'});
  const status=total.finished===0?'failed':total.finished===total.count?'fulfilled':'partially_fulfilled';
  await client.query('UPDATE orders SET status=$2,updated_at=clock_timestamp() WHERE id=$1',[orderId,status]);
  return true;
 }
 async reconcileSubmittedSkinCommands(command:{limit?:number}={}):Promise<OperationBatch>{
  const limit=command.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('INVALID_RECOVERY_LIMIT');
  await this.recoverExpired(limit);
  const result:OperationBatch={checked:0,reconciled:0,errors:0,commands:[]};
  for(let i=0;i<limit;i++){try{const item=await this.reconcileNext(true);if(item.status==='none')break;result.checked++;result.reconciled++;result.commands.push(item);}catch{result.errors++;}}
  await this.settleTerminalHolds(limit);return result;
 }
 async recoverExpired(limit=20):Promise<number>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('INVALID_RECOVERY_LIMIT');
  return this.database.transaction(async client=>{
   const result=await client.query<{id:string;status:string}>(`WITH expired AS (SELECT id FROM fulfillment_commands WHERE status IN ('processing','reconciling') AND lease_expires_at<=clock_timestamp() ORDER BY lease_expires_at LIMIT $1 FOR UPDATE SKIP LOCKED) UPDATE fulfillment_commands c SET status=CASE WHEN c.dispatched_at IS NULL THEN 'pending' ELSE 'awaiting_confirmation' END,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,locked_at=NULL,available_at=clock_timestamp(),last_error_code='WORKER_LEASE_EXPIRED' FROM expired WHERE c.id=expired.id RETURNING c.id,c.status`,[limit]);
   for(const row of result.rows){await client.query("UPDATE fulfillment_provider_attempts SET status='unknown',error_code='WORKER_LEASE_EXPIRED',finished_at=clock_timestamp() WHERE command_id=$1 AND finished_at IS NULL",[row.id]);await client.query(`INSERT INTO audit_events(action,target_type,target_id,metadata) VALUES ('fulfillment.lease_recovered','fulfillment_command',$1,$2::jsonb)`,[row.id,json({status:row.status,workerId:this.workerId})]);}
   return result.rowCount??0;
  });
 }
 async settleTerminalHolds(limit=20):Promise<number>{
  const candidates=await this.database.query<{order_id:string;user_id:string}>(`SELECT h.order_id,h.user_id FROM wallet_holds h WHERE h.status='active' AND EXISTS(SELECT 1 FROM order_lines l WHERE l.order_id=h.order_id) AND NOT EXISTS(SELECT 1 FROM order_lines l WHERE l.order_id=h.order_id AND l.status NOT IN ('supplier_finished','supplier_failed')) ORDER BY h.created_at LIMIT $1`,[limit]);
  let settled=0;for(const candidate of candidates.rows)if(await this.database.transaction(async client=>{await this.wallet.lockUserBalance(client,candidate.user_id);await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[candidate.order_id]);return this.settle(client,candidate.order_id,candidate.user_id);}))settled++;
  return settled;
 }
}
