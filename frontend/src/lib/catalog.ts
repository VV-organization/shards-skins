import {cache} from "react";
import type { Catalog, Product } from './types';
import {mapProduct,type CatalogPage,type CatalogApiProduct} from './catalog-adapter';
import {categories,presentationSlugs,presentationProducts} from './presentation';
const origin=()=>process.env.SHARDS_BACKEND_ORIGIN??'http://127.0.0.1:5199';
async function backend<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(`${origin()}${path}`,{cache:'no-store',signal:AbortSignal.timeout(5000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 if(!response.ok)throw new Error(`Catalog unavailable: ${response.status}`);return response.json() as Promise<T>;
}
export const getCatalog=cache(async ():Promise<Catalog>=>{
 try {
  const [page,curated]=await Promise.all([backend<CatalogPage>('/catalog?limit=60'),backend<{items:CatalogApiProduct[]}>('/catalog/lookup',{slugs:presentationSlugs.slice(0,50)})]);
  const products=[...new Map([...page.items,...curated.items].map(dto=>[dto.slug,mapProduct(dto)])).values()];
  return {mode:'live',products,categories,capturedAt:new Date().toISOString()};
 }catch{return {mode:'unavailable',products:[],categories,capturedAt:''};}
});
export async function getProduct(slug:string):Promise<Product|null>{
 try{return mapProduct(await backend<CatalogApiProduct>(`/catalog/${encodeURIComponent(slug)}`));}catch{return null;}
}
export const featuredIds = ['swap-0282387e3432','swap-5c3715c0960b','baron-1a5f3d48-c150-4cf6-ad3a-9e5916c737c3','swap-6aa7ec4ed3fb','swap-a360a2cd8d9d','swap-8d1c7a992820','swap-ba19f94fd9cd','swap-64ba82db6655'];
export function featuredProducts(products:Product[]){return presentationProducts(featuredIds,products);}
