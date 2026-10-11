import {Suspense} from 'react';
import {PaymentStatus} from '@/components/payment-status';
export const metadata={title:'Статус платежа'};
export default function Page(){return <Suspense fallback={<p role="status">Загружаем платёж…</p>}><PaymentStatus/></Suspense>;}
