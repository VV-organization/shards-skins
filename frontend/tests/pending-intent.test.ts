import test from 'node:test';
import assert from 'node:assert/strict';
import { readPendingIntent, savePendingIntent, clearPendingIntent, revisionsMatch } from '../src/lib/pending-intent.ts';
const storage = () => { const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}}; };
test('intent is tab-local, expires in fifteen minutes and preserves only display revisions',()=>{
  const store=storage();
  savePendingIntent(store,{kind:'item',slugs:['knife'],displayedRevisions:[{slug:'knife',priceRevision:'v1'}]},1000);
  const intent=readPendingIntent(store,1001);
  assert.equal(intent?.returnTo,'/cart');
  assert.equal(revisionsMatch(intent!,[{slug:'knife',priceRevision:'v2'}]),false);
  assert.equal(revisionsMatch(intent!,[{slug:'knife',priceRevision:'v1'}]),true);
  assert.equal(readPendingIntent(store,901001),null);
});
test('logout clears intent and malformed or foreign return paths never resume',()=>{
  const store=storage();savePendingIntent(store,{kind:'item',slugs:['one'],displayedRevisions:[]},1000);
  clearPendingIntent(store);assert.equal(readPendingIntent(store,1001),null);
  store.setItem('shards:pending-intent',JSON.stringify({kind:'item',slugs:['one'],createdAt:1000,returnTo:'https://evil.test'}));
  assert.equal(readPendingIntent(store,1001),null);
});
