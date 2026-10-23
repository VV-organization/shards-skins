import {ApiClient,ApiError,api} from './api';
import type {ApiResponses} from '@/generated/api-types';

export type PaymentSession=ApiResponses['/payments/sessions/{id}']['get'];

export async function checkPaymentSession(id:string,signal?:AbortSignal):Promise<PaymentSession>{
 const path=`/payments/sessions/${encodeURIComponent(id)}/check`;
 try{return await api.post<PaymentSession>(path,{}, {signal});}catch(error){
  if(!(error instanceof ApiError)||![401,404].includes(error.status))throw error;
  // A return page can be loaded in a fresh JS context. Restore the existing
  // guest's CSRF without creating a new guest or losing its command journal.
  const context=await guestApi.get<{id:string;csrfToken:string}>('/payments/guest/context',{signal});
  signal?.throwIfAborted();
  guestApi.setContext(`guest:${context.id}`,context.csrfToken);
  return guestApi.post<PaymentSession>(path.replace('/payments/sessions/','/payments/guest/steam-refill/sessions/'),{}, {signal});
 }
}

// Customer login/logout must not discard an uncertain guest payment command.
export const guestApi=new ApiClient();
let contextRequest:Promise<string>|null=null;
export function guestPaymentContext():Promise<string>{
 if(!contextRequest)contextRequest=guestApi.post<{id:string;csrfToken:string}>('/payments/guest/context',{}, {anonymous:true}).then(context=>{
  if(typeof context.id!=='string'||typeof context.csrfToken!=='string')throw new Error('Не удалось открыть форму оплаты');
  guestApi.setContext(`guest:${context.id}`,context.csrfToken);return context.id;
 }).finally(()=>{contextRequest=null;});
 return contextRequest;
}

export const paymentStatusApi:Pick<ApiClient,'get'>={
 async get<T>(path:string,options:Parameters<ApiClient['get']>[1]){
  try{return await api.get<T>(path,options);}catch(error){
   if(!(error instanceof ApiError)||![401,404].includes(error.status))throw error;
   return guestApi.get<T>(path.replace('/payments/sessions/','/payments/guest/steam-refill/sessions/'),options);
  }
 },
};
