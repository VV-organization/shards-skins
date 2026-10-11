import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import request from 'supertest';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {AppModule} from '../../app.module';
import {CartService} from '../cart/cart.service';
import {QuotesService} from '../quotes/quotes.service';
import {DuoService} from './duo.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('atomic quoted duo',()=>{
 let app:INestApplication,pool:Pool,duo:DuoService,cart:CartService;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication();await app.init();duo=app.get(DuoService);cart=app.get(CartService);
  await pool.query("INSERT INTO users(id,steam_id64) VALUES ('duo-owner','76561198000000310')");
  const run=await pool.query<{id:string}>("INSERT INTO catalog_sync_runs(source,game,status,observed_at,finished_at,row_count) VALUES ('sih','cs2','promoted',now(),now(),63) RETURNING id");
  for(let i=0;i<63;i++){
   const slug=`duo-${String(i).padStart(3,'0')}`;
   await pool.query(`INSERT INTO supplier_listings(supplier,game,market_hash_name,active,available_quantity,price_microusd,last_seen_at,last_sync_run_id) VALUES ('sih','cs2',$1,true,5,1000000,now(),$2)`,[slug,run.rows[0]?.id]);
   await pool.query(`INSERT INTO catalog_products(id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,supplier_provider,supplier_item_id,public_enabled,category_id,ever_published) VALUES ($1,$1,'skins','Скины','cs2','Нож',$1,'fixture',100,'available','steam-trade',1,'{}','{}','{"specifications":[],"fulfillment":{"title":"Steam","description":"Trade","requirements":[]}}','sih',$1,true,$2,true)`,[slug,i===62?'gloves':'knife']);
  }
 });
 afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
 beforeEach(async()=>{vi.restoreAllMocks();await pool.query('TRUNCATE cart_items,carts,cart_commands,commerce_quotes');await pool.query("UPDATE supplier_listings SET active=true,price_microusd=1000000,last_seen_at=now()");});
 const quote=()=>duo.quotePair({knifeSlug:'duo-000',gloveSlug:'duo-062',budgetRubMinor:2500000});
 const add=(quoteId:string,expectedCartVersion=0,idempotencyKey='duo-add')=>duo.addPair({userId:'duo-owner',quoteId,expectedCartVersion,idempotencyKey});
 it('rejects a client-supplied price instead of treating it as authoritative',async()=>{
  await request(app.getHttpServer() as Parameters<typeof request>[0]).post('/duo/quotes').send({knifeSlug:'duo-000',gloveSlug:'duo-062',budgetRubMinor:2500000,totalCoinMinor:1}).expect(400);
 });
 it('adds only the missing member and replays after quote expiry',async()=>{
  await cart.setItem({userId:'duo-owner',productSlug:'duo-000',quantity:1,expectedCartVersion:0,idempotencyKey:'knife-first'});
  const q=await quote(),result=await add(q.id,1);expect(result.items).toHaveLength(2);expect(result.version).toBe(2);
  await pool.query("UPDATE commerce_quotes SET expires_at=now()-interval '1 minute'");
  expect(await add(q.id,1)).toEqual(result);
  await expect(add(q.id,2,'different-key')).rejects.toMatchObject({status:409});
 });
 it('rejects wrong slot, repeated slug and unavailable second member',async()=>{
  await expect(duo.quotePair({knifeSlug:'duo-000',gloveSlug:'duo-001',budgetRubMinor:2500000})).rejects.toMatchObject({status:400});
  await expect(duo.quotePair({knifeSlug:'duo-000',gloveSlug:'duo-000',budgetRubMinor:2500000})).rejects.toMatchObject({status:400});
  const q=await quote();await pool.query("UPDATE supplier_listings SET active=false WHERE market_hash_name='duo-062'");
  await expect(add(q.id)).rejects.toMatchObject({status:409});expect((await cart.getCart('duo-owner')).items).toHaveLength(0);
 });
 it('rejects changed price and expired quotes without partial insertion',async()=>{
  const q=await quote();await pool.query("UPDATE supplier_listings SET price_microusd=2000000 WHERE market_hash_name='duo-062'");
  await expect(add(q.id)).rejects.toMatchObject({status:409});
  const fresh=await quote();await pool.query("UPDATE commerce_quotes SET expires_at=now()-interval '1 second'");
  await expect(add(fresh.id)).rejects.toMatchObject({status:409});expect((await cart.getCart('duo-owner')).version).toBe(0);
 });
 it('rolls back all inserts and quote consumption on a late failure',async()=>{
  const q=await quote();vi.spyOn(app.get(QuotesService),'consume').mockRejectedValueOnce(new Error('injected late failure'));
  await expect(add(q.id)).rejects.toThrow('injected late failure');expect((await cart.getCart('duo-owner')).items).toHaveLength(0);
  expect((await add(q.id)).items).toHaveLength(2);
 });
 it('never exceeds the unique-SKU limit with a pair',async()=>{
  for(let i=0;i<50;i++)await cart.setItem({userId:'duo-owner',productSlug:`duo-${String(i).padStart(3,'0')}`,quantity:1,expectedCartVersion:i,idempotencyKey:`fill-${i}`});
  const q=await quote();await expect(add(q.id,50)).rejects.toMatchObject({status:400});expect((await cart.getCart('duo-owner')).items).toHaveLength(50);
 });
 it('rejects an over-budget quote',async()=>{
  const q=await duo.quotePair({knifeSlug:'duo-000',gloveSlug:'duo-062',budgetRubMinor:1});expect(q.withinBudget).toBe(false);await expect(add(q.id)).rejects.toMatchObject({status:400});
 });
 it('pages equal-price options by stable identity without repetition',async()=>{
  const first=await duo.listOptions('knife',undefined);expect(first.items).toHaveLength(60);expect(first.nextCursor).toBeTruthy();
  const next=await duo.listOptions('knife',first.nextCursor);expect(next.items).toHaveLength(2);expect(next.nextCursor).toBeNull();
  expect(new Set([...first.items,...next.items].map(p=>p.slug)).size).toBe(62);
 });
});
