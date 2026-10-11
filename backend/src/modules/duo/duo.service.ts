import {BadRequestException,ConflictException,Inject,Injectable} from '@nestjs/common';
import {CatalogService} from '../catalog/catalog.service';
import {CartService,type CartCommand,type CartDto} from '../cart/cart.service';
import {QuotesService} from '../quotes/quotes.service';
import {duoTotals,type DuoQuoteDto,type DuoSnapshot} from './duo.types';
@Injectable()
export class DuoService {
 constructor(@Inject(CatalogService)private readonly catalog:CatalogService,@Inject(CartService)private readonly cart:CartService,@Inject(QuotesService)private readonly quotes:QuotesService){}
 async listOptions(slot:unknown,cursor:unknown){
  if(slot!=='knife'&&slot!=='gloves')throw new BadRequestException('INVALID_DUO_SLOT');
  let after:{price:number;id:string}|undefined;
  if(cursor!==undefined){
   try{
    if(typeof cursor!=='string'||cursor.length>1000)throw new Error();
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString()) as {slot?:unknown;price?:unknown;id?:unknown};
    if(value.slot!==slot||typeof value.price!=='number'||!Number.isSafeInteger(value.price)||value.price<0||typeof value.id!=='string')throw new Error();
    after={price:value.price,id:value.id};
   }catch{throw new BadRequestException('INVALID_CURSOR');}
  }
  const rows=await this.catalog.duoOptions(slot,after),items=rows.slice(0,60),last=items.at(-1);
  return {items,nextCursor:rows.length>60&&last?Buffer.from(JSON.stringify({slot,price:last.price.amountMinor,id:last.id})).toString('base64url'):null};
 }
 async quotePair(command:{knifeSlug:string;gloveSlug:string;budgetRubMinor:number}):Promise<DuoQuoteDto>{
  if(typeof command.knifeSlug!=='string'||typeof command.gloveSlug!=='string'||command.knifeSlug===command.gloveSlug)throw new BadRequestException('INVALID_DUO');
  const {items}=await this.catalog.lookup([command.knifeSlug,command.gloveSlug]);
  const knife=items.find(p=>p.slug===command.knifeSlug),glove=items.find(p=>p.slug===command.gloveSlug);
  if(!knife||!glove||knife.categoryId!=='knife'||glove.categoryId!=='gloves'||knife.availability!=='available'||glove.availability!=='available')throw new BadRequestException('DUO_UNAVAILABLE');
  const payload:DuoSnapshot={items:[knife,glove],...duoTotals([knife.price.amountMinor,glove.price.amountMinor],command.budgetRubMinor)};
  const quote=await this.quotes.issue('duo',payload);
  return {...payload,id:quote.id,expiresAt:quote.expiresAt};
 }
 addPair(command:CartCommand&{quoteId:string}):Promise<CartDto>{
  return this.cart.mutate(command,['duo',command.quoteId],async(client,cart,operationId)=>{
   const quote=await this.quotes.lock<DuoSnapshot>(client,command.quoteId,'duo',command.userId);
   if(!quote.withinBudget)throw new BadRequestException('DUO_OVER_BUDGET');
   const {items}=await this.catalog.lookup(quote.items.map(p=>p.slug),client);
   if(items.length!==2||quote.items.some(p=>!items.some(fresh=>fresh.slug===p.slug&&fresh.priceRevision===p.priceRevision&&fresh.availability==='available')))throw new ConflictException('DUO_REQUOTE_REQUIRED');
   const changed=await this.cart.addProducts(client,cart,quote.items);
   await this.quotes.consume(client,command.quoteId,operationId);
   return changed;
  });
 }
}
