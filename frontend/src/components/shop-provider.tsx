"use client";
import {createContext,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import type {Catalog,Product} from "@/lib/types";
import {createSafeStorage} from "@/lib/browser-storage";
import {api,ApiError,errorMessage} from "@/lib/api";
import {clearPendingIntent,readPendingIntent,savePendingIntent} from "@/lib/pending-intent";
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
export type SessionUser={id:string;steam:{connected:boolean;steamId64?:string};email?:{address:string;verified:boolean}};
type Shop = Catalog & {user:SessionUser|null;sessionLoading:boolean;sessionError:string;refreshSession:()=>Promise<void>;tradeConfigured:boolean;cart:Product[];notice:{label:string;count:number}|null;dismissNotice:()=>void;add:(product:Product)=>void;addMany:(products:Product[])=>void;favorites:string[];toggleFavorite:(id:string)=>void;remove:(id:string)=>void;loggedIn:boolean;login:(mode?:"steam"|"email")=>void;logout:()=>void;tradeUrl:string;saveTradeUrl:(url:string)=>Promise<void>;previewProduct:Product|null;setPreviewProduct:(p:Product|null)=>void};
const ShopContext=createContext<Shop|null>(null);
export function useShop(){const value=useContext(ShopContext);if(!value)throw new Error("Missing shop");return value;}
export function ShopProvider({catalog,children}:{catalog:Catalog;children:ReactNode}) {
  const router=useRouter();
  const [user,setUser]=useState<SessionUser|null>(null);
  const owner=useRef<string|null>(null);
  const [sessionLoading,setSessionLoading]=useState(true);
  const [sessionError,setSessionError]=useState("");
  const [tradeUrl,setTradeUrl]=useState("");
  const [tradeConfigured,setTradeConfigured]=useState(false);
  const [cart,setCart]=useState<Product[]>([]);
  async function refreshSession(){
    try {
      const next=await api.get<SessionUser>("/session/me");
      if(owner.current&&owner.current!==next.id){clearPendingIntent(sessionStorage);setCart([]);setTradeUrl("");}
      api.setOwner(next.id);owner.current=next.id;setUser(next);setSessionError("");
      const status=await api.get<{configured:boolean}>("/me/steam-trade-url/status");setTradeConfigured(status.configured);
    } catch(error) {
      if(error instanceof DOMException&&error.name==="AbortError")return;
      if(error instanceof ApiError&&error.status===401){if(owner.current)clearPendingIntent(sessionStorage);api.setOwner(null);owner.current=null;setUser(null);setCart([]);setTradeConfigured(false);setTradeUrl("");}
      else setSessionError(errorMessage(error));
    } finally {setSessionLoading(false);}
  }
  // Session setters run only after the asynchronous API response; there is no synchronous state update.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{void refreshSession();return ()=>api.reset();},[]);
  async function saveTradeUrl(url:string){await api.put("/me/steam-trade-url",{tradeUrl:url});setTradeConfigured(true);setTradeUrl(url);}

  const [notice,setNotice]=useState<{label:string;count:number}|null>(null);
  const [favoriteRaw,setFavoriteRaw]=useStored("shards:favorites","[]");
  const favorites=useMemo(()=>{try{const v:unknown=JSON.parse(favoriteRaw);return Array.isArray(v)?v.filter((id):id is string=>typeof id==="string"):[];}catch{return [];}},[favoriteRaw]);
  function toggleFavorite(id:string){setFavoriteRaw(JSON.stringify(favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id]));}
  const [loginDialog,setLoginDialog]=useState(false);
  const [loginMode,setLoginMode]=useState<"steam"|"email">("steam");
  const [email,setEmail]=useState("");const [code,setCode]=useState("");const [challenge,setChallenge]=useState<string|null>(null);
  const [authError,setAuthError]=useState("");const [authBusy,setAuthBusy]=useState(false);
  async function submitEmail(){
    setAuthBusy(true);setAuthError("");
    try {
      if(challenge){await api.post(`/auth/email/challenges/${challenge}/verify`,{code},{anonymous:!user});await refreshSession();setLoginDialog(false);setChallenge(null);setCode("");}
      else {const result=await api.post<{id:string}>("/auth/email/challenges",{email,purpose:user?"link_email":"sign_in"},{anonymous:!user});setChallenge(result.id);}
    } catch(error){setAuthError(errorMessage(error));}finally{setAuthBusy(false);}
  }

  const [logoutDialog,setLogoutDialog]=useState(false);
  const [previewProduct,setPreviewProduct]=useState<Product|null>(null);
  function requireLogin(products:Product[]){
    if(user?.steam.connected)return false;
    savePendingIntent(sessionStorage,{kind:products.length===2?"duo":"item",slugs:products.map(p=>p.id),displayedRevisions:[]});
    setLoginMode("steam");setLoginDialog(true);return true;
  }
  function add(product:Product){if(requireLogin([product]))return;setSessionError("Не удалось добавить предмет. Обновите каталог и попробуйте снова.");}
  function addMany(products:Product[]){if(requireLogin(products))return;setSessionError("Не удалось добавить дуэт. Обновите подборку и попробуйте снова.");}
  function remove(id:string){setCart(current=>current.filter(p=>p.id!==id));}
  return <ShopContext.Provider value={{...catalog,cart,notice,dismissNotice:()=>setNotice(null),add,addMany,favorites,toggleFavorite,remove,user,sessionLoading,sessionError,refreshSession,tradeConfigured,loggedIn:!!user,login:(mode="steam")=>{setLoginMode(mode);setAuthError("");setLoginDialog(true);},logout:()=>setLogoutDialog(true),tradeUrl,saveTradeUrl,previewProduct,setPreviewProduct}}>
    {children}
    {!previewProduct&&<CartNotice/>}
    {loginDialog&&<Modal title="Личный кабинет" onClose={()=>setLoginDialog(false)}><div className="dialog-symbol"><Icon name="steam" size={32}/></div><h2>Личный кабинет</h2><p className="muted">Сохраните ссылку на обмен и управляйте покупками в личном кабинете.</p>{loginMode==="steam"?<><a className="button primary full" href={`/api/auth/steam/start?returnTo=${encodeURIComponent(readPendingIntent(sessionStorage)?"/cart":"/account")}`}>Войти через Steam <Icon name="arrow"/></a><button className="text-link" onClick={()=>setLoginMode("email")}>Войти по почте</button></>:<form onSubmit={e=>{e.preventDefault();void submitEmail();}}><label className="field-label" htmlFor="auth-email">Электронная почта</label><input className="text-input" id="auth-email" type="email" value={email} required disabled={!!challenge||authBusy} onChange={e=>setEmail(e.target.value)}/>{challenge&&<><label className="field-label" htmlFor="auth-code">Код из письма</label><input className="text-input" id="auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)} required/></>}<button className="button primary full" disabled={authBusy}>{authBusy?"Подождите…":challenge?"Подтвердить":"Получить код"} <Icon name="arrow"/></button><button type="button" className="text-link" onClick={()=>{setChallenge(null);setCode("");setLoginMode("steam");}}>Войти через Steam</button></form>}{authError&&<p className="form-message" role="alert">{authError}</p>}</Modal>}
    {logoutDialog&&<Modal title="Выйти из аккаунта?" onClose={()=>setLogoutDialog(false)}><h2>Выйти из аккаунта?</h2><p className="muted">Выбранные скины останутся в корзине.</p><div className="dialog-actions"><button className="button primary" autoFocus onClick={()=>setLogoutDialog(false)}>Остаться</button><button className="button secondary" onClick={()=>{void api.post("/session/logout",{}).then(()=>{api.reset();api.setOwner(null);owner.current=null;clearPendingIntent(sessionStorage);setUser(null);setCart([]);setTradeUrl("");setTradeConfigured(false);setLogoutDialog(false);router.refresh();}).catch(error=>setSessionError(errorMessage(error)));}}>Выйти</button></div></Modal>}
  </ShopContext.Provider>;
}

export function CartNotice(){
 const shop=useShop();
 if(!shop.notice)return null;
 return <div className="cart-notice" role="status" aria-live="polite"><span className="notice-check"><Icon name="check"/></span><div><strong>{shop.notice.count>1?"Дуэт добавлен в корзину":"Добавлено в корзину"}</strong><span>{shop.notice.label}</span></div><Link href="/cart" onClick={()=>{shop.dismissNotice();shop.setPreviewProduct(null);}}>В корзину <Icon name="arrow" size={16}/></Link><button className="icon-button" aria-label="Закрыть уведомление" onClick={shop.dismissNotice}><Icon name="close" size={18}/></button></div>;
}
