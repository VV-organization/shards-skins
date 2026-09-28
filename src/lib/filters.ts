import type {Product} from "./types.ts";
import {parseAmount} from "./money.ts";
export const conditions = ["Прямо с завода","Немного поношенное","После полевых испытаний","Поношенное","Закаленное в боях"];
export function conditionCode(condition:string) {
  if (condition.includes("завода")) return "FN";
  if (condition.includes("Немного")) return "MW";
  if (condition.includes("полевых")) return "FT";
  if (condition.includes("Поношенное")) return "WW";
  return "BS";
}
export type Filters = { query:string; category:string; condition:string; min:string; max:string; sort:string; stattrak:boolean };
export const emptyFilters:Filters = {query:"",category:"all",condition:"",min:"",max:"",sort:"featured",stattrak:false};
export function filterProducts(products: Product[], filters: Filters) {
  if(invalidPriceRange(filters.min,filters.max))return [];
  const min=filters.min?parseAmount(filters.min):null;const max=filters.max?parseAmount(filters.max):null;
  const query=filters.query.trim().toLocaleLowerCase("ru");
  const filtered=products.filter(p=>{
    return (!query || (p.name+" "+p.description+" "+p.weapon).toLocaleLowerCase("ru").includes(query)) &&
      (filters.category==="all" || p.categoryId===filters.category) &&
      (!filters.condition || conditionCode(p.condition)===filters.condition) &&
      (!filters.stattrak || p.stattrak) &&
      (min===null || p.priceMinor>=min) &&
      (max===null || p.priceMinor<=max);
  });
  if(filters.sort==="price-asc") filtered.sort((a,b)=>a.priceMinor-b.priceMinor);
  if(filters.sort==="price-desc") filtered.sort((a,b)=>b.priceMinor-a.priceMinor);
  if(filters.sort==="float") filtered.sort((a,b)=>(a.float??1)-(b.float??1));
  return filtered;
}

export function invalidPriceRange(min:string,max:string){const low=min?parseAmount(min):null;const high=max?parseAmount(max):null;return (!!min&&low===null)||(!!max&&high===null)||(low!==null&&high!==null&&low>high);}
