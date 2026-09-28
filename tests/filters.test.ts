import {test} from "node:test";
import assert from "node:assert/strict";
import {emptyFilters,filterProducts,invalidPriceRange} from "../src/lib/filters.ts";
import type {Product} from "../src/lib/types.ts";
const products=[{id:"a",name:"AK-47 X-Ray",weapon:"AK-47",description:"Винтовка",categoryId:"rifle",condition:"Немного поношенное",priceMinor:100050,stattrak:false,float:.08},{id:"b",name:"Karambit Fade",weapon:"Karambit",description:"Нож",categoryId:"knife",condition:"Прямо с завода",priceMinor:200000,stattrak:true,float:.01}] as Product[];
test("localized price limits and reversed range",()=>{assert.deepEqual(filterProducts(products,{...emptyFilters,min:"1 000,50",max:"1 500"}).map(p=>p.id),["a"]);assert.equal(invalidPriceRange("10,5","2,5"),true);assert.equal(invalidPriceRange("","oops"),true);assert.equal(invalidPriceRange("0",""),false);});
test("category, query, condition and StatTrak combine; sorting does not mutate source",()=>{assert.deepEqual(filterProducts(products,{...emptyFilters,category:"knife",query:"fade",condition:"FN",stattrak:true}).map(p=>p.id),["b"]);assert.deepEqual(filterProducts(products,{...emptyFilters,sort:"price-desc"}).map(p=>p.id),["b","a"]);assert.equal(products[0].id,"a");assert.equal(filterProducts(products,{...emptyFilters,query:"no-such-skin"}).length,0);});
