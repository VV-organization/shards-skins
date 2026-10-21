import {createHmac,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import request from 'supertest';
import {vi} from 'vitest';
import {AppModule} from '../app.module';
import {APP_CONFIG} from '../config/app-config.module';
import {loadAppConfig} from '../config/app-config';
import {SihClient} from '../modules/providers/sih/sih.client';
import type {SihSkinOrder} from '../modules/providers/sih/sih.types';
import {SessionsService} from '../modules/sessions/sessions.service';
import {CUSTOMER_SESSION_COOKIE} from '../modules/sessions/session-cookies';
// Test-only boundary: callers explicitly select the DTO after asserting the HTTP status.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const responseBody=<T>(response:{body:unknown})=>response.body as T;
function stable(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;}
export async function commerceFixture(databaseUrl:string){
 process.env.DATABASE_URL=databaseUrl;const pool=new Pool({connectionString:databaseUrl}),directory=await mkdtemp(join(tmpdir(),'shards-acceptance-')),secret='fixture-only-signing-secret';await writeFile(join(directory,'hook'),secret);
 const config=loadAppConfig({DATABASE_URL:databaseUrl,SHARDS_CHECKOUT_ENABLED:'true',SHARDS_PAYMENTS_ENABLED:'true',SHARDS_FULFILLMENT_ENABLED:'true',ARCO_PAY_PROVIDER_MODE:'fake',ARCO_PAY_FAKE_CHECKOUT_BASE_URL:'https://checkout.example.test',ARCO_PAY_PUBLIC_KEY_FILE:join(directory,'hook')});
 const known=new Map<string,SihSkinOrder>();
 const provider={
  getMinimumItem:vi.fn(({marketHashName}:{marketHashName:string})=>Promise.resolve({marketHashName,game:'cs2',availableQuantity:5,priceMicrousd:1000000n,imageUrl:null})),
  createSkinOrder:vi.fn((input:{customId:string;marketHashName:string;steamId64:string})=>{const order:SihSkinOrder={...input,projection:'order',providerOrderId:input.customId,status:'sent',amountMicrousd:1000000n,expectedAmountMicrousd:1000000n,offerId:'fixture-offer',protection:null};known.set(input.customId,order);return Promise.resolve(order);}),
  getSkinOrder:vi.fn(({customId}:{customId:string}):Promise<SihSkinOrder>=>{const found=known.get(customId);if(!found)throw new Error('Unknown fixture order');return Promise.resolve({...found,status:'finished' as const});}),
  checkSteamAccount:vi.fn(({steamUsername}:{steamUsername:string})=>Promise.resolve({transactionId:`transaction-${steamUsername}`})),
  paySteamRefill:vi.fn(({amountRub}:{amountRub:number})=>Promise.resolve({paymentAmountRub:BigInt(amountRub)})),
 };
 let app:INestApplication;
 async function start(){app=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config).overrideProvider(SihClient).useValue(provider).compile()).createNestApplication({rawBody:true});await app.listen(0,'127.0.0.1');}
 await start();
 async function identity(id:string,steam=true){const steamId='76561198000000900';await pool.query('INSERT INTO users(id,steam_id64) VALUES ($1,$2)',[id,steam?steamId:null]);const session=await app.get(SessionsService).createSession(id,null);return {userId:id,steamId,cookie:`${CUSTOMER_SESSION_COOKIE}=${session.token}`,csrf:app.get(SessionsService).createCsrfToken(session.token)};}
 async function catalog(){
  const run=await pool.query<{id:string}>("INSERT INTO catalog_sync_runs(source,game,status,observed_at,finished_at,row_count) VALUES ('sih','cs2','promoted',now(),now(),2) RETURNING id");
  for(const category of ['knife','gloves']){const slug=`fixture-${category}`;
   await pool.query(`INSERT INTO supplier_listings(supplier,game,market_hash_name,active,available_quantity,price_microusd,last_seen_at,last_sync_run_id) VALUES ('sih','cs2',$1,true,5,1000000,now(),$2)`,[slug,run.rows[0]?.id]);
   await pool.query(`INSERT INTO catalog_products(id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,supplier_provider,supplier_item_id,public_enabled,category_id,ever_published) VALUES ($1,$1,'skins','Скины','cs2',$2,$1,'fixture',100,'available','steam-trade',1,'{}','{}','{"specifications":[],"fulfillment":{"title":"Steam","description":"Trade","requirements":[]}}','sih',$1,true,$2,true)`,[slug,category]);
  }
 }
 const http=()=>request(app.getHttpServer() as Parameters<typeof request>[0]);
 async function captured(id:string,amount:number,eventId=`captured-${id}`,valid=true){const row=(await pool.query<{provider_session_id:string}>('SELECT provider_session_id FROM top_up_payments WHERE id=$1 UNION ALL SELECT provider_session_id FROM steam_refill_payments WHERE id=$1',[id])).rows[0];if(!row)throw new Error('payment missing');const payload={eventId,type:'payment.captured',checkoutSessionId:row.provider_session_id,status:'captured',amount,currency:'RUB'};return http().post('/payments/webhooks/arco-pay').set('webhook-id',eventId).set('x-arco-pay-signature',valid?createHmac('sha256',secret).update(stable(payload)).digest('hex'):'invalid').send(payload);}
 return {pool,provider,known,config,http,identity,catalog,captured,get app(){return app;},async restart(){await app.close();await start();},async close(){await app.close();await pool.end();await rm(directory,{recursive:true,force:true});delete process.env.DATABASE_URL;},key:()=>randomUUID()};
}
export type CommerceFixture=Awaited<ReturnType<typeof commerceFixture>>;
export type FixtureIdentity=Awaited<ReturnType<CommerceFixture['identity']>>;
