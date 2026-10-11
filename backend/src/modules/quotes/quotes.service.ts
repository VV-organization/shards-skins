import { BadRequestException, ConflictException, HttpException, Inject, Injectable } from '@nestjs/common';
import {createHash} from 'node:crypto';
import {DatabaseService} from '../../common/database/database.service';
type Client=Pick<DatabaseService,'query'>;
export type QuotePurpose='duo'|'checkout'|'wallet_topup'|'steam_refill';
export type Quote<T>={id:string;purpose:QuotePurpose;userId:string|null;payload:T;expiresAt:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class QuotesService {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 async limit(address:string):Promise<void>{
  const key=createHash('sha256').update(`quote:${address}`).digest('hex');
  const result=await this.database.query<{count:number}>(`INSERT INTO commerce_quote_limits(key,count) VALUES ($1,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN commerce_quote_limits.window_started_at < clock_timestamp()-interval '1 minute' THEN 1 ELSE commerce_quote_limits.count+1 END,
    window_started_at=CASE WHEN commerce_quote_limits.window_started_at < clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE commerce_quote_limits.window_started_at END RETURNING count`,[key]);
  if((result.rows[0]?.count??61)>60)throw new HttpException('Too many quote requests',429);
 }
 async issue<T>(purpose:QuotePurpose,payload:T,userId:string|null=null,client:Client=this.database):Promise<Quote<T>>{
  const result=await client.query<{id:string;expires_at:Date}>(`INSERT INTO commerce_quotes(purpose,user_id,payload,expires_at) VALUES ($1,$2,$3::jsonb,clock_timestamp()+interval '60 seconds') RETURNING id,expires_at`,[purpose,userId,JSON.stringify(payload)]);
  const row=result.rows[0];if(!row)throw new Error('QUOTE_NOT_CREATED');
  return {id:row.id,purpose,userId,payload,expiresAt:row.expires_at.toISOString()};
 }
 async lock<T>(client:Client,id:string,purpose:QuotePurpose,userId:string):Promise<T>{
  if(typeof id!=='string'||!uuid.test(id))throw new BadRequestException('INVALID_QUOTE');
  const result=await client.query<{purpose:string;user_id:string|null;payload:T;valid:boolean;consumed_entity_id:string|null}>(`SELECT purpose,user_id,payload,expires_at>clock_timestamp() AS valid,consumed_entity_id FROM commerce_quotes WHERE id=$1 FOR UPDATE`,[id]);
  const row=result.rows[0];
  if(!row||row.purpose!==purpose||(row.user_id!==null&&row.user_id!==userId))throw new BadRequestException('INVALID_QUOTE');
  if(row.consumed_entity_id)throw new ConflictException('QUOTE_ALREADY_CONSUMED');
  if(!row.valid)throw new ConflictException('QUOTE_EXPIRED');
  return row.payload;
 }
 async consume(client:Client,id:string,entityId:string):Promise<void>{
  const result=await client.query('UPDATE commerce_quotes SET consumed_entity_id=$2,consumed_at=clock_timestamp() WHERE id=$1 AND consumed_entity_id IS NULL',[id,entityId]);
  if(result.rowCount!==1)throw new ConflictException('QUOTE_ALREADY_CONSUMED');
 }
}
