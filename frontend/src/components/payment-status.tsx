'use client';
import {useEffect,useRef} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import type {ApiResponses} from '@/generated/api-types';
import {useRemote} from '@/lib/use-remote';
import {paymentMessage} from '@/lib/commerce-status';
import {formatMinor} from '@/lib/money';
import {useShop} from './shop-provider';
export function PaymentStatus(){
 const shop=useShop(),params=useSearchParams(),id=params.get('session');
 const valid=!!id&&/^[0-9a-f-]{36}$/i.test(id);
 const result=useRemote<ApiResponses['/payments/sessions/{id}']['get']>(valid&&shop.user?`/payments/sessions/${id}`:null,shop.user?.id??null);
 const reload=result.reload;
 const polls=useRef({key:'',count:0}),data=result.data;
 const refreshWallet=shop.refreshWallet;
 useEffect(()=>{if(data?.purpose==='wallet_topup'&&data.paymentStatus==='paid')refreshWallet();},[data?.purpose,data?.paymentStatus,refreshWallet]);
 useEffect(()=>{
  const key=JSON.stringify([id,shop.user?.id]);if(polls.current.key!==key)polls.current={key,count:0};
  if(!data||polls.current.count>=12||['failed','manual_review','provider_configuration_required'].includes(data.paymentStatus)||data.paymentStatus==='paid'&&(data.purpose==='wallet_topup'||['delivered','failed','manual_review','partial'].includes(data.fulfillmentStatus)))return;
  const timer=setTimeout(()=>{polls.current.count++;reload();},Math.min(20000,2000*2**Math.min(polls.current.count,4)));return()=>clearTimeout(timer);
 },[data,id,shop.user?.id,reload]);
 const needsAuth=!shop.user||result.status===401;
 return <div className="page-container account-page"><div className="page-heading"><h1>Статус платежа</h1></div><section className="account-panel" aria-live="polite">
 {!valid?<p className="form-message">Не указан номер платежа.</p>:shop.sessionLoading?<p>Загружаем сессию…</p>:needsAuth?<><p>Войдите в аккаунт, с которого создан платёж.</p><button className="button primary" onClick={()=>shop.login('steam')}>Войти через Steam</button><button className="text-link" onClick={()=>shop.login('email')}>Войти по почте</button></>:result.status===404||result.status===403?<p className="form-message">Платёж не найден или принадлежит другому аккаунту.</p>:result.loading?<p>Проверяем статус…</p>:result.error?<p className="form-message">{result.error}</p>:data?<><h2>{paymentMessage(data.purpose,data.paymentStatus,data.fulfillmentStatus)}</h2><p>{formatMinor(data.fiatAmountMinor)} ₽</p>{data.steamLogin&&<p>Логин Steam: {data.steamLogin}</p>}{data.refundStatus&&<p>Результат и необходимость возврата проверяет поддержка. Возврат пока не подтверждён.</p>}{data.paymentStatus==='checkout_pending'&&data.checkoutUrl?.startsWith('https://')&&<a className="button primary" href={data.checkoutUrl}>Продолжить оплату</a>}{data.purpose==='wallet_topup'&&data.paymentStatus==='paid'&&<p>Баланс обновлён. Вернитесь в корзину, проверьте сумму и подтвердите покупку.</p>}</>:null}
 {valid&&!needsAuth&&<button className="text-link" onClick={result.reload} disabled={result.loading}>Обновить статус</button>}<p><Link className="text-link" href="/cart">Вернуться в корзину</Link></p><Link className="text-link" href="/account?tab=transactions">История операций</Link>
 </section></div>;
}
