"use client";
import {useState,useEffect,useEffectEvent} from "react";
import Image from "next/image";
import Link from "next/link";
import {sumPrices,formatMinor} from "@/lib/money";
import {api,ApiError} from "@/lib/api";
import {useQuote} from "@/lib/use-quote";
import {skinShortfall} from "@/lib/commerce-status";
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
  async function checkout(){
    if(!shop.user?.steam.connected){shop.login();return;}
    if(!pending&&(!pricing.quote||pricing.expired)){pricing.refresh();return;}
    setBusy(true);setMessage("");
    try{await api.command('checkout','POST','/checkout/cart',pending?.body??{quoteId:pricing.quote!.id,cartVersion:shop.cartVersion});await shop.refreshCart();shop.refreshWallet();router.push('/account?tab=orders');}
    catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;setMessage(error instanceof ApiError&&error.status===409?'Условия изменились. Обновите расчёт и проверьте корзину.':'Не удалось получить результат покупки. Повторите проверку — повторного списания не будет.');if(error instanceof ApiError&&error.status<500){pricing.refresh();void shop.refreshCart().catch(()=>{});shop.refreshWallet();}}
    finally{setBusy(false);}
  }
  return <div className="page-container cart-page"><div className="page-heading"><div><span className="eyebrow">ОФОРМЛЕНИЕ ПОКУПКИ</span><h1>Корзина<sup>{shop.cart.length.toString().padStart(2,"0")}</sup></h1></div><Link className="text-link" href="/catalog">Вернуться в каталог <Icon name="arrow"/></Link></div>{shop.sessionLoading||shop.cartLoading&&!shop.cart.length?<p className="muted" role="status">Загружаем корзину…</p>:!shop.cart.length?<EmptyInventory/>:<div className="cart-layout"><div className="cart-items"><div className="cart-stage-label"><span>ПРЕДМЕТЫ</span><span>СОСТАВ КОРЗИНЫ</span></div>{shop.cart.map((product,index)=><article className="cart-item" key={product.id}><span className="cart-item-index">{String(index+1).padStart(2,"0")}</span><Link className="cart-image" href={`/catalog/${product.id}`}><Image src={product.imageUrl} alt={product.name} width={240} height={180}/></Link><div className="cart-item-name"><span className="weapon-name">{product.weapon}</span><h2><Link href={`/catalog/${product.id}`}>{product.finish}</Link></h2><p>{product.condition}{product.availability!=="available"?" · Недоступен":""}</p></div><Price minor={product.priceMinor} unpriced={product.priceMinor<=0}/><button className="icon-button remove-button" disabled={shop.cartLoading} aria-label={`Удалить ${product.name}`} onClick={()=>{shop.remove(product.id);setMessage("");}}><Icon name="trash"/></button></article>)}<div className="delivery-note"><Icon name="link"/><div><h3>Получение через Steam</h3><p>{shop.tradeConfigured?"Trade-URL сохранён. Его можно изменить в кабинете.":"Для получения предметов требуется ссылка на обмен Steam."}</p><Link href="/account?trade=1&returnTo=cart" className="text-link">{shop.tradeConfigured?"Изменить trade-URL":"Добавить trade-URL"} <Icon name="diagonal" size={16}/></Link></div></div></div><aside className="order-summary"><span className="eyebrow">ОПЛАТА</span><h2>Сумма заказа<span className="arrow-slot"><Icon name="diagonal" size={18}/></span></h2><div className="summary-line"><span>Скины</span><span>{shop.cart.length} шт.</span></div><fieldset className="checkout-method"><legend>Способ оплаты</legend><label className="selected"><input type="radio" name="checkout-method" checked readOnly/>Баланс Shards</label></fieldset>{shop.wallet?<p className="fine-print">Доступно {formatMinor(shop.wallet.availableCoinMinor)} Shards · В обработке {formatMinor(shop.wallet.heldCoinMinor)} Shards</p>:<p className="fine-print">{shop.walletError||"Загружаем баланс…"}</p>}<div className="receipt-tear" aria-hidden="true"/><div className="order-total"><span>Итого</span><strong>{formatMinor(total)} <small>Shards</small></strong><span>≈ {formatMinor(pricing.quote?.totalRubMinor??totals.rub)} ₽</span><small className="total-rounding">Рублёвый итог рассчитан по общей сумме Shards.</small></div>{shortfall?.missing&&!pending?<p className="form-message">Не хватает {formatMinor(shortfall.missing)} Shards. {shortfall.topUp?<Link className="text-link" href={`/account?tab=balance&amount=${shortfall.topUp/100}&returnTo=cart`}>Пополнить баланс</Link>:"Сумма превышает лимит одного пополнения — 100 000 Shards."}</p>:null}<button className="button primary full" disabled={busy||(!pending&&!!shop.user?.steam.connected&&(!shop.tradeConfigured||!shop.config?.capabilities.checkoutEnabled||!shop.wallet||!!shortfall?.missing||pricing.loading))} onClick={()=>void checkout()}>{busy?"Проверяем покупку…":pending?"Проверить результат покупки":!shop.user?.steam.connected?"Войти и продолжить":!pricing.quote||pricing.expired?"Обновить расчёт":"Купить скины"}<Icon name="arrow"/></button>{!shop.config?.capabilities.checkoutEnabled&&<p className="form-message">Покупки временно недоступны.</p>}{(message||pricing.error||shop.cartError)&&<p className="form-message" role="status">{message||pricing.error||shop.cartError}</p>}<div className="payment-row"><span>К оплате</span><b>Shards</b></div></aside></div>}</div>;
}
