"use client";
import {useLayoutEffect,useRef,type ReactNode} from "react";

type Role="scene"|"backdrop"|"heading"|"image"|"icon"|"surface"|"control"|"text"|"layer";
type Entrance={element:Element;role:Role;animation:Animation|null;played:boolean;shown:boolean;delay:number};
const scopeSelector=".site-header, main, .shards-footer, .modal, .cart-notice";
const ignored="script,style,link,meta,br,option,optgroup,source,track,template,noscript,.sr-only,.skip-link,[data-motion-ignore]";

function hasPaint(style:CSSStyleDeclaration){
  return style.backgroundImage!=="none"||
    !["transparent","rgba(0, 0, 0, 0)"].includes(style.backgroundColor)||
    style.boxShadow!=="none"||
    [style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth].some(v=>parseFloat(v)>0);
}
// Classify painted objects, rather than maintain a partial list of component names.
// Transparent layout wrappers and the individual paths inside an SVG are not objects.
function objectRole(element:Element):Role|null{
  if(element.matches(ignored)||element.closest(".sr-only,[data-motion-ignore]")||
    (element instanceof SVGElement&&!(element instanceof SVGSVGElement)))return null;
  const style=getComputedStyle(element);
  if(element.matches(".hero-art"))return "scene";
  if(element.matches(".hero,.hero-shade,.content-gradient"))return "backdrop";
  if(element.matches(".footer-echo,.footer-main-word"))return "layer";
  if(element.matches("h1,h2,h3,h4,h5,h6"))return "heading";
  if(element.matches("img,video,canvas,iframe,.profile-avatar,.account-guest-art"))return "image";
  if(element.matches("svg,.hero-symbol,.footer-spark,.duo-plus"))return "icon";
  if(element.matches("button,a,input,select,textarea,summary"))return "control";
  const ownText=Array.from(element.childNodes).some(n=>n.nodeType===Node.TEXT_NODE&&Boolean(n.textContent?.trim()));
  if(ownText)return "text";
  const pseudo=["::before","::after"].some(p=>{
    const s=getComputedStyle(element,p);
    return s.content!=="none"&&s.content!=="normal"&&(hasPaint(s)||s.content!=='""');
  });
  if(hasPaint(style)||pseudo)return "surface";
  return null;
}

function frames(entry:Entrance):Keyframe[]{
  const base=getComputedStyle(entry.element);
  const end:Keyframe={opacity:base.opacity,translate:base.translate,scale:base.scale,rotate:base.rotate,filter:base.filter,clipPath:base.clipPath==="none"?"inset(0px)":base.clipPath};
  const blur=(n:number)=>`blur(${n}px)${base.filter==="none"?"":` ${base.filter}`}`;
  let start:Keyframe={...end,opacity:0};
  switch(entry.role){
    case "scene":start={...start,scale:"1.09",filter:blur(12),clipPath:"inset(5% 3% 5% 3%)"};break;
    case "backdrop":break;
    case "heading":start={...start,translate:"0 55%",filter:blur(8),clipPath:"inset(0 0 100% 0)"};break;
    case "image":start={...start,translate:"0 28px",scale:".88",rotate:"-3deg",filter:blur(7)};break;
    case "icon":start={...start,translate:entry.element.closest(".shards-select-arrow,.scroll-link,.back-top,.hero-skin-controls button,.icon-button,.add-button,.favorite-button")?"0 0":"0 16px",scale:".55",rotate:"-18deg",filter:blur(4)};break;
    case "layer":start={...start,translate:"0 90px",scale:".94",rotate:"-3deg",filter:blur(9)};break;
    case "surface":start={...start,translate:"0 25px",scale:".97"};break;
    case "control":start={...start,translate:"0 18px",scale:".96",filter:blur(3)};break;
    case "text":start={...start,translate:"0 60%",filter:blur(5)};break;
  }
  return [start,end];
}
const durations:Record<Role,number>={scene:1450,backdrop:1050,heading:1150,image:1100,icon:850,layer:1400,surface:950,control:800,text:900};

