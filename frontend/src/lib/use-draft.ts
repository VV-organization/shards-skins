'use client';
import {useSyncExternalStore} from 'react';
const fallback=new Map<string,string>();
function subscribe(fn:()=>void){window.addEventListener('shards-draft',fn);return()=>window.removeEventListener('shards-draft',fn);}
/** Only editable, nonfinancial form inputs; never a price, authorization or payment status. */
export function useDraft(key:string,initial:string){
 const storageKey=`shards:draft:${key}`;
 const value=useSyncExternalStore(subscribe,()=>{try{return sessionStorage.getItem(storageKey)??initial;}catch{return fallback.get(storageKey)??initial;}},()=>initial);
 return [value,(next:string)=>{fallback.set(storageKey,next);try{sessionStorage.setItem(storageKey,next);}catch{}window.dispatchEvent(new Event('shards-draft'));}] as const;
}
