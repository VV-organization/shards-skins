import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {AppModule} from '../../app.module';
import {APP_CONFIG} from '../../config/app-config.module';
import {loadAppConfig} from '../../config/app-config';
import {DatabaseService} from '../../common/database/database.service';
import {UsersService} from '../users/users.service';
import {WalletService} from '../wallet/wallet.service';
import {SihClient} from '../providers/sih/sih.client';
import type {SihSkinOrder} from '../providers/sih/sih.types';
import {FulfillmentOperationService} from './fulfillment-operation.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('recoverable fulfillment operations',()=>{
 let app:INestApplication,pool:Pool,engine:FulfillmentOperationService,wallet:WalletService;
 const userId='fulfillment-owner',steamId='76561198000000610';
 const provider={getMinimumItem:vi.fn(),createSkinOrder:vi.fn(),getSkinOrder:vi.fn(),paySteamRefill:vi.fn(),checkSteamAccount:vi.fn()};
 const orderResult=(customId:string,name:string,status:SihSkinOrder['status']='finished'):SihSkinOrder=>({customId,marketHashName:name,status,steamId64:steamId,amountMicrousd:1000000n,expectedAmountMicrousd:1000000n,offerId:null,projection:'order',providerOrderId:`provider-${customId}`,protection:null});
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});
  app=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(loadAppConfig({DATABASE_URL:databaseUrl,SHARDS_FULFILLMENT_ENABLED:'true'})).overrideProvider(SihClient).useValue(provider).compile()).createNestApplication();await app.init();engine=app.get(FulfillmentOperationService);wallet=app.get(WalletService);
  await pool.query('INSERT INTO users(id,steam_id64) VALUES ($1,$2)',[userId,steamId]);await app.get(UsersService).saveSteamTradeCredential(userId,{partner:String(BigInt(steamId)-76561197960265728n),token:'originalTradeToken'});
 });
 afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
 beforeEach(async()=>{
  vi.resetAllMocks();await app.get(UsersService).saveSteamTradeCredential(userId,{partner:String(BigInt(steamId)-76561197960265728n),token:'originalTradeToken'});await pool.query('TRUNCATE orders,order_lines,fulfillment_commands,fulfillment_provider_attempts,wallet_holds,wallet_ledger_entries,wallet_transactions,vv_admin_integration_outbox,notification_outbox');
  await wallet.creditUser({userId,amountCoinMinor:100000,idempotencyKey:'credit',reason:'test'});
  provider.getMinimumItem.mockImplementation(({marketHashName}:{marketHashName:string})=>Promise.resolve({marketHashName,game:'cs2',availableQuantity:1,priceMicrousd:1000000n,imageUrl:null}));
  provider.createSkinOrder.mockImplementation(({customId,marketHashName}:{customId:string;marketHashName:string})=>Promise.resolve(orderResult(customId,marketHashName)));
 });
 async function seed(kind='skins'){
  const orderId=randomUUID(),total=kind==='skins'?30000:0;
  await pool.query("INSERT INTO orders(id,user_id,idempotency_key,request_hash,status,total_coin_minor,recipient_snapshots) VALUES ($1::uuid,$2,$1::text,'fixture','held',$3,'[]')",[orderId,userId,total]);
  const credential=await pool.query<{partner_account_id:string;ciphertext:string;nonce:string;auth_tag:string}>('SELECT * FROM steam_trade_credentials WHERE user_id=$1',[userId]);const c=credential.rows[0];if(!c)throw new Error("credential missing");
  const ids:string[]=[];
  for(let i=0;i<(kind==='skins'?2:1);i++){
   const id=randomUUID(),operation=randomUUID(),name=`fixture-${i}`,amount=(i+1)*10000;ids.push(id);
   const recipient={kind:kind==='skins'?'steam-trade':'steam-refill',steamId64:steamId,steamLogin:'receiver'};
   const payload=kind==='skins'?{schemaVersion:1,game:'cs2',marketHashName:name,supplierCostCapMicrousd:'1000000',recipientSnapshot:recipient,recipientCredential:{partner:c.partner_account_id,ciphertext:c.ciphertext,nonce:c.nonce,authTag:c.auth_tag},providerOperationId:operation}:{steamCheckTransactionId:'original-steam-transaction',amountRub:50,steamLogin:'receiver',recipientSnapshot:recipient};
   await pool.query("INSERT INTO order_lines(id,order_id,line_index,product_id,product_slug,kind,title,unit_price_coin_minor,quantity,recipient_snapshot,status,commerce_snapshot) VALUES ($1,$2,$3,$4,$4,$5,$4,$6,1,$7::jsonb,'held',$8::jsonb)",[id,orderId,i,name,kind,kind==='skins'?amount:0,JSON.stringify(recipient),JSON.stringify(payload)]);
   await pool.query("INSERT INTO fulfillment_commands(order_id,order_line_id,provider,command_type,idempotency_key,payload_snapshot,provider_operation_id) VALUES ($1,$2::uuid,'sih',$3,$2::text,$4::jsonb,$5)",[orderId,id,kind==='skins'?'sih_skin_purchase':'sih_steam_refill',JSON.stringify(payload),operation]);
  }
  if(total)await app.get(DatabaseService).transaction(async client=>{await wallet.lockUserBalance(client,userId);await wallet.createHold(client,{userId,orderId,amountCoinMinor:total,reason:'test'});});
  return {orderId,ids};
 }
 it('looks up an accepted-but-timed-out create by the original operation ID',async()=>{
  await seed();provider.createSkinOrder.mockRejectedValueOnce(new Error('connection lost'));
  const result=await engine.submitNext(false);expect(result.status).toBe('submitted');const operation=provider.createSkinOrder.mock.calls[0]?.[0] as {customId:string;marketHashName:string};
  provider.getSkinOrder.mockResolvedValueOnce(orderResult(operation.customId,operation.marketHashName));await pool.query('UPDATE fulfillment_commands SET available_at=now()');await engine.reconcileNext();
  expect(provider.getSkinOrder).toHaveBeenCalledWith({customId:operation.customId});expect(provider.createSkinOrder).toHaveBeenCalledTimes(1);expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(30000);
 });
 it('fences a stale worker and recovers both sides of the dispatch boundary',async()=>{
  await seed();const lease=await engine.claim('submit');if(!lease)throw new Error('lease missing');
  await pool.query("UPDATE fulfillment_commands SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[lease.id]);await engine.recoverExpired(10);await pool.query("UPDATE fulfillment_commands SET available_at=now()+interval '1 hour' WHERE id<>$1",[lease.id]);
  expect((await engine.complete(lease,{kind:'finished'})).status).toBe('stale');
  const again=await engine.claim('submit');if(!again)throw new Error('lease missing');expect(again.providerOperationId).toBe(lease.providerOperationId);
  await pool.query("UPDATE fulfillment_commands SET dispatched_at=now(),lease_expires_at=now()-interval '1 second' WHERE id=$1",[again.id]);await engine.recoverExpired(10);
  const recovered=await engine.claim('reconcile');expect(recovered?.providerOperationId).toBe(lease.providerOperationId);expect(recovered?.leaseToken).not.toBe(again.leaseToken);
 });
 it.each([[true,true,30000,'fulfilled'],[true,false,10000,'partially_fulfilled'],[false,false,0,'failed']] as const)('settles simultaneous sibling results %s/%s exactly once',async(first,second,capture,status)=>{
  const {orderId}=await seed();const a=await engine.claim('submit'),b=await engine.claim('submit');if(!a||!b)throw new Error('leases missing');
  await Promise.all([engine.complete(a,{kind:first?'finished':'failed'}),engine.complete(b,{kind:second?'finished':'failed'})]);
  expect((await wallet.getBalance(userId))).toEqual({postedCoinMinor:100000-capture,heldCoinMinor:0,availableCoinMinor:100000-capture});
  expect((await pool.query<{status:string}>('SELECT status FROM orders WHERE id=$1',[orderId])).rows[0]?.status).toBe(status);
  await engine.complete(a,{kind:'finished'});await engine.settleTerminalHolds(10);expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(100000-capture);
  const events=await pool.query<{payload:{data:{fulfillmentStatus:string;capturedAmount:string;payment:{status:string}}}}>("SELECT payload FROM vv_admin_integration_outbox WHERE subject_external_id=$1",[orderId]);expect(events.rows).toHaveLength(1);expect(events.rows[0]?.payload.data.fulfillmentStatus).toBe(status);expect(events.rows[0]?.payload.data.capturedAmount).toBe((capture/100).toFixed(2));expect(events.rows[0]?.payload.data.payment.status).toBe(capture?'paid':'failed');
 });
 it('fails missing stock explicitly and never creates at a higher supplier cost',async()=>{
  await seed();provider.getMinimumItem.mockResolvedValueOnce(null).mockResolvedValueOnce({availableQuantity:1,priceMicrousd:2000000n});
  await engine.submitNext(false);await engine.submitNext(false);expect(provider.createSkinOrder).not.toHaveBeenCalled();expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(0);
 });
 it('holds pending protection and keeps unknown or failed protection in review',async()=>{
  await seed();provider.createSkinOrder.mockImplementation(({customId,marketHashName}:{customId:string;marketHashName:string})=>Promise.resolve({...orderResult(customId,marketHashName),protection:{status:'processing',error:null,rollbackAmountMicrousd:null,rollbackAt:null}}));
  await engine.submitNext(false);expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(30000);
  const op=provider.createSkinOrder.mock.calls[0]?.[0] as {customId:string;marketHashName:string};provider.getSkinOrder.mockResolvedValueOnce({...orderResult(op.customId,op.marketHashName),protection:{status:'failed',error:'rollback supplier',rollbackAmountMicrousd:1000000n,rollbackAt:new Date()}});
  await pool.query('UPDATE fulfillment_commands SET available_at=now()');expect((await engine.reconcileNext()).status).toBe('manual_review');expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(30000);
 });
 it('uses the encrypted recipient snapshot even after the user changes their trade URL',async()=>{
  await seed();await app.get(UsersService).saveSteamTradeCredential(userId,{partner:String(BigInt(steamId)-76561197960265728n),token:'changedTradeToken'});await engine.submitNext(false);expect(provider.createSkinOrder.mock.calls[0]?.[0]).toMatchObject({tradeToken:'originalTradeToken',amountMicrousd:1000000n});
 });
 it('sweeps terminal orphan holds idempotently and leaves unknown lines reserved',async()=>{
  const {orderId}=await seed();expect(await engine.settleTerminalHolds(10)).toBe(0);expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(30000);
  await pool.query("UPDATE order_lines SET status=CASE WHEN line_index=0 THEN 'supplier_finished' ELSE 'supplier_failed' END WHERE order_id=$1",[orderId]);expect(await engine.settleTerminalHolds(10)).toBe(1);expect(await engine.settleTerminalHolds(10)).toBe(0);expect((await wallet.getBalance(userId)).availableCoinMinor).toBe(90000);
 });
 it('never restarts a Steam check/pay chain after an unknown pay result',async()=>{
  await seed('steam');provider.paySteamRefill.mockRejectedValueOnce(new Error('timeout'));
  expect((await engine.submitNext(false)).status).toBe('manual_review');await engine.reconcileNext();await engine.submitNext(false);
  expect(provider.checkSteamAccount).not.toHaveBeenCalled();expect(provider.paySteamRefill).toHaveBeenCalledTimes(1);expect(provider.paySteamRefill).toHaveBeenCalledWith({amountRub:50,steamUsername:'receiver',transactionId:'original-steam-transaction'});expect((await wallet.getBalance(userId)).postedCoinMinor).toBe(100000);
 });
});
