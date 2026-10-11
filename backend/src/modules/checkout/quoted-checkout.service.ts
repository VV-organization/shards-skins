import {BadRequestException,ConflictException,Inject,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseService} from '../../common/database/database.service';
import {normalizeIdempotencyKey} from '../../common/idempotency/idempotency-key';
import {sumShardsMinor,shardsToRubReferenceMinor} from '../../common/money/shards';
import {APP_CONFIG} from '../../config/app-config.module';
import type {AppConfig} from '../../config/app-config';
import {CartService,type CartClient,type CartDto} from '../cart/cart.service';
import {CatalogPricingService} from '../catalog/catalog-pricing.service';
import type {CatalogProductDto} from '../catalog/catalog.types';
import {QuotesService} from '../quotes/quotes.service';
import {SihClient} from '../providers/sih/sih.client';
import {steamAccountId} from '../users/steam-identity';
import type {EncryptedSteamTradeCredential} from '../users/users.service';
import {WalletService,WalletInsufficientFundsError} from '../wallet/wallet.service';
import {CheckoutInsufficientBalanceError,CheckoutSteamTradeUrlRequiredError,type CheckoutOrderDto,type CheckoutRecipientSnapshot} from './checkout.service';

type Recipient={steamId64:string;revision:string;credential:EncryptedSteamTradeCredential};
type QuoteLine={product:CatalogProductDto;cartRevision:string;supplierCostCapMicrousd:string;pricingSettingId:string};
type Snapshot={cartVersion:number;recipient:Recipient;lines:QuoteLine[];totalCoinMinor:number};
export type CheckoutQuoteDto={id:string;expiresAt:string;cartVersion:number;items:CatalogProductDto[];totalCoinMinor:number;totalRubMinor:number;recipient:{steamId64:string;partner:string}};
export type QuotedCheckoutCommand={userId:string;quoteId:string;cartVersion:number;idempotencyKey:string};
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
@Injectable()
export class QuotedCheckoutService {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService,@Inject(CartService)private readonly cart:CartService,
  @Inject(CatalogPricingService)private readonly pricing:CatalogPricingService,@Inject(QuotesService)private readonly quotes:QuotesService,
  @Inject(SihClient)private readonly sih:SihClient,@Inject(WalletService)private readonly wallet:WalletService,@Inject(APP_CONFIG)private readonly config:AppConfig){}

 private async recipient(client:CartClient,userId:string,lock=false):Promise<Recipient>{
  const rows=await client.query<{steam_id64:string|null;disabled:boolean;partner_account_id:string;ciphertext:string;nonce:string;auth_tag:string}>(`SELECT u.steam_id64,u.disabled,c.partner_account_id,c.ciphertext,c.nonce,c.auth_tag FROM users u JOIN steam_trade_credentials c ON c.user_id=u.id WHERE u.id=$1 ${lock?'FOR SHARE OF u,c':''}`,[userId]);
  const row=rows.rows[0];
  if(!row||row.disabled||!row.steam_id64||row.partner_account_id!==steamAccountId(row.steam_id64))throw new CheckoutSteamTradeUrlRequiredError();
  const credential={partner:row.partner_account_id,ciphertext:row.ciphertext,nonce:row.nonce,authTag:row.auth_tag};
  return {steamId64:row.steam_id64,credential,revision:digest([row.steam_id64,credential])};
 }
 private async verifiedPricing(client:CartClient,ids:string[],lock=false){
  const rows=await client.query<{id:string;metadata:{fxVerified?:boolean}}>(`SELECT id,metadata FROM pricing_settings WHERE scope='sih-skins' AND superseded_at IS NULL ${lock?'FOR SHARE':''}`);
  if(rows.rows.length!==1||rows.rows[0]?.metadata.fxVerified!==true||ids.some(id=>id!==rows.rows[0]?.id))throw new ServiceUnavailableException('PRICING_VERIFICATION_REQUIRED');
 }
 private assertCart(cart:CartDto,version:number){
  if(!Number.isSafeInteger(version)||version<0)throw new BadRequestException('INVALID_CART_VERSION');
  if(cart.version!==version)throw new ConflictException('CART_VERSION_CHANGED');
  if(!cart.canCheckout||cart.items.length===0)throw new BadRequestException('CART_UNAVAILABLE');
 }
 async createCheckoutQuote(command:{userId:string;cartVersion:number}):Promise<CheckoutQuoteDto>{
  const cart=await this.cart.getCart(command.userId);this.assertCart(cart,command.cartVersion);
  const recipient=await this.recipient(this.database,command.userId);
  await this.verifiedPricing(this.database,cart.items.map(i=>i.product.pricingSettingId));
  const lines:QuoteLine[]=[];
  // Bounded supplier reads happen before opening any checkout transaction.
  for(let start=0;start<cart.items.length;start+=5){
   const batch=await Promise.all(cart.items.slice(start,start+5).map(async item=>{
    const product=item.product;
    const available=await this.sih.getMinimumItem({game:'cs2',marketHashName:product.marketHashName});
    if(!available||available.availableQuantity<1||available.marketHashName!==product.marketHashName||available.priceMicrousd<=0n)throw new ConflictException('PRODUCT_UNAVAILABLE');
    const price=await this.pricing.quoteSupplierPrice({scope:'sih-skins',supplierAmountMicrounit:available.priceMicrousd});
    if(price.pricingSettingId!==product.pricingSettingId)throw new ConflictException('PRICING_CHANGED');
    return {product:{...product,price:{currency:price.currency,amountMinor:price.amountMinor,scale:price.scale,display:price.display}},cartRevision:product.priceRevision,supplierCostCapMicrousd:available.priceMicrousd.toString(),pricingSettingId:price.pricingSettingId};
   }));lines.push(...batch);
  }
  const totalCoinMinor=sumShardsMinor(lines.map(l=>l.product.price.amountMinor));
  if(totalCoinMinor<=0||totalCoinMinor>2147483647)throw new BadRequestException('CART_TOTAL_OUT_OF_RANGE');
  const issued=await this.quotes.issue<Snapshot>('checkout',{cartVersion:cart.version,recipient,lines,totalCoinMinor},command.userId);
  return {id:issued.id,expiresAt:issued.expiresAt,cartVersion:cart.version,items:lines.map(l=>l.product),totalCoinMinor,totalRubMinor:shardsToRubReferenceMinor(totalCoinMinor),recipient:{steamId64:recipient.steamId64,partner:recipient.credential.partner}};
 }

 async checkoutFromServerCart(command:QuotedCheckoutCommand):Promise<CheckoutOrderDto>{
  let key:string|undefined;try{key=normalizeIdempotencyKey(command.idempotencyKey);}catch{throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');}
  if(!key||!Number.isSafeInteger(command.cartVersion))throw new BadRequestException('INVALID_CHECKOUT');
  const hash=digest([command.quoteId,command.cartVersion]);
  return this.database.transaction(async client=>{
   const locked=await this.cart.lockCart(client,command.userId);
   await this.wallet.lockUserBalance(client,command.userId);
   const prior=await client.query<{request_hash:string;response_snapshot:CheckoutOrderDto|null}>('SELECT request_hash,response_snapshot FROM orders WHERE user_id=$1 AND idempotency_key=$2',[command.userId,key]);
   if(prior.rows[0]){if(prior.rows[0].request_hash!==hash||!prior.rows[0].response_snapshot)throw new ConflictException('IDEMPOTENCY_KEY_REUSED');return prior.rows[0].response_snapshot;}
   const quote=await this.quotes.lock<Snapshot>(client,command.quoteId,'checkout',command.userId);
   if(quote.cartVersion!==command.cartVersion||locked.version!==quote.cartVersion)throw new ConflictException('CART_VERSION_CHANGED');
   const recipient=await this.recipient(client,command.userId,true);
   if(recipient.revision!==quote.recipient.revision)throw new ConflictException('RECIPIENT_CHANGED');
   await this.verifiedPricing(client,quote.lines.map(l=>l.pricingSettingId),true);
   const slugs=quote.lines.map(l=>l.product.slug);
   await client.query('SELECT id FROM catalog_products WHERE slug=ANY($1::text[]) ORDER BY id FOR SHARE',[slugs]);
   await client.query("SELECT market_hash_name FROM supplier_listings WHERE supplier='sih' AND game='cs2' AND market_hash_name=ANY($1::text[]) ORDER BY market_hash_name FOR SHARE",[quote.lines.map(l=>l.product.marketHashName)]);
   const cart=await this.cart.readCart(client,locked);this.assertCart(cart,quote.cartVersion);
   if(cart.items.length!==quote.lines.length||quote.lines.some(l=>!cart.items.some(i=>i.productSlug===l.product.slug&&i.product.priceRevision===l.cartRevision)))throw new ConflictException('CHECKOUT_REQUOTE_REQUIRED');
   const orderId=randomUUID();
   const publicRecipient:CheckoutRecipientSnapshot={kind:'steam-trade',steamId64:recipient.steamId64,steamTradePartnerAccountId:recipient.credential.partner};
   await client.query(`INSERT INTO orders(id,user_id,idempotency_key,request_hash,status,total_coin_minor,recipient_snapshots,checkout_quote_id) VALUES ($1,$2,$3,$4,'held',$5,$6::jsonb,$7)`,[orderId,command.userId,key,hash,quote.totalCoinMinor,JSON.stringify([publicRecipient]),command.quoteId]);
   try{await this.wallet.createHold(client,{userId:command.userId,orderId,amountCoinMinor:quote.totalCoinMinor,reason:'checkout'});}catch(error){if(error instanceof WalletInsufficientFundsError)throw new CheckoutInsufficientBalanceError(quote.totalCoinMinor,error.balance.availableCoinMinor);throw error;}
   const response:CheckoutOrderDto={id:orderId,userId:command.userId,status:'held',totalCoinMinor:quote.totalCoinMinor,recipientSnapshots:[publicRecipient],lines:[]};
   for(const [index,line] of quote.lines.entries()){
    const id=randomUUID(),operationId=randomUUID();
    const snapshot={schemaVersion:1,game:'cs2',marketHashName:line.product.marketHashName,supplierCostCapMicrousd:line.supplierCostCapMicrousd,pricingSettingId:line.pricingSettingId,recipientCredential:recipient.credential,recipientRevision:recipient.revision,providerOperationId:operationId};
    await client.query(`INSERT INTO order_lines(id,order_id,line_index,product_id,product_slug,kind,title,unit_price_coin_minor,quantity,recipient_snapshot,status,commerce_snapshot) VALUES ($1,$2,$3,$4,$5,'skins',$6,$7,1,$8::jsonb,'held',$9::jsonb)`,[id,orderId,index,line.product.id,line.product.slug,line.product.title,line.product.price.amountMinor,JSON.stringify(publicRecipient),JSON.stringify(snapshot)]);
    await client.query(`INSERT INTO fulfillment_commands(order_id,order_line_id,provider,command_type,status,idempotency_key,payload_snapshot,provider_operation_id) VALUES ($1,$2,'sih','sih_skin_purchase','pending',$3,$4::jsonb,$5)`,[orderId,id,`${orderId}:${id}:sih_skin_purchase`,JSON.stringify({orderId,orderLineId:id,productSlug:line.product.slug,kind:'skins',title:line.product.title,unitPriceCoinMinor:line.product.price.amountMinor,recipientSnapshot:publicRecipient,...snapshot}),operationId]);
    response.lines.push({id,productSlug:line.product.slug,kind:'skins',title:line.product.title,quantity:1,unitPriceCoinMinor:line.product.price.amountMinor,recipientSnapshot:publicRecipient});
   }
   await this.outbox(client,response);
   await this.quotes.consume(client,command.quoteId,orderId);
   await client.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_slug=ANY($2::text[])',[locked.id,slugs]);
   await client.query('UPDATE carts SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',[locked.id]);
   await client.query('UPDATE orders SET response_snapshot=$2::jsonb WHERE id=$1',[orderId,JSON.stringify(response)]);
   return response;
  });
 }
 private async outbox(client:CartClient,order:CheckoutOrderDto){
  const now=new Date().toISOString(),eventId=`shards.order.${order.id}.created`;
  const event={schemaVersion:2,eventId,eventType:'order.created',source:'customer',occurredAt:now,site:{domain:new URL(this.config.integration.publicOrigin).hostname},subject:{type:'order',externalId:order.id},data:{externalOrderId:order.id,externalUserId:order.userId,status:'created',payment:{status:'pending',method:{type:'internal_balance',displayName:'Shards',provider:null},paidAt:null},totalAmount:(order.totalCoinMinor/100).toFixed(2),currency:'SHARDS',createdAtExternal:now,paidAtExternal:null,items:order.lines.map(l=>({externalItemId:l.id,name:l.title,priceAmount:(l.unitPriceCoinMinor/100).toFixed(2),currency:'SHARDS'}))}};
  await client.query(`INSERT INTO vv_admin_integration_outbox(event_id,event_type,subject_type,subject_external_id,payload) VALUES ($1,'order.created','order',$2,$3::jsonb)`,[eventId,order.id,JSON.stringify(event)]);
  await client.query(`INSERT INTO notification_outbox(channel,event_type,entity_id,idempotency_key,payload) VALUES ('slack','order.slack-alert',$1,$2,$3::jsonb)`,[order.id,`order-slack-alert/${order.id}`,JSON.stringify({amount:`${order.totalCoinMinor/100} Shards (held)`,itemSummary:order.lines.map(l=>l.title).join(', '),orderNumber:order.id,recipientSummary:order.recipientSnapshots.map(r=>r.kind==='steam-trade'?r.steamId64:'').join(', ')})]);
 }
}
