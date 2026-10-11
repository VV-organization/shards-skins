import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { AppModule } from '../../app.module';
import { CartService } from './cart.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('versioned Shards cart',()=>{
 let app:INestApplication;let pool:Pool;let cart:CartService;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication();await app.init();cart=app.get(CartService);
  await pool.query(`INSERT INTO users(id,steam_id64) VALUES ('cart-owner','76561198000000210')`);
  const run=await pool.query<{id:string}>("INSERT INTO catalog_sync_runs(source,game,status,observed_at,finished_at,row_count) VALUES ('sih','cs2','promoted',now(),now(),51) RETURNING id");
  for(let i=0;i<51;i++){
   await pool.query(`INSERT INTO supplier_listings(supplier,game,market_hash_name,active,available_quantity,price_microusd,last_seen_at,first_seen_at,last_sync_run_id) VALUES ('sih','cs2',$1,true,5,1000000,now(),now(),$2)`,[`cart-fixture-${i}`,run.rows[0]?.id]);
   await pool.query(`INSERT INTO catalog_products(id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,supplier_provider,supplier_item_id,public_enabled,category_id,ever_published) VALUES ($1,$1,'skins','Скины','cs2','Нож',$1,'fixture',100,'available','steam-trade',1,'{}','{}','{"specifications":[],"fulfillment":{"title":"Steam","description":"Trade","requirements":[]}}','sih',$1,true,'knife',true)`,[`cart-fixture-${i}`]);
  }
 });
 afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
 beforeEach(async()=>{await pool.query('TRUNCATE cart_items,carts,cart_commands');});
 const add=(slug:string,version:number,key:string)=>cart.setItem({userId:'cart-owner',productSlug:slug,quantity:1,expectedCartVersion:version,idempotencyKey:key});
 it('does not duplicate a SKU and replays the exact successful command before version checks',async()=>{
  const first=await add('cart-fixture-0',0,'cart-command-first');expect(first.version).toBe(1);expect(first.items).toHaveLength(1);
  expect(await add('cart-fixture-0',0,'cart-command-first')).toEqual(first);
  const duplicate=await add('cart-fixture-0',1,'cart-command-duplicate');expect(duplicate.version).toBe(1);expect(duplicate.items).toHaveLength(1);
  await expect(add('cart-fixture-1',0,'cart-command-first')).rejects.toMatchObject({status:409});
 });
 it('serializes concurrent mutations at the same version',async()=>{
  const results=await Promise.allSettled([add('cart-fixture-0',0,'cart-race-one'),add('cart-fixture-1',0,'cart-race-two')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect((await cart.getCart('cart-owner')).items).toHaveLength(1);
 });
 it('retains the snapshot of a physically removed SKU and allows its removal',async()=>{
  await add('cart-fixture-50',0,'cart-gone-add');await pool.query("DELETE FROM catalog_products WHERE slug='cart-fixture-50'");
  const result=await cart.getCart('cart-owner');expect(result.items[0]?.availability).toBe('unavailable');expect(result.items[0]?.title).toBe('cart-fixture-50');expect(result.canCheckout).toBe(false);
  expect((await cart.removeItem({userId:'cart-owner',productSlug:'cart-fixture-50',expectedCartVersion:1,idempotencyKey:'cart-gone-remove'})).items).toEqual([]);
 });
 it('rejects the 51st distinct item atomically',async()=>{
  for(let i=0;i<50;i++)await add(`cart-fixture-${i}`,i,`cart-limit-${i}`);
  // The missing SKU test removed number 50; reuse an existing row under a new stable test slug.
  await pool.query(`INSERT INTO catalog_products SELECT (jsonb_populate_record(NULL::catalog_products,to_jsonb(p)||'{"id":"cart-extra","slug":"cart-extra"}'::jsonb)).* FROM catalog_products p WHERE slug='cart-fixture-0'`);
  await expect(add('cart-extra',50,'cart-limit-extra')).rejects.toMatchObject({status:400});
  expect((await cart.getCart('cart-owner')).items).toHaveLength(50);
 });
 it('changes the version when an equally priced SKU replaces another',async()=>{
  await add('cart-fixture-0',0,'cart-replace-first');await cart.removeItem({userId:'cart-owner',productSlug:'cart-fixture-0',expectedCartVersion:1,idempotencyKey:'cart-replace-remove'});
  const next=await add('cart-fixture-1',2,'cart-replace-second');expect(next.version).toBe(3);expect(next.items[0]?.productSlug).toBe('cart-fixture-1');
 });
});
