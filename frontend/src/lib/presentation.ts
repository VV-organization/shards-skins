import slots from '../data/presentation.json' with {type:'json'};
import design from '../data/catalog.json' with {type:'json'};
import type {Product} from './types.ts';
export const categories=design.categories;
export const presentationSlugs=slots.map(slot=>slot.slug);
/** Slots preserve artwork, never authorize a SKU or supply a purchase price. */
export function presentationProducts(slotIds:readonly string[],live:Product[]):Product[]{
 return slotIds.flatMap(slotId=>{
  const slot=slots.find(s=>s.slot===slotId);const reference=design.products.find(p=>p.id===slotId);
  if(!reference)return [];
  const product=slot?live.find(p=>p.marketHashName===slot.marketHashName):undefined;
  if(product)return [{...product,imageUrl:(process.env.NEXT_PUBLIC_BASE_PATH??'')+reference.imageUrl}];
  return [{...reference,id:slot?.slug??`unavailable-${slotId}`,marketHashName:slot?.marketHashName,priceMinor:0,availability:'unavailable' as const,priceRevision:'',imageUrl:(process.env.NEXT_PUBLIC_BASE_PATH??'')+reference.imageUrl} as Product];
 });
}
export function presentationArtwork(marketHashName:string):string|undefined {
 const slot=slots.find(s=>s.marketHashName===marketHashName);return slot?(process.env.NEXT_PUBLIC_BASE_PATH??'')+slot.art:undefined;
}

export function categoryArtwork(categoryId:string):string|undefined { const reference=design.products.find(p=>p.categoryId===categoryId);return reference?(process.env.NEXT_PUBLIC_BASE_PATH??"")+reference.imageUrl:undefined; }
