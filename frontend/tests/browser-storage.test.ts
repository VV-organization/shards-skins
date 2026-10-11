import test from 'node:test';
import assert from 'node:assert/strict';
import {createSafeStorage} from '../src/lib/browser-storage.ts';
test('failed write overrides readable stale storage for the current session',()=>{const disk=new Map([['cart','["a"]']]);const store=createSafeStorage(()=>({getItem:k=>disk.get(k)??null,setItem:()=>{throw new Error('QuotaExceededError');}}));store.write('cart','["a","b"]');assert.equal(store.read('cart','[]'),'["a","b"]');});
test('cross-tab event clears fallback so external update is observed',()=>{const disk=new Map([['cart','["a"]']]);const store=createSafeStorage(()=>({getItem:k=>disk.get(k)??null,setItem:()=>{throw new Error('QuotaExceededError');}}));store.write('cart','["b"]');disk.set('cart','["c"]');store.invalidate('cart');assert.equal(store.read('cart','[]'),'["c"]');});
