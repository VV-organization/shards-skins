"use client";
import {createContext,useContext,useMemo,useState,useSyncExternalStore,type ReactNode} from "react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import type {Catalog,Product} from "@/lib/types";
import {createSafeStorage} from "@/lib/browser-storage";
import {mergeCartIds} from "@/lib/duo";
import {Modal} from "./modal";
import {Icon} from "./icon";

const safeStorage=createSafeStorage(()=>localStorage);
// Keep existing local data when upgrading the previous brand. New writes use Shards keys.
const readStored=(key:string,fallback:string)=>safeStorage.read(key,safeStorage.read(key.replace(/^shards:/,"prism:"),fallback));
function subscribe(callback:()=>void) {
  const external=(event:StorageEvent)=>{safeStorage.invalidate(event.key);callback();};
  window.addEventListener("storage",external); window.addEventListener("shards-store",callback);
  return ()=>{window.removeEventListener("storage",external);window.removeEventListener("shards-store",callback);};
}
function useStored(key:string, fallback:string) {
  const raw=useSyncExternalStore(subscribe,()=>readStored(key,fallback),()=>fallback);
  function set(value:string){safeStorage.write(key,value);window.dispatchEvent(new Event("shards-store"));}
  return [raw,set] as const;
}
type Shop = Catalog & {cart:Product[];notice:{label:string;count:number}|null;dismissNotice:()=>void;add:(product:Product)=>void;addMany:(products:Product[])=>void;favorites:string[];toggleFavorite:(id:string)=>void;remove:(id:string)=>void;loggedIn:boolean;login:()=>void;logout:()=>void;tradeUrl:string;saveTradeUrl:(url:string)=>void;previewProduct:Product|null;setPreviewProduct:(p:Product|null)=>void};
const ShopContext=createContext<Shop|null>(null);
export function useShop(){const value=useContext(ShopContext);if(!value)throw new Error("Missing shop");return value;}
export function ShopProvider({catalog,children}:{catalog:Catalog;children:ReactNode}) {
  const router=useRouter();const pathname=usePathname().replace(/\/$/,"")||"/";
  const [raw,setRaw]=useStored("shards:cart","[]");
  const [loginValue,setLoginValue]=useStored("shards:preview-login","0");
  const [tradeUrl,saveTradeUrl]=useStored("shards:trade-url","");
  const [notice,setNotice]=useState<{label:string;count:number}|null>(null);
  const [favoriteRaw,setFavoriteRaw]=useStored("shards:favorites","[]");
  const favorites=useMemo(()=>{try{const v:unknown=JSON.parse(favoriteRaw);return Array.isArray(v)?v.filter((id):id is string=>typeof id==="string"&&catalog.products.some(p=>p.id===id)):[];}catch{return [];}},[favoriteRaw,catalog.products]);
  function toggleFavorite(id:string){setFavoriteRaw(JSON.stringify(favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id]));}
  const [loginDialog,setLoginDialog]=useState(false);
  const [logoutDialog,setLogoutDialog]=useState(false);
  const [previewProduct,setPreviewProduct]=useState<Product|null>(null);
  const cart=useMemo(()=>{
    try {const parsed:unknown=JSON.parse(raw);if(!Array.isArray(parsed))return [];const ids=new Set(parsed.filter(x=>typeof x==="string"));return catalog.products.filter(p=>ids.has(p.id));}catch{return [];}
  },[raw,catalog.products]);
  async function mutateCart(idsToAdd:string[],idToRemove?:string){
    const mutate=()=>{let ids:string[]=[];try{const parsed:unknown=JSON.parse(readStored("shards:cart","[]"));if(Array.isArray(parsed))ids=parsed.filter((x):x is string=>typeof x==="string");}catch{}setRaw(JSON.stringify(mergeCartIds(ids.filter(id=>id!==idToRemove),idsToAdd,catalog.products.map(p=>p.id))));};
    if(navigator.locks)await navigator.locks.request("shards-cart",mutate);else mutate();
  }
  function add(product:Product){void mutateCart([product.id]).then(()=>setNotice({label:product.name,count:1}));}
  function addMany(products:Product[]){const unique=products.filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);void mutateCart(unique.map(p=>p.id)).then(()=>setNotice({label:unique.map(p=>p.weapon).join(" + "),count:unique.length}));}
  function remove(id:string){void mutateCart([],id);}
  return <ShopContext.Provider value={{...catalog,cart,notice,dismissNotice:()=>setNotice(null),add,addMany,favorites,toggleFavorite,remove,loggedIn:loginValue==="1",login:()=>setLoginDialog(true),logout:()=>setLogoutDialog(true),tradeUrl,saveTradeUrl,previewProduct,setPreviewProduct}}>
    {children}
    {!previewProduct&&<CartNotice/>}
    {loginDialog&&<Modal title="Личный кабинет" onClose={()=>setLoginDialog(false)}><div className="dialog-symbol"><Icon name="steam" size={32}/></div><h2>Личный кабинет</h2><p className="muted">Откройте локальный кабинет для настройки ссылки на обмен. Подключение аккаунта Steam пока недоступно.</p><button className="button primary full" onClick={()=>{setLoginValue("1");setLoginDialog(false);if(pathname!=="/cart")router.push("/account");}}>{pathname==="/cart"?"Продолжить":"Перейти в кабинет"} <Icon name="arrow"/></button></Modal>}
    {logoutDialog&&<Modal title="Выйти из аккаунта?" onClose={()=>setLogoutDialog(false)}><h2>Выйти из аккаунта?</h2><p className="muted">Выбранные скины останутся в корзине.</p><div className="dialog-actions"><button className="button primary" autoFocus onClick={()=>setLogoutDialog(false)}>Остаться</button><button className="button secondary" onClick={()=>{setLoginValue("0");setLogoutDialog(false);}}>Выйти</button></div></Modal>}
  </ShopContext.Provider>;
}

export function CartNotice(){
 const shop=useShop();
 if(!shop.notice)return null;
 return <div className="cart-notice" role="status" aria-live="polite"><span className="notice-check"><Icon name="check"/></span><div><strong>{shop.notice.count>1?"Дуэт добавлен в корзину":"Добавлено в корзину"}</strong><span>{shop.notice.label}</span></div><Link href="/cart" onClick={()=>{shop.dismissNotice();shop.setPreviewProduct(null);}}>В корзину <Icon name="arrow" size={16}/></Link><button className="icon-button" aria-label="Закрыть уведомление" onClick={shop.dismissNotice}><Icon name="close" size={18}/></button></div>;
}