export function MotionRoot({children}:{children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const root=ref.current;if(!root)return;
    const preference=matchMedia("(prefers-reduced-motion: reduce)");
    const entries=new Map<Element,Entrance>();
    let scanFrame=0,viewFrame=0,disposed=false;
    const shown=(element:Element)=>{
      const style=getComputedStyle(element);
      return element.getClientRects().length>0&&style.visibility!=="hidden"&&style.visibility!=="collapse";
    };
    const prepare=(entry:Entrance)=>{
      if(entry.animation||entry.played||preference.matches||!entry.shown)return;
      entry.animation=entry.element.animate(frames(entry),{
        duration:durations[entry.role],delay:entry.delay,fill:"both",easing:"cubic-bezier(.16,1,.3,1)",
      });
      entry.animation.id=`shards-enter:${entry.role}`;
      entry.animation.pause();entry.animation.currentTime=0;
      entry.animation.onfinish=()=>{
        // Release all animated properties: product zoom, hover, disabled opacity and
        // footer pointer movement must retain their original styles after arrival.
        entry.animation?.cancel();entry.animation=null;
      };
    };
    const play=(entry:Entrance)=>{
      if(entry.played||!entry.shown)return;
      prepare(entry);entry.played=true;entry.animation?.play();
    };
    const reveal=()=>{
      viewFrame=0;
      if(disposed||preference.matches)return;
      for(const entry of entries.values()){
        if(entry.played||!entry.shown)continue;
        const r=entry.element.getBoundingClientRect();
        if(r.top<innerHeight*.98&&r.bottom>0&&r.left<innerWidth&&r.right>0)play(entry);
      }
    };
    const scheduleView=()=>{if(!viewFrame)viewFrame=requestAnimationFrame(reveal);};
    const observer=new IntersectionObserver(items=>{
      for(const item of items){const entry=entries.get(item.target);if(entry&&item.isIntersecting)play(entry);}
    },{threshold:0,rootMargin:"0px 0px -2% 0px"});
    const scan=()=>{
      scanFrame=0;if(disposed||preference.matches)return;
      for(const [element,entry] of entries){
        if(!element.isConnected){entry.animation?.cancel();observer.unobserve(element);entries.delete(element);continue;}
        const visible=shown(element);
        if(!visible&&entry.shown){entry.animation?.cancel();entry.animation=null;entry.played=false;}
        entry.shown=visible;
      }
      const objects=root.querySelectorAll(`${scopeSelector}, :is(${scopeSelector}) *`);
      for(const element of objects){
        let entry=entries.get(element);
        if(!entry){
          const role=objectRole(element);if(!role)continue;
          const siblings=element.parentElement?Array.from(element.parentElement.children):[];
          const order=siblings.indexOf(element);
          const structural=role==="surface"||role==="backdrop"||role==="scene";
          const delay=element.matches("dialog")?0:structural?Math.min(Math.max(order,0),2)*45:Math.min(Math.max(order,0),5)*65;
          entry={element,role,animation:null,played:false,shown:shown(element),delay};
          entries.set(element,entry);observer.observe(element);
        }
        prepare(entry);
      }
      scheduleView();
    };
    const scheduleScan=()=>{if(!scanFrame)scanFrame=requestAnimationFrame(scan);};
    const mutations=new MutationObserver(records=>{
      for(const record of records){
        // A carousel or selector can replace an image while retaining the DOM node.
        if(record.type==="attributes"&&record.attributeName==="src"){
          const entry=entries.get(record.target as Element);
          if(entry){entry.animation?.cancel();entry.animation=null;entry.played=false;}
        }
      }
      scheduleScan();
    });
    const onPreference=()=>{
      if(preference.matches){for(const entry of entries.values())entry.animation?.cancel();entries.clear();observer.disconnect();}
      else scheduleScan();
    };
    const onFocus=(event:FocusEvent)=>{
      // Keyboard navigation never waits for the visual sequence.
      let element=event.target as Element|null;
      while(element&&element!==root){const entry=entries.get(element);if(entry){entry.played=true;entry.animation?.cancel();entry.animation=null;}element=element.parentElement;}
    };
    scan();
    root.removeAttribute("data-motion-boot");
    mutations.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["class","open","hidden","src"]});
    window.addEventListener("scroll",scheduleView,{passive:true});
    root.addEventListener("scroll",scheduleView,{passive:true,capture:true});
    window.addEventListener("resize",scheduleScan,{passive:true});
    root.addEventListener("focusin",onFocus);
    preference.addEventListener("change",onPreference);
    return ()=>{
      disposed=true;mutations.disconnect();observer.disconnect();cancelAnimationFrame(scanFrame);cancelAnimationFrame(viewFrame);
      for(const entry of entries.values())entry.animation?.cancel();
      window.removeEventListener("scroll",scheduleView);root.removeEventListener("scroll",scheduleView,true);
      window.removeEventListener("resize",scheduleScan);root.removeEventListener("focusin",onFocus);preference.removeEventListener("change",onPreference);
    };
  },[]);
  return <div ref={ref} className="motion-root" data-motion-boot=""><noscript><style>{`.motion-root[data-motion-boot]{opacity:1!important}`}</style></noscript>{children}</div>;
}

// The root director owns entrances; these wrappers preserve existing page markup.
export function Reveal({children,className=""}:{children:ReactNode;className?:string}){return <div className={className}>{children}</div>;}
export function RevealText({text}:{text:string}){return <span key={text} className="reveal-text">{text}</span>;}
