"use client";
import {useState} from "react";
import Image from "next/image";
import Link from "next/link";
import type {Product} from "@/lib/types";
import {Icon} from "./icon";
import {ShardsSelect} from "./shards-select";
import {Price} from "./price";
import {useShop} from "./shop-provider";

export function SkinCompare({products}:{products:Product[]}) {
  const shop=useShop();
  const weapons=[...new Set(products.map(p=>p.weapon))];
  const [weapon,setWeapon]=useState(weapons.includes("AK-47")?"AK-47":weapons[0]??"");
  const [selectedId,setSelectedId]=useState("");
  const [savedOnly,setSavedOnly]=useState(false);
  const pool=products.filter(p=>savedOnly?shop.favorites.includes(p.id):p.weapon===weapon);
  const selected=pool.find(p=>p.id===selectedId)??pool[0];
  const index=selected?pool.indexOf(selected):0;
  const saved=selected?shop.favorites.includes(selected.id):false;
  const inCart=selected?shop.cart.some(p=>p.id===selected.id):false;
  function step(direction:number) {
    if(pool.length) setSelectedId(pool[(index+direction+pool.length)%pool.length].id);
  }
  return <section className="focus-selection section" id="compare" aria-labelledby="selection-title">
    <header className="selection-heading">
      <div><span className="eyebrow">ЛИЧНЫЙ ОТБОР / SHARDS</span><h2 id="selection-title">В твоём <em>фокусе</em></h2></div>
      <p>Рассмотри. Отложи. Вернись к своему.<br/>Один скин — всё внимание ему.</p>
    </header>
    <div className="selection-toolbar">
      <div className="selection-modes" role="group" aria-label="Режим выбора скинов">
        <button aria-pressed={!savedOnly} onClick={()=>{setSavedOnly(false);setSelectedId("");}}>Все варианты</button>
        <button aria-pressed={savedOnly} onClick={()=>{setSavedOnly(true);setSelectedId("");}}><Icon name="heart" size={16}/>Отложенные <span>{shop.favorites.length}</span></button>
      </div>
      {!savedOnly&&<div className="selection-weapon"><ShardsSelect aria-label="Оружие для личного отбора" value={weapon} onChange={e=>{setWeapon(e.target.value);setSelectedId("");}}>{weapons.map(w=><option key={w} value={w}>{w}</option>)}</ShardsSelect></div>}
    </div>
    {selected?<div className="selection-workspace">
      <div className="selection-stage" role="region" aria-label="Сцена выбора скина" tabIndex={0} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}}}>
        <span className="selection-halo" aria-hidden="true"/>
        <span className="selection-watermark" aria-hidden="true">{selected.weapon}</span>
        <div className="selection-stage-top"><span>CS2 / {selected.stattrak?'STATTRAK™':'SKIN EDITION'}</span><span>{String(index+1).padStart(2,'0')} / {String(pool.length).padStart(2,'0')}</span></div>
        <button className="selection-object" key={selected.id} onClick={()=>shop.setPreviewProduct(selected)} aria-label={`Рассмотреть: ${selected.name}`}><Image src={selected.imageUrl} alt={selected.name} width={1000} height={700} sizes="(max-width: 800px) 90vw, 60vw"/><span className="selection-enlarge"><Icon name="diagonal" size={18}/>Рассмотреть детали</span></button>
        <div className="selection-stage-bottom"><span>Найди то, что цепляет.</span><div className="selection-arrows"><button className="icon-button" aria-label="Предыдущий скин" disabled={pool.length<2} onClick={()=>step(-1)}><Icon name="arrow-left"/></button><button className="icon-button" aria-label="Следующий скин" disabled={pool.length<2} onClick={()=>step(1)}><Icon name="arrow"/></button></div></div>
      </div>
      <div className="selection-details">
        <div key={selected.id} className="selection-product"><span className="eyebrow">{selected.weapon}</span><h3>{selected.finish}</h3><dl className="selection-specs"><div><dt>Состояние</dt><dd>{selected.condition}</dd></div><div><dt>StatTrak™</dt><dd>{selected.stattrak?'Есть':'Нет'}</dd></div></dl><Price minor={selected.priceMinor} unpriced={selected.priceMinor<=0} large/></div>
        <div className="selection-actions"><button className={`button secondary full ${saved?'is-saved':''}`} aria-pressed={saved} onClick={()=>shop.toggleFavorite(selected.id)}><Icon name={saved?'check':'heart'}/>{saved?'Убрать из отложенных':'Отложить скин'}</button>{inCart?<Link href="/cart" className="button primary full" onClick={shop.dismissNotice}>Перейти в корзину <Icon name="arrow"/></Link>:<button className="button primary full" disabled={selected.availability!=="available"} onClick={()=>shop.add(selected)}>В корзину <Icon name="plus"/></button>}<Link className="selection-detail-link" href={`/catalog/${selected.id}`}>Подробнее о скине <Icon name="diagonal" size={16}/></Link></div>
      </div>
    </div>:<div className="selection-empty"><Icon name="heart" size={36}/><h3>Место для твоих фаворитов</h3><p>Откладывай понравившиеся скины — они останутся здесь и после возвращения на сайт.</p><button className="button primary" onClick={()=>setSavedOnly(false)}>Смотреть варианты <Icon name="arrow"/></button></div>}
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{selected?`${selected.weapon}, ${selected.finish}. ${index+1} из ${pool.length}.${saved?' В отложенных.':''}`:'Отложенных скинов пока нет.'}</span>
    <div className="selection-footnote"><span>01 — Листай варианты</span><span>02 — Сохраняй в отложенные</span><span>03 — Возвращайся к своему</span></div>
  </section>;
}
