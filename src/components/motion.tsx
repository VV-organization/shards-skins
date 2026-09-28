"use client";
import {useEffect,useRef,type ReactNode} from "react";
export function Reveal({children,className=""}:{children:ReactNode;className?:string}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=ref.current;if(!node||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const observer=new IntersectionObserver(entries=>{if(entries[0].isIntersecting){node.animate([{opacity:0,transform:"translateY(18px)"},{opacity:1,transform:"translateY(0)"}],{duration:550,easing:"cubic-bezier(.2,.65,.3,1)"});observer.disconnect();}},{threshold:.08});
    observer.observe(node);return ()=>observer.disconnect();
  },[]);
  return <div ref={ref} className={className}>{children}</div>;
}
export function RevealText({text}:{text:string}){
  return <span key={text} className="reveal-text">{text}</span>;
}
