"use client";
import {createContext,useContext,useEffect,useEffectEvent,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import type {Catalog,Product} from "@/lib/types";
import {createSafeStorage} from "@/lib/browser-storage";
import {api,ApiError,errorMessage} from "@/lib/api";
import {clearPendingIntent,readPendingIntent,savePendingIntent,revisionsMatch} from "@/lib/pending-intent";
import {mapProduct,type CatalogApiProduct} from "@/lib/catalog-adapter";
import type {ApiResponses} from "@/generated/api-types";
import type {DuoQuote} from "@/lib/use-duo";
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
type CartResponse=ApiResponses["/cart"]["get"];
type Shop = Catalog & {cartVersion:number;cartLoading:boolean;cartError:string;refreshCart:()=>Promise<void>;user:SessionUser|null;sessionLoading:boolean;sessionError:string;refreshSession:()=>Promise<void>;tradeConfigured:boolean;cart:Product[];notice:{label:string;count:number}|null;dismissNotice:()=>void;add:(product:Product)=>void;addMany:(products:Product[],quote:DuoQuote)=>void;favorites:string[];toggleFavorite:(id:string)=>void;remove:(id:string)=>void;loggedIn:boolean;login:(mode?:"steam"|"email")=>void;logout:()=>void;tradeUrl:string;saveTradeUrl:(url:string)=>Promise<void>;previewProduct:Product|null;setPreviewProduct:(p:Product|null)=>void};
const ShopContext=createContext<Shop|null>(null);
export function useShop(){const value=useContext(ShopContext);if(!value)throw new Error("Missing shop");return value;}
export function ShopProvider({catalog,children}:{catalog:Catalog;children:ReactNode}) {
  const router=useRouter();
  const [notice,setNotice]=useState<{label:string;count:number}|null>(null);
  const [user,setUser]=useState<SessionUser|null>(null);
  const owner=useRef<string|null>(null);
  const [sessionLoading,setSessionLoading]=useState(true);
  const [sessionError,setSessionError]=useState("");
  const [tradeUrl,setTradeUrl]=useState("");
  const [tradeConfigured,setTradeConfigured]=useState(false);
  const [cart,setCart]=useState<Product[]>([]);
  const [cartVersion,setCartVersion]=useState(0);
  const version=useRef(0);
  const [cartLoading,setCartLoading]=useState(false);
  const [cartError,setCartError]=useState("");
  const [resumeProducts,setResumeProducts]=useState<Product[]|null>(null);
  const [resumeQuote,setResumeQuote]=useState<DuoQuote|null>(null);
  const resuming=useRef(false);
  const cartQueue=useRef(Promise.resolve());
  function acceptCart(result:CartResponse){
    if(result.version<version.current)return;
    version.current=result.version;setCartVersion(result.version);setCart(result.items.map(item=>mapProduct(item.product)));
  }
  function resetCart(){version.current=0;setCartVersion(0);setCart([]);setCartError("");setResumeProducts(null);setResumeQuote(null);}
  async function refreshCart(){setCartLoading(true);try{acceptCart(await api.get<CartResponse>("/cart"));setCartError("");}finally{setCartLoading(false);}}
  function queueCart(work:()=>Promise<void>){
    const intendedOwner=owner.current;
    cartQueue.current=cartQueue.current.catch(()=>{}).then(async()=>{
      if(!intendedOwner||intendedOwner!==owner.current)return;
      setCartLoading(true);setCartError("");
      try{await work();}catch(error){
        if(error instanceof DOMException&&error.name==="AbortError")return;
        setCartError(error instanceof ApiError&&error.status===409?"Корзина изменилась. Проверьте её и повторите действие.":"Не удалось обновить корзину. Повторите действие.");
        if(error instanceof ApiError&&error.status===409)try{acceptCart(await api.get<CartResponse>("/cart"));}catch{}
      }finally{setCartLoading(false);}
    });
  }
  async function addSingle(product:Product){
    const result=await api.command<CartResponse>(`cart:add:${product.id}`,"PUT",`/cart/items/${encodeURIComponent(product.id)}`,{quantity:1,expectedCartVersion:version.current});
    acceptCart(result);setNotice({label:product.name,count:1});
  }
  async function addDuo(quote:DuoQuote){
    const result=await api.command<CartResponse>(`cart:duo:${quote.id}`,"POST","/cart/duo",{quoteId:quote.id,expectedCartVersion:version.current});
    acceptCart(result);setNotice({label:quote.items.map(p=>p.title).join(" + "),count:2});
  }
  async function resumeIntent(){
    const intent=readPendingIntent(sessionStorage);if(!intent||resuming.current)return;
    resuming.current=true;
    try{
      const result=await api.post<{items:CatalogApiProduct[]}>("/catalog/lookup",{slugs:intent.slugs},{anonymous:true});
      const products=result.items.map(mapProduct);
      if(intent.kind==="item"&&products.length===1&&products[0].availability==="available"&&revisionsMatch(intent,products.map(p=>({slug:p.id,priceRevision:p.priceRevision})))){
        await addSingle(products[0]);clearPendingIntent(sessionStorage);
      }else if(intent.kind==="duo"&&intent.budgetRubMinor!==undefined&&products.length===2&&products.every(p=>p.availability==="available")){
        const knife=products.find(p=>p.categoryId==="knife"),glove=products.find(p=>p.categoryId==="gloves");
        if(!knife||!glove){setResumeProducts(products);return;}
        const quote=await api.post<DuoQuote>("/duo/quotes",{knifeSlug:knife.id,gloveSlug:glove.id,budgetRubMinor:intent.budgetRubMinor},{anonymous:true});
        if(quote.withinBudget&&revisionsMatch(intent,quote.items.map(p=>({slug:p.slug,priceRevision:p.priceRevision})))){await addDuo(quote);clearPendingIntent(sessionStorage);}
        else{setResumeProducts(quote.items.map(mapProduct));setResumeQuote(quote);}
      }else setResumeProducts(products);
    }catch{setCartError("Не удалось восстановить выбранный предмет. Повторите действие в каталоге.");}
    finally{resuming.current=false;}
  }
  async function refreshSession(){
    try {
      const next=await api.get<SessionUser>("/session/me");
      if(owner.current&&owner.current!==next.id){clearPendingIntent(sessionStorage);resetCart();setTradeUrl("");}
      api.setOwner(next.id);owner.current=next.id;setUser(next);setSessionError("");
      if(next.steam.connected){
        const status=await api.get<{configured:boolean}>("/me/steam-trade-url/status");setTradeConfigured(status.configured);
        await refreshCart();await resumeIntent();
      }else{setTradeConfigured(false);resetCart();}
    } catch(error) {
      if(error instanceof DOMException&&error.name==="AbortError")return;
      if(error instanceof ApiError&&error.status===401){if(owner.current)clearPendingIntent(sessionStorage);api.setOwner(null);owner.current=null;setUser(null);resetCart();setTradeConfigured(false);setTradeUrl("");}
      else setSessionError(errorMessage(error));
    } finally {setSessionLoading(false);}
  }
  const loadSession=useEffectEvent(()=>refreshSession());
  // Session setters run only after the asynchronous API response; there is no synchronous state update.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{void loadSession();return ()=>api.reset();},[]);
  async function saveTradeUrl(url:string){await api.put("/me/steam-trade-url",{tradeUrl:url});setTradeConfigured(true);setTradeUrl(url);}

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
  function requireLogin(products:Product[],budgetRubMinor?:number){
    if(user?.steam.connected)return false;
    savePendingIntent(sessionStorage,{kind:products.length===2?"duo":"item",slugs:products.map(p=>p.id),displayedRevisions:products.map(p=>({slug:p.id,priceRevision:p.priceRevision})),...(budgetRubMinor===undefined?{}:{budgetRubMinor})});
    setLoginMode("steam");setLoginDialog(true);return true;
  }
  function add(product:Product){if(requireLogin([product]))return;queueCart(()=>addSingle(product));}
  function addMany(products:Product[],quote:DuoQuote){if(requireLogin(products,quote.budgetRubMinor))return;queueCart(()=>addDuo(quote));}
  function remove(id:string){queueCart(async()=>{acceptCart(await api.command<CartResponse>(`cart:remove:${id}`,"DELETE",`/cart/items/${encodeURIComponent(id)}`,{expectedCartVersion:version.current}));});}
  return <ShopContext.Provider value={{...catalog,cart,cartVersion,cartLoading,cartError,refreshCart,notice,dismissNotice:()=>setNotice(null),add,addMany,favorites,toggleFavorite,remove,user,sessionLoading,sessionError,refreshSession,tradeConfigured,loggedIn:!!user,login:(mode="steam")=>{setLoginMode(mode);setAuthError("");setLoginDialog(true);},logout:()=>setLogoutDialog(true),tradeUrl,saveTradeUrl,previewProduct,setPreviewProduct}}>
    {children}
    {cartError&&<Modal title="Корзина" onClose={()=>setCartError("")}><h2>Корзина</h2><p className="form-message" role="alert">{cartError}</p><button className="button primary full" onClick={()=>setCartError("")}>Понятно</button></Modal>}
    {resumeProducts&&<Modal title="Проверьте выбор" onClose={()=>{clearPendingIntent(sessionStorage);setResumeProducts(null);}}><h2>Проверьте выбор</h2><p className="muted">Цена или наличие выбранных предметов изменились. Проверьте актуальные условия перед добавлением.</p>{resumeProducts.map(product=><p key={product.id}>{product.name} — {product.availability==="available"?`${(product.priceMinor/100).toLocaleString("ru-RU")} Shards`:"Недоступен"}</p>)}<button className="button primary full" disabled={cartLoading||resumeProducts.length===0||resumeProducts.some(p=>p.availability!=="available")||(resumeProducts.length===2&&!resumeQuote?.withinBudget)} onClick={()=>{queueCart(async()=>{
      if(resumeQuote){
        if(Date.parse(resumeQuote.expiresAt)<=Date.now()){
          const fresh=await api.post<DuoQuote>("/duo/quotes",{knifeSlug:resumeQuote.items[0].slug,gloveSlug:resumeQuote.items[1].slug,budgetRubMinor:resumeQuote.budgetRubMinor},{anonymous:true});setResumeQuote(fresh);setResumeProducts(fresh.items.map(mapProduct));return;
        }
        await addDuo(resumeQuote);
      }else await addSingle(resumeProducts[0]);
      clearPendingIntent(sessionStorage);setResumeProducts(null);setResumeQuote(null);
    });}}>Добавить в корзину</button></Modal>}
    {!previewProduct&&<CartNotice/>}
    {loginDialog&&<Modal title="Личный кабинет" onClose={()=>setLoginDialog(false)}><div className="dialog-symbol"><Icon name="steam" size={32}/></div><h2>Личный кабинет</h2><p className="muted">Сохраните ссылку на обмен и управляйте покупками в личном кабинете.</p>{loginMode==="steam"?<><a className="button primary full" href={`/api/auth/steam/start?returnTo=${encodeURIComponent(readPendingIntent(sessionStorage)?"/cart":"/account")}`}>Войти через Steam <Icon name="arrow"/></a><button className="text-link" onClick={()=>setLoginMode("email")}>Войти по почте</button></>:<form onSubmit={e=>{e.preventDefault();void submitEmail();}}><label className="field-label" htmlFor="auth-email">Электронная почта</label><input className="text-input" id="auth-email" type="email" value={email} required disabled={!!challenge||authBusy} onChange={e=>setEmail(e.target.value)}/>{challenge&&<><label className="field-label" htmlFor="auth-code">Код из письма</label><input className="text-input" id="auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)} required/></>}<button className="button primary full" disabled={authBusy}>{authBusy?"Подождите…":challenge?"Подтвердить":"Получить код"} <Icon name="arrow"/></button><button type="button" className="text-link" onClick={()=>{setChallenge(null);setCode("");setLoginMode("steam");}}>Войти через Steam</button></form>}{authError&&<p className="form-message" role="alert">{authError}</p>}</Modal>}
    {logoutDialog&&<Modal title="Выйти из аккаунта?" onClose={()=>setLogoutDialog(false)}><h2>Выйти из аккаунта?</h2><p className="muted">Выбранные скины останутся в корзине.</p><div className="dialog-actions"><button className="button primary" autoFocus onClick={()=>setLogoutDialog(false)}>Остаться</button><button className="button secondary" onClick={()=>{void api.post("/session/logout",{}).then(()=>{api.reset();api.setOwner(null);owner.current=null;clearPendingIntent(sessionStorage);setUser(null);resetCart();setTradeUrl("");setTradeConfigured(false);setLogoutDialog(false);router.refresh();}).catch(error=>setSessionError(errorMessage(error)));}}>Выйти</button></div></Modal>}
  </ShopContext.Provider>;
}

export function CartNotice(){
 const shop=useShop();
 if(!shop.notice)return null;
 return <div className="cart-notice" role="status" aria-live="polite"><span className="notice-check"><Icon name="check"/></span><div><strong>{shop.notice.count>1?"Дуэт добавлен в корзину":"Добавлено в корзину"}</strong><span>{shop.notice.label}</span></div><Link href="/cart" onClick={()=>{shop.dismissNotice();shop.setPreviewProduct(null);}}>В корзину <Icon name="arrow" size={16}/></Link><button className="icon-button" aria-label="Закрыть уведомление" onClick={shop.dismissNotice}><Icon name="close" size={18}/></button></div>;
}
