'use client';
import {useCallback,useEffect,useState} from 'react';
import {api,ApiError} from './api';
export function useRemote<T>(path:string|null,owner:string|null){
 const [revision,setRevision]=useState(0),[result,setResult]=useState<{key:string;data:T|null;error:string;status:number}>({key:'',data:null,error:'',status:0});
 const key=JSON.stringify([path,owner,revision]);
 const reload=useCallback(()=>setRevision(n=>n+1),[]);
 useEffect(()=>{
  if(!path)return;const controller=new AbortController();
  void api.get<T>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult({key,data,error:'',status:200});}).catch(error=>{if(!controller.signal.aborted&&!(error instanceof DOMException&&error.name==='AbortError'))setResult({key,data:null,error:'Не удалось загрузить данные. Попробуйте ещё раз.',status:error instanceof ApiError?error.status:0});});
  return()=>controller.abort();
 },[key,path]);
 useEffect(()=>{if(!path)return;window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload);},[path,reload]);
 const current=result.key===key;
 return {data:current?result.data:null,error:current?result.error:'',status:current?result.status:0,loading:!!path&&!current,reload};
}
