'use client';
import {Icon} from "./icon";

import {useState} from 'react';
import type {Product} from '@/lib/types';
import {ProductCard} from './products';

export function HeroSkinCarousel({products}:{products:Product[]}) {
  const [active,setActive]=useState(0);
  const product=products[active];
  if(!product)return null;
  const move=(direction:number)=>setActive(index=>(index+direction+products.length)%products.length);
  return <div className="hero-skin-strip" role="group" aria-label="Популярные скины в карточках товаров">
    <div className="hero-skin-strip-head"><span>СКИНЫ В ФОКУСЕ</span><span aria-live="polite">{String(active+1).padStart(2,'0')} — {String(products.length).padStart(2,'0')}</span></div>
    <div className="hero-skin-strip-cards">
      <div className="hero-skin-desktop-cards">{products.map(item=><ProductCard key={item.id} product={item}/>)}</div>
      <div className="hero-skin-mobile-card" aria-live="polite"><ProductCard key={product.id} product={product}/></div>
    </div>
    <div className="hero-skin-controls"><button type="button" aria-label="Предыдущий скин" onClick={()=>move(-1)}><Icon name="arrow-left" size={18}/></button><span>{product.name}</span><button type="button" aria-label="Следующий скин" onClick={()=>move(1)}><Icon name="arrow" size={18}/></button></div>
  </div>;
}
