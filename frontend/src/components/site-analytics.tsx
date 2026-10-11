'use client';
import Script from 'next/script';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {publicAnalyticsUrl,googleBootstrap,yandexBootstrap,type AnalyticsConfig} from '@/lib/analytics';
type TrackingWindow=Window&{gtag?:(...args:unknown[])=>void;ym?:(...args:unknown[])=>void};
const subscribe=()=>()=>{};
const serverSnapshot=()=>false;
const browserSnapshot=()=>window.location.origin==='https://shardsmarket.com';
export function SiteAnalytics({config}:{config:AnalyticsConfig|null}){
 const pathname=usePathname(),onDomain=useSyncExternalStore(subscribe,browserSnapshot,serverSnapshot);
 const url=onDomain?publicAnalyticsUrl('https://shardsmarket.com'+pathname):null;
 const [gaReady,setGaReady]=useState(false),[ymReady,setYmReady]=useState(false);
 const gaPrevious=useRef<string|null>(null),ymPrevious=useRef<string|null>(null);
 useEffect(()=>{
  if(!config)return;
  const win=window as TrackingWindow;
  if(config.googleId)(win as unknown as Record<string,unknown>)[`ga-disable-${config.googleId}`]=!url;
  if(url&&gaReady&&config.googleId&&gaPrevious.current!==url){win.gtag?.('event','page_view',{page_location:url,page_referrer:gaPrevious.current??'',page_title:document.title});gaPrevious.current=url;}
  if(url&&ymReady&&config.yandexId&&ymPrevious.current!==url){win.ym?.(config.yandexId,'hit',url,{title:document.title,referer:ymPrevious.current??''});ymPrevious.current=url;}
 },[config,url,gaReady,ymReady]);
 useEffect(()=>{
  if(!config||!url)return;
  // A private page gets a new document with no third-party scripts. This also
  // ends Webvisor before account/cart/payment details can enter the DOM.
  const leavePublic=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const anchor=(event.target as Element|null)?.closest('a');if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download'))return;
   const target=new URL(anchor.href,window.location.href);
   if(target.origin===window.location.origin&&!publicAnalyticsUrl(target.href)){event.preventDefault();window.location.assign(target.href);}
  };
  document.addEventListener('click',leavePublic,true);return ()=>document.removeEventListener('click',leavePublic,true);
 },[config,url]);
 if(!config||!url)return null;
 return <>
  {config.googleId&&<><Script id="shards-ga-init" strategy="afterInteractive">{googleBootstrap(config.googleId,url)}</Script><Script id="shards-ga-loader" src={`https://www.googletagmanager.com/gtag/js?id=${config.googleId}`} strategy="afterInteractive" onReady={()=>setGaReady(true)}/></>}
  {config.yandexId&&<Script id="shards-ym-init" strategy="afterInteractive" onReady={()=>setYmReady(true)}>{yandexBootstrap(config.yandexId,config.webvisor,url)}</Script>}
 </>;
}
