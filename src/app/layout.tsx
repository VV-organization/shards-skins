import type {Metadata} from 'next';
import localFont from 'next/font/local';
import {getCatalog} from '@/lib/catalog';
import {ShopProvider} from '@/components/shop-provider';
import {Header,Footer} from '@/components/shell';
import {QuickView} from '@/components/products';
import './globals.css';
const onest=localFont({src:'../../public/fonts/Onest.ttf',variable:'--font-onest',display:'swap',weight:'100 900'});
export const metadata:Metadata={title:{default:'Shards — скины в другом свете',template:'%s — Shards'},description:'Скины CS2, пополнение Steam и карты Apple. Соберите свой дуэт и сравните предметы.',icons:{icon:`${process.env.NEXT_PUBLIC_BASE_PATH??''}/favicon.svg`}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru" data-scroll-behavior="smooth" className={onest.variable}><body><ShopProvider catalog={getCatalog()}><Header/><main id="main">{children}</main><Footer/><QuickView/></ShopProvider></body></html>;}
