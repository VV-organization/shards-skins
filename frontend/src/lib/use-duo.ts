'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {mapProduct} from './catalog-adapter';
import type {ApiResponses} from '../generated/api-types';
import type {Product} from './types';
export type DuoQuote=ApiResponses['/duo/quotes']['post'];
type Options=ApiResponses['/duo/options']['get'];
export function useDuoOptions(slot:'knife'|'gloves',initial:Product|undefined){
 const [items,setItems]=useState<Product[]>([]),[selection,setSelection]=useState<Product|undefined>(initial);
 const [cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const busy=useRef(false),selectedByUser=useRef(false),generation=useRef(0),next=useRef<string|null>(null);
 async function load(first=false){
  if(busy.current)return;const epoch=generation.current;busy.current=true;setLoading(true);setError('');
  try{
   const data=await api.get<Options>(`/duo/options?slot=${slot}${!first&&next.current?`&cursor=${encodeURIComponent(next.current)}`:''}`);
   if(epoch!==generation.current)return;
   const products=data.items.map(mapProduct);setItems(current=>first?products:[...new Map([...current,...products].map(p=>[p.id,p])).values()]);
   setSelection(current=>selectedByUser.current?current:products.find(p=>p.id===current?.id)??(first?products[0]??current:current));
   next.current=data.nextCursor;setCursor(data.nextCursor);
  }catch{if(epoch===generation.current)setError('Не удалось загрузить варианты');}finally{if(epoch===generation.current){busy.current=false;setLoading(false);}}
 }
 useEffect(()=>{generation.current++;busy.current=false;void load(true);return()=>{generation.current++;};},[slot]); // eslint-disable-line react-hooks/exhaustive-deps
 function select(id:string){selectedByUser.current=true;setSelection(items.find(p=>p.id===id)??selection);}
 const options=selection&&!items.some(p=>p.id===selection.id)?[selection,...items]:items;
 return {items:options,selection,select,loading,error,hasMore:cursor!==null,loadMore:()=>void load(items.length===0)};
}
export function useDuoQuote(knife:string|undefined,glove:string|undefined,budget:number|null){
 const key=JSON.stringify([knife,glove,budget]);
 const [revision,setRevision]=useState(0);
 const [result,setResult]=useState<{key:string;revision:number;quote:DuoQuote|null;error:string}>({key:'',revision:-1,quote:null,error:''});
 const [expired,setExpired]=useState<string|null>(null);
 useEffect(()=>{
  if(!knife||!glove||budget===null)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{void api.post<DuoQuote>('/duo/quotes',{knifeSlug:knife,gloveSlug:glove,budgetRubMinor:budget},{anonymous:true,signal:controller.signal}).then(quote=>{if(!controller.signal.aborted)setResult({key,revision,quote,error:''});}).catch(()=>{if(!controller.signal.aborted)setResult({key,revision,quote:null,error:'Не удалось рассчитать дуэт. Проверьте выбранные предметы.'});});},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[key,revision,knife,glove,budget]);
 useEffect(()=>{
  if(!result.quote)return;
  const id=result.quote.id;const timer=setTimeout(()=>setExpired(id),Math.max(0,Date.parse(result.quote.expiresAt)-Date.now()));return()=>clearTimeout(timer);
 },[result]);
 const current=result.key===key&&result.revision===revision;
 return {quote:current?result.quote:null,loading:!!knife&&!!glove&&budget!==null&&!current,error:current?result.error:'',expired:!!result.quote&&expired===result.quote.id,refresh:()=>setRevision(v=>v+1)};
}
