'use client';
import {Icon} from "./icon";
import {Children,isValidElement,useEffect,useId,useRef,useState,type ReactNode,type CSSProperties,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import Image from 'next/image';

type OptionProps={value?:string;children?:ReactNode;'data-image'?:string};
function textOf(node:ReactNode):string{return Children.toArray(node).map(n=>isValidElement<OptionProps>(n)?textOf(n.props.children):String(n)).join('');}
type Props={id?:string;value:string;children:ReactNode;'aria-label'?:string;onChange:(event:{target:{value:string}})=>void;onLoadMore?:()=>void;hasMore?:boolean;loadingMore?:boolean;loadMoreError?:string;onRetryLoadMore?:()=>void};
export function ShardsSelect({id,value,children,onChange,'aria-label':label,onLoadMore,hasMore=false,loadingMore=false,loadMoreError='',onRetryLoadMore}:Props){
 const uid=useId(),listId=`${uid}-list`,button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),typed=useRef({text:'',time:0}),footer=useRef<HTMLButtonElement>(null);
 const options=Children.toArray(children).filter(isValidElement<OptionProps>).map(n=>({value:n.props.value??textOf(n.props.children),label:textOf(n.props.children),image:n.props['data-image']}));
 const selected=Math.max(0,options.findIndex(o=>o.value===value));
 const [open,setOpen]=useState(false),[active,setActive]=useState(selected),[position,setPosition]=useState<CSSProperties>({});
 function show(index=selected){
  const r=button.current?.getBoundingClientRect();if(!r)return;
  const viewportWidth=document.documentElement.clientWidth;
  const width=viewportWidth<520?viewportWidth-24:Math.min(Math.max(r.width,260),viewportWidth-24),below=window.innerHeight-r.bottom-16,above=r.top-16,up=below<240&&above>below;
  setPosition({left:Math.max(12,Math.min(r.left,viewportWidth-width-12)),width,maxHeight:Math.min(380,Math.max(120,up?above:below)),...(up?{bottom:window.innerHeight-r.top+8}:{top:r.bottom+8})});
  setActive(index);setOpen(true);
 }
 function choose(index:number){const item=options[index];if(item){onChange({target:{value:item.value}});setOpen(false);button.current?.focus();}}
 useEffect(()=>{if(!open)return;
  const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setOpen(false);};
  const dismiss=(e:Event)=>{if(!panel.current?.contains(e.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',dismiss);window.addEventListener('scroll',dismiss,true);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss,true);};
 },[open]);
 useEffect(()=>{if(open)panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active,open]);
 function keyDown(e:KeyboardEvent<HTMLButtonElement>){
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
   e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,(open?active:selected)+(e.key==='ArrowDown'?1:-1)));
   if(open){setActive(index);if(e.key==='ArrowDown'&&active===options.length-1&&hasMore&&!loadingMore&&!loadMoreError)onLoadMore?.();}else show(index);
  }else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(active);else show();}
  else if(e.key==='Escape'){e.preventDefault();setOpen(false);}
  else if(e.key==='Tab'){if(open&&!e.shiftKey&&footer.current){e.preventDefault();footer.current.focus();}else setOpen(false);}
  else if(e.key.length===1&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
   const now=e.timeStamp;typed.current={text:(now-typed.current.time<700?typed.current.text:'')+e.key.toLowerCase(),time:now};
   const index=options.findIndex(o=>o.label.toLowerCase().startsWith(typed.current.text));if(index>=0){e.preventDefault();if(open)setActive(index);else show(index);}
  }
 }
 const current=options[selected],parts=current?.label.split(' · ')??[];
 return <span className="shards-select"><button id={id} ref={button} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open?listId:undefined} aria-activedescendant={open?`${uid}-${active}`:undefined} className="shards-select-trigger" onClick={()=>open?setOpen(false):show()} onKeyDown={keyDown}>
  <span className="shards-select-value"><span>{parts[0]}</span>{parts.length>1&&<small>{parts.slice(1).join(' · ')}</small>}</span><span className="shards-select-arrow" aria-hidden="true"><Icon name="chevron" size={16}/></span>
 </button>{open&&createPortal(<div ref={panel} className="shards-select-menu" style={position} onScroll={e=>{const node=e.currentTarget;if(node.scrollHeight-node.scrollTop-node.clientHeight<80&&hasMore&&!loadingMore&&!loadMoreError)onLoadMore?.();}}>
  <div id={listId} role="listbox" aria-label={label??'Варианты выбора'}>
  <div className="shards-select-caption" aria-hidden="true"><span>ВЫБРАТЬ</span><span>{String(options.length).padStart(2,'0')} ВАРИАНТОВ</span></div>
  {options.map((o,i)=>{const parts=o.label.split(' · ');return <div key={o.value} id={`${uid}-${i}`} role="option" aria-selected={o.value===value} data-index={i} data-active={i===active} className="shards-select-option" style={{animationDelay:`${Math.min(i,5)*25}ms`}} onPointerMove={()=>setActive(i)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(i)}>
   {o.image?<span className="shards-select-thumb"><Image src={o.image} alt="" width={100} height={64}/></span>:<span className="shards-select-number" aria-hidden="true">{String(i+1).padStart(2,'0')}</span>}
   <span className="shards-select-value"><span>{parts[0]}</span>{parts.length>1&&<small>{parts.slice(1).join(' · ')}</small>}</span><span className="shards-select-check" aria-hidden="true"><Icon name={o.value===value?"check":"diagonal"} size={18}/></span>
  </div>;})}
  </div>
  {(hasMore||loadingMore||loadMoreError)&&<div className="shards-select-caption"><span role="status">{loadingMore?'Загружаем…':loadMoreError||'Есть ещё варианты'}</span><button ref={footer} className="text-link" type="button" disabled={loadingMore} onClick={()=>loadMoreError?onRetryLoadMore?.():onLoadMore?.()} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}if(e.key==='Tab'&&e.shiftKey){e.preventDefault();button.current?.focus();}}}>{loadMoreError?'Повторить':'Показать ещё'}</button></div>}
 </div>,document.body)}</span>;
}
