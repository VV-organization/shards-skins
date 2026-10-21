import {ApiClient,ApiError,api} from './api';

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
