import test from 'node:test';
import assert from 'node:assert/strict';
import {duoQuote,mergeCartIds} from '../src/lib/duo.ts';
test('duo rounds once on total and shows exact remaining budget',()=>{assert.deepEqual(duoQuote([101,102],'1,27'),{shards:203,rub:127,budget:127,remaining:0,withinBudget:true});});
test('duo rejects invalid budget and shows overspend instead of discount',()=>{assert.equal(duoQuote([100,200],'1' ).remaining,-88);assert.equal(duoQuote([100,200],'1').withinBudget,false);assert.equal(duoQuote([100,200],'abc').budget,null);});
test('bundle preserves existing items, deduplicates and removes stale ids',()=>{assert.deepEqual(mergeCartIds(['a','a','stale'],['a','b','b'],['a','b','c']),['a','b']);});
