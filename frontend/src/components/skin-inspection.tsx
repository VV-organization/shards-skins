"use client";
import Image from "next/image";
import {useId,useRef,useState,type PointerEvent} from "react";
import type {Product} from "@/lib/types";
import {conditionCode} from "@/lib/filters";
import {Icon} from "./icon";

export function SkinInspection({product}:{product:Product}) {
  const [surface,setSurface]=useState("plum");
  const [zoom,setZoom]=useState(1);
  const imageRef=useRef<HTMLDivElement>(null);
  const id=useId();
  function inspect(event:PointerEvent<HTMLDivElement>) {
    if(zoom===1||event.pointerType==="touch"||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const bounds=event.currentTarget.getBoundingClientRect();
    imageRef.current?.style.setProperty("--inspect-x",`${(event.clientX-bounds.left)/bounds.width*100}%`);
    imageRef.current?.style.setProperty("--inspect-y",`${(event.clientY-bounds.top)/bounds.height*100}%`);
  }
  return <section className={`inspection inspection-${surface}`} aria-label="Осмотр скина">
    <div className="inspection-top"><span>PRM / INSPECT</span><span>{conditionCode(product.condition)} <span className="inspection-cross">+</span></span></div>
    <div className="inspection-viewport" onPointerMove={inspect} onPointerLeave={()=>{imageRef.current?.style.setProperty("--inspect-x","50%");imageRef.current?.style.setProperty("--inspect-y","50%");}}><span className="inspection-word" aria-hidden="true">{product.weapon}</span><div className="inspection-object" ref={imageRef} style={{transform:`scale(${zoom})`}}><Image src={product.imageUrl} alt={product.name} width={1100} height={850} loading="eager" fetchPriority="high"/></div><span className="inspection-corner corner-one" aria-hidden="true"/><span className="inspection-corner corner-two" aria-hidden="true"/></div>
    <div className="inspection-tools"><div className="inspection-surfaces" role="group" aria-label="Фон осмотра">{[["plum","Графитовый"],["light","Светлый"],["dark","Тёмный"]].map(([value,name])=><button key={value} className={`surface-${value}`} aria-label={`${name} фон`} aria-pressed={surface===value} onClick={()=>setSurface(value)}/>)}</div><div className="inspection-zoom"><label htmlFor={id}>Масштаб</label><input id={id} type="range" min="1" max="1.7" step="0.1" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><output htmlFor={id}>{Math.round(zoom*100)}%</output><button className="icon-button" aria-label="Сбросить масштаб" onClick={()=>setZoom(1)}><Icon name="swap" size={17}/></button></div></div>
    <div className="inspection-bottom"><span>ИЗОБРАЖЕНИЕ ПРЕДМЕТА</span><span>{product.stattrak?"STATTRAK™":"COUNTER-STRIKE 2"}</span></div>
  </section>;
}
