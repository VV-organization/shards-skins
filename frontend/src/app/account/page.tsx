import {Suspense} from "react";
import {AccountView} from "@/components/account-view";
export const metadata={title:"Личный кабинет"};
export default function Page(){return <Suspense fallback={<p role="status">Загружаем кабинет…</p>}><AccountView/></Suspense>;}
