"use client";
import {useEffect,useRef,type ReactNode} from "react";
import {Icon} from "./icon";
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current; const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow="hidden";
    return ()=>{ dialog?.close(); document.body.style.overflow=overflow; previous?.focus(); };
  },[]);
  return <dialog ref={ref} className={`modal ${wide?"modal-wide":""}`} aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal-inner"><button className="icon-button modal-close" aria-label="Закрыть" onClick={onClose}><Icon name="close"/></button>{children}</div>
  </dialog>;
}
