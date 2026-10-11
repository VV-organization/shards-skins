import type {ApiResponses} from '../generated/api-types.ts';
import type {Product} from './types.ts';
import {presentationArtwork} from './presentation.ts';
export type CatalogPage=ApiResponses['/catalog']['get'];
export type CatalogApiProduct=CatalogPage['items'][number];
const wear:Record<string,string>={FN:'Прямо с завода',MW:'Немного поношенное',FT:'После полевых испытаний',WW:'Поношенное',BS:'Закалённое в боях'};
export function mapProduct(dto:CatalogApiProduct):Product {
 const finish=(dto.title.split('|')[1]??dto.title).replace(/\s*\([^()]+\)$/,'').trim();
 const safeImage=dto.image&&(/^https:\/\//.test(dto.image)||dto.image.startsWith('/'))?dto.image:undefined;
 return {id:dto.slug,name:dto.title,description:dto.description,imageUrl:presentationArtwork(dto.marketHashName)??safeImage??'/favicon.svg',categoryId:dto.categoryId,condition:wear[dto.condition]??dto.condition,priceMinor:dto.price.amountMinor,availability:dto.availability==='available'?'available':'unavailable',priceRevision:dto.priceRevision,pricingSettingId:dto.pricingSettingId,marketHashName:dto.marketHashName,weapon:dto.weapon,finish,rarity:dto.meta.find(m=>/тайн|секрет|запрещ|экстра/i.test(m))??'',stattrak:dto.stattrak,source:{name:'SIH',url:'',capturedAt:'',price:0,currency:'RUB',rublesPerUnit:1}};
}

export function unavailableProduct(slug:string):Product { return {id:slug,name:"Предмет недоступен",description:"Этот предмет больше не доступен в каталоге",imageUrl:"/favicon.svg",categoryId:"other",condition:"",priceMinor:0,availability:"unavailable",priceRevision:"",weapon:"CS2",finish:"Предмет недоступен",rarity:"",stattrak:false,source:{name:"",url:"",capturedAt:"",price:0,currency:"RUB",rublesPerUnit:1}}; }
