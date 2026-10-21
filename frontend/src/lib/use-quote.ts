'use client';
import {useEffect,useState} from 'react';
import {api,type ApiClient} from './api';
/** Display a quote only for the current owner and exact current inputs. */
export function useQuote<T extends {expiresAt:string}>(path:string,body:unknown,owner:string|null,enabled:boolean,client:ApiClient=api){
 const serialized=JSON.stringify(body),key=JSON.stringify([path,serialized,owner,enabled]);
 const [revision,setRevision]=useState(0),[result,setResult]=useState<{key:string;revision:number;data:T|null;error:string}>({key:'',revision:-1,data:null,error:''}),[expired,setExpired]=useState<T|null>(null);
 useEffect(()=>{if(!enabled)return;const controller=new AbortController();const timer=setTimeout(()=>{
  void client.post<T>(path,JSON.parse(serialized),{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult({key,revision,data,error:''});}).catch(()=>{if(!controller.signal.aborted)setResult({key,revision,data:null,error:'Не удалось подтвердить условия. Проверьте данные и повторите расчёт.'});});
 },250);return()=>{clearTimeout(timer);controller.abort();};},[path,serialized,key,revision,enabled,client]);
 useEffect(()=>{if(!result.data)return;const data=result.data;const timer=setTimeout(()=>setExpired(data),Math.max(0,Date.parse(data.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[result]);
 const current=enabled&&result.key===key&&result.revision===revision;
 return {quote:current?result.data:null,error:current?result.error:'',loading:enabled&&!current,expired:current&&!!result.data&&expired===result.data,refresh:()=>setRevision(n=>n+1)};
}
