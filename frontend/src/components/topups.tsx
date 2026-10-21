"use client";
import {useEffect,useId,useState} from "react";
import {parseAmount,shardsToRub,steamQuote,formatMinor} from "@/lib/money";
import {guestApi,guestPaymentContext} from '@/lib/guest-payment';
import {api,ApiError} from '@/lib/api';
import {useQuote} from '@/lib/use-quote';
import {useDraft} from '@/lib/use-draft';
import type {ApiResponses} from '@/generated/api-types';
import {useShop} from './shop-provider';
import {Icon} from "./icon";
type Quote=ApiResponses['/payments/top-up/quotes']['post'];
// Full document navigation ends public-page analytics before payment details render.
function openPaymentPage(path:string){
 window.location.assign(new URL(path,window.location.origin).href);
}
function usePayment(kind:'top-up'|'steam-refill',body:unknown,valid:boolean){
 const shop=useShop();const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const guest=kind==='steam-refill'&&(!shop.user||!!shop.config?.capabilities.guestSteamRefillEnabled);
 const client=guest?guestApi:api;
 const [guestOwner,setGuestOwner]=useState<string|null>(null),[contextError,setContextError]=useState('');
 const enabled=kind==='top-up'?shop.config?.capabilities.walletTopUpEnabled:guest?shop.config?.capabilities.guestSteamRefillEnabled:shop.config?.capabilities.steamRefillEnabled;
 useEffect(()=>{if(!guest||!enabled)return;let active=true;void guestPaymentContext().then(id=>{if(active){setGuestOwner(id);setContextError('');}}).catch(()=>{if(active)setContextError('Не удалось открыть форму оплаты. Обновите страницу.');});return()=>{active=false;};},[guest,enabled]);
 const owner=guest?guestOwner:shop.user?.id??null;
 const [lastSession,setLastSession]=useDraft(`payment-session:${guest?'guest':shop.user?.id??'anonymous'}:${kind}`,'');
 const authorized=kind==='top-up'?!!shop.user?.steam.connected:guest?!!guestOwner:!!shop.user;
 const path=`/payments/${guest?'guest/':''}${kind}`;
 const pricing=useQuote<Quote>(`${path}/quotes`,body,owner,authorized&&!!enabled&&valid,client);
 const pending=client.pendingCommand(`payment:${kind}`);
 async function submit(){
  setMessage('');if(lastSession){openPaymentPage(`/payments/return?session=${encodeURIComponent(lastSession)}`);return;}if(!authorized){if(kind==='top-up')shop.login('steam');return;}
  if(!pending&&(!pricing.quote||pricing.expired)){pricing.refresh();return;}
  setBusy(true);
  try{
   const result=await client.command<{id:string;checkoutUrl:string|null}>(`payment:${kind}`,'POST',`${path}/sessions`,pending?.body??{quoteId:pricing.quote!.quoteId,acceptedFiatMinor:pricing.quote!.fiatAmountMinor},result=>typeof result?.id==='string'&&!!result.id&&(result.checkoutUrl===null||typeof result.checkoutUrl==='string'));
   setLastSession(result.id);
   const returnPath=`/payments/return?session=${encodeURIComponent(result.id)}`;
   if(result.checkoutUrl){const url=new URL(result.checkoutUrl);if(url.protocol!=='https:')throw new Error('Invalid checkout URL');window.location.assign(url.href);}else openPaymentPage(returnPath);
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;setMessage(error instanceof ApiError&&error.status>=400&&error.status<500?'Условия изменились. Проверьте данные и обновите расчёт.':'Результат запроса пока неизвестен. Повторите проверку — второй платёж не создаётся.');if(error instanceof ApiError&&error.status<500)pricing.refresh();}
  finally{setBusy(false);}
 }
 return {shop,pricing,busy,pending,lastSession,newPayment:()=>setLastSession(''),authorized,enabled,message:message||contextError||pricing.error,submit};
}
export function BalanceForm({initialAmount='1 000'}:{initialAmount?:string}){
 const id=useId();const [amount,setAmount]=useDraft(`balance:${initialAmount}`,initialAmount);const minor=parseAmount(amount);const valid=minor!==null&&minor>=10000&&minor<=10000000&&minor%100===0;
 const payment=usePayment('top-up',{coinAmountMinor:minor},valid);
 return <form className="ym-hide-content" onSubmit={e=>{e.preventDefault();void payment.submit();}}>
  <div className="topup-form-body"><label className="field-label" htmlFor={id}>Сколько Shards зачислить</label><div className="money-input"><input id={id} value={amount} inputMode="decimal" maxLength={12} onChange={e=>setAmount(e.target.value)} required/><span>Shards</span></div>
  <div className="amount-presets">{[500,1000,2500,5000].map(n=><button type="button" key={n} className={minor===n*100?"selected":""} onClick={()=>setAmount(String(n))}>{n.toLocaleString('ru-RU')}</button>)}</div>
  <p className="fine-print ym-hide-content">Способ оплаты: СБП или картой</p>
  </div><div className="topup-total"><span>К оплате{!payment.pricing.quote?' ≈':''}</span><strong>{minor===null?'—':formatMinor(payment.pricing.quote?.fiatAmountMinor??shardsToRub(minor))} ₽</strong></div>
  <div className="topup-form-action"><button className="button primary full" disabled={payment.busy||(!payment.pending&&!payment.lastSession&&payment.authorized&&(!payment.enabled||!valid||payment.pricing.loading))} type="submit">{payment.busy?'Создаём платёж…':payment.lastSession?'Открыть созданный платёж':payment.pending?'Проверить результат запроса':!payment.authorized?'Войти через Steam':!payment.pricing.quote||payment.pricing.expired?'Обновить расчёт':'Пополнить баланс'} <Icon name="arrow"/></button>{payment.lastSession&&<button type="button" className="text-link" onClick={payment.newPayment}>Создать новое пополнение</button>}{(!valid||!payment.enabled||payment.message)&&<p className="form-message" role="status">{payment.message||(!valid?'Введите от 100 до 100 000 целых Shards.':'Пополнение временно недоступно.')}</p>}</div>
 </form>;
}
export function SteamForm(){
 const shop=useShop();const id=useId();const [email,setEmail]=useDraft('steam-email',shop.user?.email?.address??'');const contactEmail=email;const [amount,setAmount]=useDraft('steam-amount','1 000'),[steamLogin,setSteamLogin]=useDraft('steam-login','');
 const minor=parseAmount(amount),preview=minor!==null?steamQuote(minor):null;
 const valid=minor!==null&&minor>=5000&&minor<=943300&&minor%100===0&&/^[a-zA-Z0-9_-]{3,64}$/.test(steamLogin.trim())&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
 const payment=usePayment('steam-refill',{amountRub:minor===null?null:minor/100,steamLogin:steamLogin.trim(),email:contactEmail.trim()},valid);
 const quote=payment.pricing.quote;
 return <form className="ym-hide-content" onSubmit={e=>{e.preventDefault();void payment.submit();}}>
  <div className="topup-form-body"><div className="steam-fields"><div><label className="field-label" htmlFor={id+'amount'}>На баланс Steam</label><div className="money-input"><input id={id+'amount'} value={amount} inputMode="decimal" maxLength={12} onChange={e=>setAmount(e.target.value)} required/><span>₽</span></div></div><div><label className="field-label" htmlFor={id+'steam'}>Логин Steam <span>для входа</span></label><input className="text-input ym-disable-keys" id={id+'steam'} value={steamLogin} autoComplete="off" maxLength={64} placeholder="steam_login" onChange={e=>setSteamLogin(e.target.value)} required/></div></div>
  <div className="amount-presets">{[500,1000,2000,5000].map(n=><button type="button" key={n} className={minor===n*100?'selected':''} onClick={()=>setAmount(String(n))}>{n.toLocaleString('ru-RU')} ₽</button>)}</div>
  <dl className="steam-summary"><div><dt>На Steam</dt><dd>{preview?formatMinor(preview.amount):'—'} ₽</dd></div><div><dt>Комиссия <span className="pink">5%</span></dt><dd>{preview?formatMinor(quote?.feeRubMinor??preview.fee):'—'} ₽</dd></div></dl>
  {quote&&!payment.pricing.expired&&<p className="profile-found"><Icon name="check" size={17}/>{quote.steamLogin} · аккаунт проверен</p>}
  <label className="field-label" htmlFor={id+'email'}>Почта для чека и истории пополнений</label><input className="text-input ym-disable-keys" id={id+'email'} type="email" autoComplete="email" maxLength={254} value={contactEmail} onChange={e=>setEmail(e.target.value)} required/><p className="fine-print">Подтвердите эту почту в кабинете позже, чтобы увидеть прошлые пополнения.</p>
  </div><div className="topup-total"><span>К оплате{!quote?' ≈':''}</span><strong>{preview?formatMinor(quote?.fiatAmountMinor??preview.total):'—'} ₽</strong></div>
  <div className="topup-form-action"><button className="button primary full" disabled={payment.busy||(!payment.authorized&&!payment.lastSession)||(!payment.pending&&!payment.lastSession&&payment.authorized&&(!payment.enabled||!valid||payment.pricing.loading))} type="submit">{payment.busy?'Создаём платёж…':payment.lastSession?'Открыть созданный платёж':payment.pending?'Проверить результат запроса':!payment.authorized?'Подготовка оплаты…':!quote||payment.pricing.expired?'Проверить логин и сумму':'Перейти к оплате'}<Icon name="arrow"/></button>{payment.lastSession&&<button type="button" className="text-link" onClick={payment.newPayment}>Создать новое пополнение</button>}{(payment.message||!payment.enabled||!valid&&steamLogin.length>0)&&<p className="form-message" role="status">{payment.message||(!payment.enabled?'Пополнение временно недоступно.':'Укажите логин Steam, почту и от 50 до 9 433 целых рублей.')}</p>}</div>
 </form>;
}
export function Topups(){
 return <section className="section topup-section" id="topups" aria-labelledby="topup-heading"><div className="section-heading"><span className="eyebrow">ПЛАТЕЖИ</span><h2 id="topup-heading">Два способа пополнения</h2><span className="topup-heading-note">Steam отдельно от баланса магазина.</span></div><div className="topup-grid"><article className="topup-panel steam-panel" id="steam"><div className="topup-title"><Icon name="steam" size={32}/><span className="eyebrow">STEAM</span></div><h3>Пополнение Steam</h3><p className="muted">Зачисление на аккаунт Steam.</p><SteamForm/></article><article className="topup-panel" id="balance"><div className="topup-title"><Icon name="wallet" size={32}/><span className="eyebrow">БАЛАНС МАГАЗИНА</span></div><h3>Баланс Shards</h3><p className="muted">Для оплаты предметов в каталоге.<br/>1 ₽ = 1,6 Shards.</p><BalanceForm/></article></div></section>;
}
