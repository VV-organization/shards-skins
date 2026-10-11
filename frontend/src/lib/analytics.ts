export type AnalyticsConfig={googleId:string|null;yandexId:number|null;webvisor:boolean};
export function analyticsConfig(env:Record<string,string|undefined>):AnalyticsConfig|null{
 if(env.NODE_ENV!=='production'||env.ANALYTICS_ENABLED!=='true')return null;
 const google=env.ANALYTICS_GA_ID??'',yandex=env.ANALYTICS_YANDEX_ID??'';
 const googleId=/^G-[A-Z0-9]+$/.test(google)?google:null;
 const yandexId=/^[1-9]\d*$/.test(yandex)&&Number.isSafeInteger(Number(yandex))?Number(yandex):null;
 return googleId||yandexId?{googleId,yandexId,webvisor:env.ANALYTICS_WEBVISOR!=='false'}:null;
}
export function publicAnalyticsUrl(value:string):string|null{
 try{const url=new URL(value);if(url.origin!=='https://shardsmarket.com'||!(/^(?:\/$|\/catalog(?:\/[^/]+)?\/?$|\/(?:privacy|terms)\/?$)/.test(url.pathname)))return null;return url.origin+url.pathname;}catch{return null;}
}
// Match Frags and Skindrop: GA owns initial and Enhanced Measurement SPA views.
export function googleBootstrap(id:string){return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(id)});`;}
export function yandexBootstrap(id:number,webvisor:boolean,url:string){return `window.dataLayer=window.dataLayer||[];(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${id}','ym');ym(${id},'init',{defer:true,ssr:true,webvisor:${webvisor},clickmap:true,ecommerce:'dataLayer',referrer:"",url:${JSON.stringify(url)},accurateTrackBounce:true,trackLinks:true});`;}
