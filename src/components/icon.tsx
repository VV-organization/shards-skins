import type {CSSProperties} from "react";
export function Icon({name, size=20, className="", style}:{name:string;size?:number;className?:string;style?:CSSProperties}) {
  const paths:Record<string,React.ReactNode> = {
    heart:<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
    arrow:<><path d="M5 12h14M13 6l6 6-6 6"/></>,
    diagonal:<><path d="M6 18 18 6M6 6h12v12"/></>,
    cart:<><path d="M3 4h2l3 12h10l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    chevron:<path d="m7 10 5 5 5-5"/>,
    swap:<><path d="M4 8h16M16 4l4 4-4 4M20 16H4m4-4-4 4 4 4"/></>,
    steam:<><circle cx="16" cy="7" r="4"/><circle cx="16" cy="7" r="2"/><circle cx="7" cy="17" r="3"/><path d="m2 14 5 3m2-2 4-6m-3 9 7-7"/></>,
    wallet:<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 9V5l13-2v3M16 12h5v5h-5z"/></>,
    filter:<><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6M10 15v6"/></>,
    menu:<path d="M4 7h16M4 12h16M4 17h16"/>,
    user:<><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>,
    logout:<><path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4"/></>,
    trash:<><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
    shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    link:<><path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/></>,
    eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name]??paths.arrow}</svg>;
}
