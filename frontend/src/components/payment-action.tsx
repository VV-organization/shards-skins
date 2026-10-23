'use client';
import {useEffect,useRef,useState} from 'react';
import {checkPaymentSession,type PaymentSession} from '@/lib/guest-payment';
import {submitHostedCheckout} from '@/lib/hosted-checkout';
import {paymentMessage} from '@/lib/commerce-status';
import {useShop} from './shop-provider';

type PaymentActionProps={id:string;pay?:boolean;onChecked?:(session:PaymentSession)=>void};
export function PaymentAction(props:PaymentActionProps){
 const owner=useShop().user?.id??'guest';
 return <ScopedPaymentAction key={JSON.stringify([props.id,owner])} {...props}/>;
}
function ScopedPaymentAction({id,pay=true,onChecked}:PaymentActionProps){
 const shop=useShop();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>{request.current?.abort();},[]);
 async function check(){
  if(request.current)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
  try{
   const session=await checkPaymentSession(id,controller.signal);
   controller.signal.throwIfAborted();
   if(session.id!==id||typeof session.canPay!=='boolean')throw new Error('Invalid payment response');
   if(session.purpose==='wallet_topup'&&session.paymentStatus==='paid')shop.refreshWallet();
   if(pay&&session.canPay&&session.paymentStatus==='checkout_pending'&&session.checkoutUrl){
    submitHostedCheckout(session.checkoutUrl,id);return;
   }
   onChecked?.(session);
   if(pay)setMessage(paymentMessage(session.purpose,session.paymentStatus,session.fulfillmentStatus,session));
  }catch{
   if(!controller.signal.aborted)setMessage('Не удалось проверить платёж. Повторите проверку позже.');
  }finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 return <div><button type="button" className={pay?'button primary':'text-link'} disabled={busy} onClick={()=>void check()}>{busy?'Проверяем платёж…':pay?'Оплатить':'Обновить статус'}</button>{message&&<p className="form-message" role="status">{message}</p>}</div>;
}
