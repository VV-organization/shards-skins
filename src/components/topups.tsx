"use client";
import {useId,useRef,useState} from "react";
import {parseAmount,shardsToRub,steamQuote,formatMinor} from "@/lib/money";
import {Icon} from "./icon";
type Profile={steamId:string;name:string;profileUrl:string};
export function BalanceForm(){
  const id=useId();const [amount,setAmount]=useState("1 000");const [method,setMethod]=useState("card");const [message,setMessage]=useState("");const minor=parseAmount(amount);
  return <form onSubmit={async e=>{e.preventDefault();if(!minor){setMessage("Введите сумму больше нуля, до двух знаков после запятой.");return;}setMessage("Платёжный сервис временно недоступен. Баланс не изменён.");}}>
    <div className="topup-form-body"><label className="field-label" htmlFor={id}>Сколько Shards зачислить</label><div className="money-input"><input id={id} value={amount} inputMode="decimal" maxLength={12} onChange={e=>{setAmount(e.target.value);setMessage("");}} required/><span>Shards</span></div>
    <div className="amount-presets">{[500,1000,2500,5000].map(n=><button type="button" key={n} className={minor===n*100?"selected":""} onClick={()=>{setAmount(String(n));setMessage("");}}>{n.toLocaleString("ru-RU")}</button>)}</div>
    <fieldset className="payment-choice"><legend>Способ оплаты</legend><label className={method==="card"?"selected":""}><input type="radio" name={id+"method"} checked={method==="card"} onChange={()=>setMethod("card")}/>Банковская карта</label><label className={method==="sbp"?"selected":""}><input type="radio" name={id+"method"} checked={method==="sbp"} onChange={()=>setMethod("sbp")}/>СБП</label></fieldset>
    </div><div className="topup-total"><span>К оплате</span><strong>{minor===null?"—":formatMinor(shardsToRub(minor))} ₽</strong></div>
    <div className="topup-form-action"><button className="button primary full" type="submit">Пополнить баланс <Icon name="arrow"/></button>{message&&<p className="form-message" role="status">{message}</p>}</div>
  </form>;
}
export function SteamForm(){
  const id=useId();const [amount,setAmount]=useState("1 000");const [steamId,setSteamId]=useState("");const [profile,setProfile]=useState<Profile|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const generation=useRef(0);
  const minor=parseAmount(amount);const quote=minor!==null?steamQuote(minor):null;
  function invalidate(){generation.current++;setProfile(null);setBusy(false);setMessage("");}
  async function submit(){
    setMessage("");if(!minor){setMessage("Введите сумму зачисления больше нуля.");return;}
    if(profile){setMessage("Пополнение Steam временно недоступно. Деньги не списаны.");return;}
    if(!/^\d{17}$/.test(steamId)){setMessage("Steam ID должен содержать 17 цифр.");return;}
    if(process.env.NEXT_PUBLIC_STATIC_EXPORT==="true"){setMessage("Проверка Steam временно недоступна. Попробуйте позже.");return;}
    const request=++generation.current;setBusy(true);
    try{
      const response=await fetch("/api/steam/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({steamId})});
      const data=await response.json();if(request!==generation.current)return;
      if(!response.ok)throw new Error(data.error??"Не удалось проверить аккаунт.");
      setProfile(data);
    }catch(error){if(request===generation.current)setMessage(error instanceof Error?error.message:"Проверка временно недоступна.");}
    finally{if(request===generation.current)setBusy(false);}
  }
  return <form onSubmit={e=>{e.preventDefault();void submit();}}>
    <div className="topup-form-body"><div className="steam-fields"><div><label className="field-label" htmlFor={id+"amount"}>На баланс Steam</label><div className="money-input"><input id={id+"amount"} value={amount} inputMode="decimal" maxLength={12} onChange={e=>{invalidate();setAmount(e.target.value);}} required/><span>₽</span></div></div><div><label className="field-label" htmlFor={id+"steam"}>Steam ID <span>17 цифр</span></label><input className="text-input" id={id+"steam"} value={steamId} inputMode="numeric" maxLength={17} placeholder="7656119…" onChange={e=>{invalidate();setSteamId(e.target.value);}} required/></div></div>
    <div className="amount-presets">{[500,1000,2000,5000].map(n=><button type="button" key={n} className={minor===n*100?"selected":""} onClick={()=>{invalidate();setAmount(String(n));}}>{n.toLocaleString("ru-RU")} ₽</button>)}</div>
    <dl className="steam-summary"><div><dt>На Steam</dt><dd>{quote?formatMinor(quote.amount):"—"} ₽</dd></div><div><dt>Комиссия <span className="pink">5%</span></dt><dd>{quote?formatMinor(quote.fee):"—"} ₽</dd></div></dl>
    {profile&&<p className="profile-found"><Icon name="check" size={17}/>{profile.name} · аккаунт найден</p>}
    </div><div className="topup-total"><span>К оплате</span><strong>{quote?formatMinor(quote.total):"—"} ₽</strong></div>
    <div className="topup-form-action"><button className="button primary full" disabled={busy} type="submit">{busy?"Проверяем аккаунт…":profile?"Перейти к оплате":"Проверить Steam ID"}<Icon name="arrow"/></button>{message&&<p className="form-message" role="status">{message}</p>}</div>
  </form>;
}
export function Topups(){
  return <section className="section topup-section" id="topups" aria-labelledby="topup-heading"><div className="section-heading"><span className="eyebrow">ПЛАТЕЖИ</span><h2 id="topup-heading">Два способа пополнения</h2><span className="topup-heading-note">Steam отдельно от баланса магазина.</span></div><div className="topup-grid"><article className="topup-panel steam-panel" id="steam"><div className="topup-title"><Icon name="steam" size={32}/><span className="eyebrow">STEAM</span></div><h3>Пополнение Steam</h3><p className="muted">Зачисление на аккаунт Steam.<br/>Комиссия 5% включена в итог.</p><SteamForm/></article><article className="topup-panel" id="balance"><div className="topup-title"><Icon name="wallet" size={32}/><span className="eyebrow">БАЛАНС МАГАЗИНА</span></div><h3>Баланс Shards</h3><p className="muted">Для оплаты предметов в каталоге.<br/>1 ₽ = 1,6 Shards.</p><BalanceForm/></article></div></section>;
}
