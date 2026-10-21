import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {AppModule} from '../../app.module';
import {CartService} from '../cart/cart.service';
import {UsersService} from '../users/users.service';
import {WalletService} from '../wallet/wallet.service';
import {QuotesService} from '../quotes/quotes.service';
import {SihClient} from '../providers/sih/sih.client';
import {QuotedCheckoutService} from './quoted-checkout.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('quoted skin checkout',()=>{
 let app:INestApplication,pool:Pool,checkout:QuotedCheckoutService,cart:CartService,wallet:WalletService;
 const userId='checkout-quote-owner',steamId='76561198000000410';
 const provider={getMinimumItem:vi.fn(({marketHashName}:{marketHashName:string})=>Promise.resolve({marketHashName,game:'cs2',availableQuantity:5,priceMicrousd:1000000n,imageUrl:null}))};
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});
  app=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(SihClient).useValue(provider).compile()).createNestApplication();await app.init();checkout=app.get(QuotedCheckoutService);cart=app.get(CartService);wallet=app.get(WalletService);
  await pool.query('INSERT INTO users(id,steam_id64) VALUES ($1,$2)',[userId,steamId]);
  const run=await pool.query<{id:string}>("INSERT INTO catalog_sync_runs(source,game,status,observed_at,finished_at,row_count) VALUES ('sih','cs2','promoted',now(),now(),2) RETURNING id");
  for(const slug of ['checkout-knife','checkout-glove']){
   await pool.query(`INSERT INTO supplier_listings(supplier,game,market_hash_name,active,available_quantity,price_microusd,last_seen_at,last_sync_run_id) VALUES ('sih','cs2',$1,true,5,1000000,now(),$2)`,[slug,run.rows[0]?.id]);
   await pool.query(`INSERT INTO catalog_products(id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,supplier_provider,supplier_item_id,public_enabled,category_id,ever_published) VALUES ($1,$1,'skins','Скины','cs2','Нож',$1,'fixture',100,'available','steam-trade',1,'{}','{}','{"specifications":[],"fulfillment":{"title":"Steam","description":"Trade","requirements":[]}}','sih',$1,true,'knife',true)`,[slug]);
  }
 });
 afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
 beforeEach(async()=>{
  vi.restoreAllMocks();await pool.query('TRUNCATE cart_items,carts,cart_commands,commerce_quotes,orders,order_lines,fulfillment_commands,wallet_holds,wallet_ledger_entries,wallet_transactions,vv_admin_integration_outbox,notification_outbox');
  await app.get(UsersService).saveSteamTradeCredential(userId,{partner:String(BigInt(steamId)-76561197960265728n),token:'fixtureToken'});
  await wallet.creditUser({userId,amountCoinMinor:1000000,idempotencyKey:'fixture-credit',reason:'test'});
  await cart.setItem({userId,productSlug:'checkout-knife',quantity:1,expectedCartVersion:0,idempotencyKey:'cart-add'});
 });
 const quote=()=>checkout.createCheckoutQuote({userId,cartVersion:1});
 const buy=(quoteId:string,idempotencyKey='checkout-buy',cartVersion=1)=>checkout.checkoutFromServerCart({userId,quoteId,cartVersion,idempotencyKey});
 const counts=async()=>{const result=await pool.query<{orders:number;holds:number}>('SELECT (SELECT count(*)::integer FROM orders) AS orders,(SELECT count(*)::integer FROM wallet_holds) AS holds');return result.rows[0];};
 it('allows checkout despite legacy false FX approval metadata',async()=>{
  await pool.query("UPDATE pricing_settings SET metadata=metadata||'{\"fxVerified\":false}'::jsonb WHERE superseded_at IS NULL");
  try {const q=await quote();const order=await buy(q.id);expect(order.totalCoinMinor).toBe(q.totalCoinMinor);expect(await counts()).toEqual({orders:1,holds:1});}
  finally {await pool.query("UPDATE pricing_settings SET metadata=metadata-'fxVerified'");}
 });
 it('atomically persists the order, hold, immutable commands and cart cleanup; replay survives expiry',async()=>{
  const q=await quote(),order=await buy(q.id);expect(JSON.stringify(q)).not.toMatch(/ciphertext|fixtureToken|nonce/);expect(order.totalCoinMinor).toBe(q.totalCoinMinor);expect(await counts()).toEqual({orders:1,holds:1});expect((await cart.getCart(userId)).items).toHaveLength(0);
  const commands=await pool.query<{provider_operation_id:string}>('SELECT provider_operation_id FROM fulfillment_commands');expect(commands.rows[0]?.provider_operation_id).toBeTruthy();
  const snapshot=await pool.query<{commerce_snapshot:{recipientCredential:{ciphertext:string};supplierCostCapMicrousd:string}}>('SELECT commerce_snapshot FROM order_lines');expect(snapshot.rows[0]?.commerce_snapshot.supplierCostCapMicrousd).toBe('1000000');expect(snapshot.rows[0]?.commerce_snapshot.recipientCredential.ciphertext).toBeTruthy();expect(JSON.stringify(snapshot.rows)).not.toContain('fixtureToken');
  await pool.query("UPDATE commerce_quotes SET expires_at=now()-interval '1 hour'");expect(await buy(q.id)).toEqual(order);
  await expect(buy(q.id,'new-key')).rejects.toMatchObject({status:409});await expect(buy(q.id,'checkout-buy',2)).rejects.toMatchObject({status:409});
  expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(q.totalCoinMinor);
 });
 it('rejects expired quote and missing or changed recipient without a hold',async()=>{
  const q=await quote();await app.get(UsersService).saveSteamTradeCredential(userId,{partner:String(BigInt(steamId)-76561197960265728n),token:'changedToken'});
  await expect(buy(q.id)).rejects.toMatchObject({status:409});await pool.query('DELETE FROM steam_trade_credentials WHERE user_id=$1',[userId]);await expect(quote()).rejects.toMatchObject({status:400});expect(await counts()).toEqual({orders:0,holds:0});
 });
 it('rejects equal-total cart replacement and stale version',async()=>{
  const q=await quote();await cart.removeItem({userId,productSlug:'checkout-knife',expectedCartVersion:1,idempotencyKey:'remove'});await cart.setItem({userId,productSlug:'checkout-glove',quantity:1,expectedCartVersion:2,idempotencyKey:'replacement'});
  await expect(buy(q.id)).rejects.toMatchObject({status:409});expect(await counts()).toEqual({orders:0,holds:0});
 });
 it('rolls back every write on insufficient balance',async()=>{
  await pool.query('TRUNCATE wallet_ledger_entries,wallet_transactions');const q=await quote();await expect(buy(q.id)).rejects.toMatchObject({status:402});expect(await counts()).toEqual({orders:0,holds:0});expect((await cart.getCart(userId)).items).toHaveLength(1);
 });
 it('rolls back order, hold, commands and outbox on a late error',async()=>{
  const q=await quote();vi.spyOn(app.get(QuotesService),'consume').mockRejectedValueOnce(new Error('injected failure'));await expect(buy(q.id)).rejects.toThrow('injected failure');expect(await counts()).toEqual({orders:0,holds:0});expect((await cart.getCart(userId)).items).toHaveLength(1);
  expect((await pool.query('SELECT * FROM fulfillment_commands')).rowCount).toBe(0);expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(0);
 });
 it('serializes concurrent purchases without another hold',async()=>{
  const q=await quote();const results=await Promise.allSettled([buy(q.id,'race-one'),buy(q.id,'race-two')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await counts()).toEqual({orders:1,holds:1});
 });
 it('rejects local price drift and forged recipient ownership',async()=>{
  const q=await quote();await pool.query("UPDATE supplier_listings SET price_microusd=2000000 WHERE market_hash_name='checkout-knife'");await expect(buy(q.id)).rejects.toMatchObject({status:409});await pool.query("UPDATE supplier_listings SET price_microusd=1000000");
  await app.get(UsersService).saveSteamTradeCredential(userId,{partner:'123',token:'wrongOwner'});await expect(quote()).rejects.toMatchObject({status:400});expect(await counts()).toEqual({orders:0,holds:0});
 });
 it('never holds cart or wallet locks during supplier preflight',async()=>{
  provider.getMinimumItem.mockImplementationOnce(async({marketHashName})=>{
   const locks=await pool.query<{cart:boolean;wallet:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS cart,pg_try_advisory_xact_lock(hashtext($2)) AS wallet',[`cart:${userId}`,`wallet:${userId}`]);expect(locks.rows[0]).toEqual({cart:true,wallet:true});return {marketHashName,game:'cs2',availableQuantity:5,priceMicrousd:1000000n,imageUrl:null};
  });await quote();
 });
 it('expired quote has no side effects',async()=>{
  const q=await quote();await pool.query("UPDATE commerce_quotes SET expires_at=now()-interval '1 second'");await expect(buy(q.id)).rejects.toMatchObject({status:409});expect(await counts()).toEqual({orders:0,holds:0});
 });
});
