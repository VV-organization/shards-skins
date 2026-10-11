import {topUpForShortfall} from './money.ts';
export function balanceCoverage(total:number,available:number){return {percent:total>0?Math.floor(Math.min(1,Math.max(0,available)/total)*100):0,remaining:Math.max(0,available-total)};}
export function skinShortfall(total:number,available:number){const missing=Math.max(0,total-available);return {missing,topUp:missing?topUpForShortfall(missing):null};}
export function paymentMessage(purpose:string,payment:string,fulfillment:string){
 if(payment==='paid'){
  if(purpose==='wallet_topup')return 'Баланс Shards пополнен';
  if(fulfillment==='delivered')return 'Баланс Steam пополнен';
  if(fulfillment==='failed'||fulfillment==='manual_review')return 'Оплата получена. Пополнение требует проверки; статус возврата уточняется.';
  return 'Оплата получена. Пополнение Steam выполняется.';
 }
 if(payment==='failed')return 'Платёж не завершён';
 if(payment==='manual_review')return 'Проверяем результат платежа';
 if(payment==='provider_configuration_required')return 'Пополнение временно недоступно';
 return 'Ожидаем подтверждение платежа';
}
export const orderLabels:Record<string,string>={held:'Выполняется',fulfilled:'Доставлен',partially_fulfilled:'Доставлен частично',failed:'Не выполнен',manual_review:'На проверке'};
export const lineLabels:Record<string,string>={pending:'Ожидает отправки',trade_offer_sent:'Обмен отправлен',trade_protection:'Ожидает окончания защиты обмена',delivered:'Доставлен',failed:'Не доставлен',needs_review:'На проверке'};
