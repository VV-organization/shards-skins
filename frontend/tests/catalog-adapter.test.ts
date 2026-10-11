import test from 'node:test';
import assert from 'node:assert/strict';
import {mapProduct} from '../src/lib/catalog-adapter.ts';
import {presentationProducts} from '../src/lib/presentation.ts';
test('missing curated SKU keeps its visual slot without becoming purchasable',()=>{
 const items=presentationProducts(['swap-0a7a560b8522'],[]);
 assert.equal(items.length,1);assert.equal(items[0].availability,'unavailable');assert.equal(items[0].priceMinor,0);assert.ok(items[0].imageUrl.startsWith('/catalog/'));
});
test('catalog mapping uses authoritative identity, revision and wear and has a safe missing-image fallback',()=>{
 const dto={id:'backend-id',kind:'skins',category:'Скины',productType:'Автомат',createdAt:'2026-10-11T00:00:00Z',popularity:1,fulfillmentMode:'steam-trade',keywords:[],details:{specifications:[],fulfillment:{title:'Steam',description:'Trade',requirements:[]}},slug:'real-sku',title:'AK-47 | Redline',description:'Skin',categoryId:'rifle',condition:'FT',weapon:'AK-47',stattrak:false,marketHashName:'AK-47 | Redline (Field-Tested)',priceRevision:'r2',pricingSettingId:'p1',price:{currency:"COINS",scale:2,display:"123,45 Shards",amountMinor:12345},availability:'unavailable',meta:[]} as Parameters<typeof mapProduct>[0];
 const product=mapProduct(dto);
 assert.equal(product.id,'real-sku');assert.equal(product.priceMinor,12345);assert.equal(product.condition,'После полевых испытаний');assert.equal(product.availability,'unavailable');assert.equal(product.priceRevision,'r2');assert.ok(product.imageUrl);assert.equal('float' in product,false);
});
