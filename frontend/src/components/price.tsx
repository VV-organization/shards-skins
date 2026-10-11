import {formatMinor,shardsToRub} from "@/lib/money";
export function Price({minor,large=false,unpriced=false}:{minor:number;large?:boolean;unpriced?:boolean}) {
  return <div className={`price ${large?"price-large":""}`}><span className="price-main">{unpriced?"—":formatMinor(minor)} <small>Shards</small></span><small className="price-rub">≈ {unpriced?"—":formatMinor(shardsToRub(minor))} ₽</small></div>;
}
