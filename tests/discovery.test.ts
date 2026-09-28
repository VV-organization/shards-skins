import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {filterDiscovery, curatedColors} from "../src/lib/discovery.ts";
import type {Product} from "../src/lib/types.ts";

const products = [
  {id:"baron-2543db74-1727-4fe4-b923-decbc9dd9d1e", name:"Desert Eagle | Механо-пушка", priceMinor:28472},
  {id:"baron-9329f0e9-76fc-4ae9-947e-d4b6d9e405c4", name:"FAMAS | Авария", priceMinor:167481},
  {id:"swap-35d1bd8ccb42", name:"M9 Bayonet | Tiger Tooth", priceMinor:346371},
  {id:"swap-0a7a560b8522", name:"P250 | Undertow", priceMinor:339112},
  {id:"baron-1a5f3d48-c150-4cf6-ad3a-9e5916c737c3", name:"USP-S | Printstream", priceMinor:167414},
  {id:"unmarked", name:"Other", priceMinor:100},
] as Product[];

test("curated color groups use explicit catalog IDs", () => {
  assert.ok(curatedColors.orange.some(id=>id===products[0].id));
  assert.ok(curatedColors.blue.some(id=>id===products[3].id));
  assert.ok(curatedColors.mono.some(id=>id===products[4].id));
  assert.equal(Object.values(curatedColors).some(ids=>ids.some(id=>String(id)==="unmarked")), false);
  const catalog=JSON.parse(readFileSync(new URL("../src/data/catalog.json",import.meta.url),"utf8")) as {products:Product[]};
  const catalogIds=new Set(catalog.products.map(product=>product.id));
  for(const ids of Object.values(curatedColors)) for(const id of ids) assert.ok(catalogIds.has(id),`Missing catalog item: ${id}`);
});

test("RUB budget uses the existing PRISM conversion on minor units", () => {
  const result=filterDiscovery(products,"orange","3 000");
  assert.deepEqual(result.items.map(p=>p.id),[products[0].id,products[1].id]);
  assert.equal(result.count,2);
  assert.equal(result.invalidBudget,false);
});

test("count includes every matching item while cards stop at three", () => {
  const extra=[...products,...["swap-ba19f94fd9cd","baron-278fde16-087b-4014-9ca3-3517bff94bce"].map((id,i)=>({id,name:`Extra ${i}`,priceMinor:300000} as Product))];
  const result=filterDiscovery(extra,"orange","");
  assert.equal(result.count,5);
  assert.equal(result.items.length,3);
});

test("invalid budget and unavailable curated products have clear empty results", () => {
  assert.deepEqual(filterDiscovery(products,"blue","abc"),{count:0,items:[],invalidBudget:true});
  assert.deepEqual(filterDiscovery([],"mono",""),{count:0,items:[],invalidBudget:false});
});
