'use client';
import {useEffect,useState} from 'react';
import {api,errorMessage} from './api';
import {mapProduct,unavailableProduct,savedCatalogPage,type CategoryCounts,type CatalogPage,type CatalogApiProduct} from './catalog-adapter';
import {type Filters} from './filters';
import type {Product} from './types';
export function useCatalogPage(filters:Filters,offset:number,saved:string[]|null,owner:string|null){
 const key=JSON.stringify({filters,offset,saved,owner});
 const [result,setResult]=useState<{key:string;products:Product[];total:number;categoryCounts:CategoryCounts;hasMore:boolean;error:string}>({key:'',products:[],total:0,categoryCounts:{all:0,byCategory:{}},hasMore:false,error:''});
 useEffect(()=>{
  const controller=new AbortController();
  const query=JSON.parse(key) as {filters:Filters;offset:number;saved:string[]|null};
  const f=query.filters;
  async function load(){
   try{
    if(query.saved){const chunks=Array.from({length:Math.ceil(query.saved.length/50)},(_,i)=>query.saved!.slice(i*50,i*50+50));const batches=await Promise.all(chunks.map(slugs=>api.post<{items:CatalogApiProduct[]}>('/catalog/lookup',{slugs},{anonymous:true,signal:controller.signal})));const resolved=batches.flatMap(data=>data.items.map(mapProduct));const page=savedCatalogPage(query.saved.map(id=>resolved.find(p=>p.id===id)??unavailableProduct(id)),f);if(!controller.signal.aborted)setResult({key,...page,hasMore:false,error:''});}
    else {
     const params=new URLSearchParams({limit:'60',offset:String(query.offset),sort:f.sort==='price-asc'?'price_asc':f.sort==='price-desc'?'price_desc':'relevance'});
     if(f.query)params.set('q',f.query);if(f.category!=='all')params.set('categoryId',f.category);if(f.condition)params.set('condition',f.condition);if(f.stattrak)params.set('stattrak','true');
     if(f.min)params.set('min',f.min.replace(/\s/g,'').replace(',','.'));if(f.max)params.set('max',f.max.replace(/\s/g,'').replace(',','.'));
     const data=await api.get<CatalogPage>(`/catalog?${params}`,{signal:controller.signal});
     if(!controller.signal.aborted)setResult({key,products:data.items.map(mapProduct),total:data.pagination.total,categoryCounts:data.categoryCounts,hasMore:data.pagination.hasMore,error:''});
    }
   }catch(error){if(!controller.signal.aborted&&!(error instanceof DOMException&&error.name==='AbortError'))setResult({key,products:[],total:0,categoryCounts:{all:0,byCategory:{}},hasMore:false,error:errorMessage(error)});}
  }
  void load();return()=>controller.abort();
 },[key]);
 return {...result,loading:result.key!==key,products:result.key===key?result.products:[]};
}
