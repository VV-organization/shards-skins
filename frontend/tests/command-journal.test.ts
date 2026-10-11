import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandJournal} from '../src/lib/command-journal.ts';
const memory=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};};
test('reload preserves the original request and key after a lost response',()=>{
 const storage=memory();const first=new CommandJournal(()=>storage).begin('alice','add:knife','PUT','/cart/items/knife',{expectedCartVersion:0});
 const retry=new CommandJournal(()=>storage).begin('alice','add:knife','PUT','/cart/items/knife',{expectedCartVersion:1});
 assert.deepEqual(retry,first);
});
test('different owners never share commands; completed commands can be started again',()=>{
 const storage=memory();const journal=new CommandJournal(()=>storage);
 const a=journal.begin('alice','add:knife','PUT','/cart/items/knife',{});
 assert.notEqual(journal.begin('bob','add:knife','PUT','/cart/items/knife',{}).key,a.key);
 journal.complete('alice','add:knife');assert.notEqual(journal.begin('alice','add:knife','PUT','/cart/items/knife',{}).key,a.key);
 journal.clear('alice');assert.notEqual(journal.begin('alice','add:knife','PUT','/cart/items/knife',{}).key,a.key);
});
