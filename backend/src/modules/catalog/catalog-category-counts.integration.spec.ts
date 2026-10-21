import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {CatalogService} from './catalog.service';

const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('catalog category counts',()=>{
 let pool:Pool;
 beforeAll(()=>{pool=new Pool({connectionString:databaseUrl});});
 afterAll(async()=>{await pool.end();});
 it('counts all matching categories before pagination while preserving every non-category filter',async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const rows=[
    ['knife',500,'FN',true,'AK-47',true,'needle'],
    ['knife',600,'FN',true,'AK-47',true,'needle'],
    ['rifle',700,'FN',true,'AK-47',true,'needle'],
    ['other',800,'FN',true,'AK-47',true,'needle'],
    [null,800,'FN',true,'AK-47',true,'needle'],
    ['knife',100,'FN',true,'AK-47',true,'needle'],
    ['knife',900,'FN',true,'AK-47',true,'needle'],
    ['knife',500,'MW',true,'AK-47',true,'needle'],
    ['knife',500,'FN',false,'AK-47',true,'needle'],
    ['knife',500,'FN',true,'AWP',true,'needle'],
    ['knife',500,'FN',true,'AK-47',false,'needle'],
    ['knife',500,'FN',true,'AK-47',true,'different'],
   ];
   for(const [index,row] of rows.entries()){
    await client.query(`INSERT INTO catalog_products
     (id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,category_id,condition_code,stattrak,weapon,public_enabled)
     VALUES ($1,$1,'skins','Skins','cs2','test-type',$2,'', $3,'unavailable','steam-trade',1,'{}','{}','{"specifications":[],"fulfillment":{"title":"","description":"","requirements":[]}}',$4,$5,$6,$7,$8)`,
     [`vv163-count-${index}`,`vv163-count ${row[6]}`,row[1],row[0],row[2],row[3],row[4],row[5]]);
   }
   const service=new CatalogService(client as never);
   const filters={q:'vv163-count needle',categoryId:'knife',condition:'FN',stattrak:'true',weapon:'AK-47',min:'4',max:'8',type:'test-type',game:'cs2',limit:'1',offset:'1'};
   const page=await service.list(filters);
   expect(page.items).toHaveLength(1);
   expect(page.categoryCounts).toEqual({all:5,byCategory:{knife:2,rifle:1,other:2}});
   expect(page.pagination).toEqual({total:2,limit:1,offset:1,hasMore:false});
   const all=await service.list({...filters,categoryId:'',offset:'0'});
   expect(all.categoryCounts).toEqual(page.categoryCounts);
   expect(all.pagination.total).toBe(5);
   expect((await service.list({...filters,categoryId:'other'})).pagination.total).toBe(2);
   // Supplier repricing must affect both the list and the grouped counts.
   await client.query("UPDATE pricing_settings SET supplier_to_fiat_rate_minor=100,coin_rate_numerator=1,coin_rate_denominator=1,markup_bps=0,min_price_coin_minor=1,round_to_coin_minor=1 WHERE scope='sih-skins' AND superseded_at IS NULL");
   const sync=await client.query<{id:string}>("INSERT INTO catalog_sync_runs(source,game,status,observed_at,row_count) VALUES ('sih','cs2','promoted',now(),1) RETURNING id");
   await client.query("INSERT INTO supplier_listings(supplier,game,market_hash_name,available_quantity,price_microusd,last_sync_run_id) VALUES ('sih','cs2','vv163-price',1,1000000,$1)",[sync.rows[0]?.id]);
   await client.query("UPDATE catalog_products SET supplier_provider='sih',supplier_item_id='vv163-price' WHERE id='vv163-count-0'");
   const repriced=await service.list(filters);
   expect(repriced.categoryCounts).toEqual({all:4,byCategory:{knife:1,rifle:1,other:2}});
   expect(repriced.pagination.total).toBe(1);
   await client.query("UPDATE catalog_products SET supplier_provider=NULL,supplier_item_id=NULL WHERE id='vv163-count-0'");
   const emptyCategory=await service.list({...filters,categoryId:'gloves'});
   expect(emptyCategory.items).toEqual([]);
   expect(emptyCategory.pagination.total).toBe(0);
   expect(emptyCategory.categoryCounts).toEqual(page.categoryCounts);
   expect((await service.list({...filters,q:'no-vv163-count-match'})).categoryCounts).toEqual({all:0,byCategory:{}});
  }finally{await client.query('ROLLBACK');client.release();}
 });
});
