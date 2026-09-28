"use client";
import {useId,useState} from "react";
import {parseAmount,prismToRub,rubToPrism,inputAmount} from "@/lib/money";
import {Icon} from "./icon";
export function Converter(){
  const id=useId();const [rub,setRub]=useState("1 500");const [prism,setPrism]=useState("1 000");const [error,setError]=useState(false);
  function change(value:string,type:"rub"|"prism"){
    const update=type==="rub"?setRub:setPrism; const other=type==="rub"?setPrism:setRub;
    update(value);if(!value){other("");setError(false);return;}const amount=parseAmount(value);
    setError(amount===null);other(amount===null?"":inputAmount(type==="rub"?rubToPrism(amount):prismToRub(amount)));
  }
  return <section className="converter" aria-labelledby={id}><div className="converter-heading"><span className="eyebrow">КОНВЕРТАЦИЯ</span><h2 id={id}>Расчёт стоимости</h2></div><div className="converter-fields"><label><span className="sr-only">Рубли</span><input aria-label="Рубли" value={rub} inputMode="decimal" maxLength={12} onChange={e=>change(e.target.value,"rub")} aria-invalid={error}/><span>₽</span></label><span className="convert-icon"><Icon name="swap"/></span><label><span className="sr-only">PRISM</span><input aria-label="PRISM" value={prism} inputMode="decimal" maxLength={12} onChange={e=>change(e.target.value,"prism")} aria-invalid={error}/><span>PRISM</span></label></div><div className="converter-rate"><strong>1 PRISM = 1,5 ₽</strong><span>{error?"Введите корректную сумму":"Можно изменить любую сумму"}</span></div>{error&&<p className="converter-error" role="status">Введите корректную сумму: до двух знаков после запятой.</p>}</section>;
}
