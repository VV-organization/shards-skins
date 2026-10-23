"use client";
import {useState,useEffect,useEffectEvent} from "react";
import Image from "next/image";
import Link from "next/link";
import {sumPrices,formatMinor,shardsToRub} from "@/lib/money";
import {api,ApiError} from "@/lib/api";
import {useQuote} from "@/lib/use-quote";
import {skinShortfall,balanceCoverage} from "@/lib/commerce-status";
import type {ApiResponses} from "@/generated/api-types";
import {useRouter} from "next/navigation";
import {useShop} from "./shop-provider";
import {Price} from "./price";
import {Icon} from "./icon";
import {EmptyInventory} from "./empty-inventory";
export function CartView(){
  const shop=useShop(),router=useRouter();const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const totals=sumPrices(shop.cart.map(p=>p.priceMinor));
  const enter=useEffectEvent(()=>{if(shop.user?.steam.connected){shop.refreshWallet();void shop.refreshCart().catch(()=>setMessage('Не удалось обновить корзину. Перезагрузите страницу.'));}});
  useEffect(()=>{enter();},[shop.user?.id]);
  const pending=api.pendingCommand('checkout');
  const pricing=useQuote<ApiResponses["/checkout/quotes"]["post"]>("/checkout/quotes",{cartVersion:shop.cartVersion},shop.user?.id??null,!!shop.user?.steam.connected&&shop.tradeConfigured&&shop.cart.length>0&&!shop.cartLoading&&!!shop.config?.capabilities.checkoutEnabled);
  const total=pricing.quote?.totalCoinMinor??totals.shards;
  const shortfall=shop.wallet?skinShortfall(total,shop.wallet.availableCoinMinor):null;
  const coverage=balanceCoverage(total,shop.wallet?.availableCoinMinor??0);
  async function checkout(){
    if(!shop.user?.steam.connected){shop.login();return;}
    if(!pending&&(!pricing.quote||pricing.expired)){pricing.refresh();return;}
    setBusy(true);setMessage("");
    try{await api.command<{id:string}>('checkout','POST','/checkout/cart',pending?.body??{quoteId:pricing.quote!.id,cartVersion:shop.cartVersion},result=>typeof result?.id==='string'&&!!result.id);void shop.refreshCart().catch(()=>{});shop.refreshWallet();router.push('/account?tab=orders');}
    catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;setMessage(error instanceof ApiError&&error.status===409?'Условия изменились. Обновите расчёт и проверьте корзину.':'Не удалось получить результат покупки. Повторите проверку — повторного списания не будет.');if(error instanceof ApiError&&error.status<500){pricing.refresh();void shop.refreshCart().catch(()=>{});shop.refreshWallet();}}
    finally{setBusy(false);}
  }
  return <div className="page-container cart-page"><div className="page-heading"><div><span className="eyebrow">ОФОРМЛЕНИЕ ПОКУПКИ</span><h1>Корзина<sup>{shop.cart.length}</sup></h1></div><Link className="text-link" href="/catalog">Вернуться в каталог <Icon name="arrow"/></Link></div>{shop.sessionLoading||shop.cartLoading&&!shop.cart.length?<p className="muted" role="status">Загружаем корзину…</p>:!shop.cart.length?pending?<section className="account-panel"><p className="form-message" role="status">{message||"Проверяем ранее отправленную покупку"}</p><button className="button primary" disabled={busy} onClick={()=>void checkout()}>{busy?"Проверяем покупку…":"Проверить результат покупки"}</button><Link className="text-link" href="/account?tab=orders">История заказов</Link></section>:<EmptyInventory/>:<div className="cart-layout"><div className="cart-items"><div className="cart-stage-label"><span>ПРЕДМЕТЫ</span><span>СОСТАВ КОРЗИНЫ</span></div>{shop.cart.map((product,index)=><article className="cart-item" key={product.id}><span className="cart-item-index">{String(index+1).padStart(2,"0")}</span><Link className="cart-image" href={`/catalog/${product.id}`}><Image src={product.imageUrl} alt={product.name} width={240} height={180}/></Link><div className="cart-item-name"><span className="weapon-name">{product.weapon}</span><h2><Link href={`/catalog/${product.id}`}>{product.finish}</Link></h2><p>{product.condition}{product.availability!=="available"?" · Недоступен":""}</p></div><Price minor={product.priceMinor} unpriced={product.priceMinor<=0}/><button className="icon-button remove-button" disabled={shop.cartLoading} aria-label={`Удалить ${product.name}`} onClick={()=>{shop.remove(product.id);setMessage("");}}><Icon name="trash"/></button></article>)}<div className="delivery-note"><Icon name="link"/><div><h3>Получение через Steam</h3><p>{shop.tradeConfigured?"Trade-URL сохранён. Его можно изменить в кабинете.":"Для получения предметов требуется ссылка на обмен Steam."}</p><Link href="/account?trade=1&returnTo=cart" className="text-link">{shop.tradeConfigured?"Изменить trade-URL":"Добавить trade-URL"} <Icon name="diagonal" size={16}/></Link></div></div></div><aside className="order-summary vv162-summary">
  <span className="eyebrow">ВАШ ЗАКАЗ</span><h2>Сумма заказа<span className="arrow-slot"><Icon name="diagonal" size={18}/></span></h2>
  <div className="summary-line"><span>Скины</span><span>{shop.cart.length} шт.</span></div>
  <section className="cart-wallet" aria-label="Оплата с баланса Shards">
    <div className="cart-wallet-title"><Icon name="wallet"/><span>Оплата с баланса Shards</span></div>
    {shop.wallet?<>
      <div className="cart-wallet-row"><span>Ваш баланс</span><strong>{formatMinor(shop.wallet.availableCoinMinor)} <small>Shards</small></strong></div>
      {shop.wallet.heldCoinMinor>0&&<p className="fine-print">В обработке {formatMinor(shop.wallet.heldCoinMinor)} Shards</p>}
      <div className="balance-meter" role="progressbar" aria-label="Покрытие суммы заказа" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage.percent}><span style={{width:coverage.percent+"%"}}/></div>
      <p className={shortfall?.missing?"fine-print":"fine-print success"}>{shortfall?.missing?`Баланс покрывает ${coverage.percent}% заказа`:<><Icon name="check" size={16}/> Баланса достаточно</>}</p>
      <div className={"cart-wallet-result"+(shortfall?.missing?" is-short":"")}><span>{shortfall?.missing?"Не хватает":"Останется после покупки"}</span><div><strong>{formatMinor(shortfall?.missing||coverage.remaining)} <small>Shards</small></strong><p>≈ {formatMinor(shardsToRub(shortfall?.missing||coverage.remaining))} ₽</p></div></div>
      {shortfall?.missing?<>{shortfall.topUp?<Link className="button secondary full" href={`/account?tab=balance&amount=${shortfall.topUp/100}&returnTo=cart`}>Пополнить баланс <small aria-hidden="true">картой · СБП</small></Link>:<p className="fine-print">Сумма превышает лимит одного пополнения — 100 000 Shards.</p>}</>:<Link className="text-link" href="/account?tab=balance&returnTo=cart">Пополнить баланс <small aria-hidden="true">картой · СБП</small></Link>}
    </>:<p className="fine-print" role="status">{shop.walletError||"Загружаем баланс…"}</p>}
  </section>
  <div className="order-total"><span>Итого{!pricing.quote?" ≈":""}</span><strong>{formatMinor(total)} <small>Shards</small></strong><span>≈ {formatMinor(pricing.quote?.totalRubMinor??totals.rub)} ₽</span><small className="total-rounding">Курс: 1 ₽ = 1,6 Shards</small></div>
  <button className="button primary full" disabled={busy||(!pending&&!!shop.user?.steam.connected&&(!shop.tradeConfigured||!shop.config?.capabilities.checkoutEnabled||!shop.wallet||!!shortfall?.missing||pricing.loading))} onClick={()=>void checkout()}>{busy?"Проверяем покупку…":pending?"Проверить результат покупки":!shop.user?.steam.connected?"Войти и продолжить":"Купить"}<Icon name="arrow"/></button>
  {!pending&&<p className="fine-print cart-purchase-note">{shortfall?.missing?"Кнопка станет активной, когда на балансе хватит Shards":"Скины придут обменом Steam на ваш trade-URL"}</p>}
  {!shop.config?.capabilities.checkoutEnabled&&<p className="form-message">Покупки временно недоступны.</p>}
  {(message||pricing.error||shop.cartError)&&<p className="form-message" role="status">{message||pricing.error||shop.cartError}</p>}
</aside></div>}</div>;
}
