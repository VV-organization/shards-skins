import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('VV-162 versioned markup',()=>{
 let pool:Pool;
 beforeAll(()=>{pool=new Pool({connectionString:databaseUrl});});
 afterAll(async()=>{await pool.end();});
 it('uses twenty percent for new prices and retains the historical setting',async()=>{
  const active=await pool.query('SELECT * FROM pricing_settings WHERE scope=$1 AND superseded_at IS NULL',['sih-skins']);
  expect(active.rows).toHaveLength(1);expect(active.rows[0]).toMatchObject({markup_bps:2000,coin_rate_numerator:8,coin_rate_denominator:5,metadata:{fxVerified:false}});
  const old=await pool.query<{markup_bps:number;superseded_at:Date|null}>("SELECT markup_bps,superseded_at FROM pricing_settings WHERE id='pricing-shards-v1'");expect(old.rows[0]?.markup_bps).toBe(2500);expect(old.rows[0]?.superseded_at).not.toBeNull();
 });
 it('preserves verified FX and pricing parameters when upgrading an existing deployment',async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query("DELETE FROM pricing_settings WHERE id='pricing-shards-vv162-v1'");
   await client.query("UPDATE pricing_settings SET superseded_at=NULL,supplier_to_fiat_rate_minor=12345,min_price_coin_minor=17,round_to_coin_minor=7,metadata=metadata||'{\"fxVerified\":true}'::jsonb WHERE id='pricing-shards-v1'");
   await client.query(readFileSync('drizzle/migrations/0036_vv162_markup.sql','utf8'));
   const rows=await client.query("SELECT * FROM pricing_settings WHERE scope='sih-skins' AND superseded_at IS NULL");
   expect(rows.rows).toHaveLength(1);expect(rows.rows[0]).toMatchObject({markup_bps:2000,supplier_to_fiat_rate_minor:12345,min_price_coin_minor:17,round_to_coin_minor:7,metadata:{fxVerified:true}});
  }finally{await client.query('ROLLBACK');client.release();}
 });
});
