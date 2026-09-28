import Link from "next/link";
import {notFound} from "next/navigation";
import {getCatalog} from "@/lib/catalog";
import {ProductDetails,ProductCard} from "@/components/products";
export function generateStaticParams(){return getCatalog().products.map(product=>({id:product.id}));}
type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props){const {id}=await params;const product=getCatalog().products.find(p=>p.id===id);return {title:product?.name??"Скин не найден"};}
export default async function Page({params}:Props){const {id}=await params;const catalog=getCatalog();const product=catalog.products.find(p=>p.id===id);if(!product)notFound();return <div className="page-container detail-page"><nav className="breadcrumbs" aria-label="Хлебные крошки"><Link href="/">Главная</Link><span>/</span><Link href="/catalog">Каталог</Link><span>/</span><span>{product.name}</span></nav><ProductDetails product={product}/><section className="section"><div className="section-heading"><h2>Ещё в твоём стиле</h2><Link className="text-link" href={`/catalog?category=${product.categoryId}`}>Вся категория ↗</Link></div><div className="product-grid">{catalog.products.filter(p=>p.categoryId===product.categoryId&&p.id!==id).slice(0,4).map(p=><ProductCard key={p.id} product={p}/>)}</div></section></div>;}
