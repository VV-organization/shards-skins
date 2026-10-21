import {BadRequestException,ConflictException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {DatabaseService} from '../../common/database/database.service';
import {topUpFiatMinor} from '../../common/money/shards';
import {APP_CONFIG} from '../../config/app-config.module';
import type {AppConfig} from '../../config/app-config';
import {QuotesService} from '../quotes/quotes.service';
import {UsersService} from '../users/users.service';
import {SihClient} from '../providers/sih/sih.client';
import {PaymentsService} from './payments.service';
import {WALLET_TERMS_VERSION,STEAM_TERMS_VERSION,type PaymentTerms,type PaymentPurpose,type PaymentQuoteDto} from './payment-quote.types';
@Injectable()
export class PaymentQuotesService {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService,@Inject(QuotesService)private readonly quotes:QuotesService,@Inject(UsersService)private readonly users:UsersService,@Inject(SihClient)private readonly sih:SihClient,@Inject(PaymentsService)private readonly payments:PaymentsService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
 async quoteWallet(userId:string,coinAmountMinor:number):Promise<PaymentQuoteDto>{
  const user=await this.users.requireUser(userId);if(!user.steam.connected)throw new BadRequestException('STEAM_IDENTITY_REQUIRED');
  let fiatAmountMinor:number;try{fiatAmountMinor=topUpFiatMinor(coinAmountMinor);}catch{throw new BadRequestException('INVALID_TOP_UP_AMOUNT');}
  return this.issue(userId,{purpose:'wallet_topup',termsVersion:WALLET_TERMS_VERSION,environment:this.config.arcoPay.environment,currency:'RUB',fiatAmountMinor,coinAmountMinor});
 }
 async quoteSteam(userId:string,amountRub:number,steamLogin:string,emailInput?:string,guestCheckout=false):Promise<PaymentQuoteDto>{
  if(!Number.isSafeInteger(amountRub)||amountRub<50||amountRub>9433||typeof steamLogin!=='string'||!/^[A-Za-z0-9_-]{3,64}$/.test(steamLogin.trim()))throw new BadRequestException('INVALID_STEAM_REFILL');
  const user=await this.users.requireUser(userId);
  const email=(emailInput??user.email?.address??'').trim().toLowerCase();
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BadRequestException('EMAIL_REQUIRED');
  if(guestCheckout){const guest=await this.database.query('SELECT id FROM guest_payment_contexts WHERE user_id=$1 AND expires_at>now()',[userId]);if(!guest.rowCount)throw new BadRequestException('GUEST_CONTEXT_REQUIRED');}
  const login=steamLogin.trim();const checked=await this.sih.checkSteamAccount({steamUsername:login});
  const feeRubMinor=amountRub*5;
  return this.issue(userId,{purpose:'steam_refill',termsVersion:STEAM_TERMS_VERSION,environment:this.config.arcoPay.environment,currency:'RUB',fiatAmountMinor:amountRub*100+feeRubMinor,amountRub,feeRubMinor,steamLogin:login,contactEmail:email,...(emailInput===undefined?{}:{contactEmailSource:'input' as const}),...(guestCheckout?{guestCheckout:true}:{}),steamCheckTransactionId:checked.transactionId});
 }
 private async issue(userId:string,terms:PaymentTerms):Promise<PaymentQuoteDto>{const q=await this.quotes.issue(terms.purpose,terms,userId);const exposed={...terms};delete exposed.steamCheckTransactionId;return {...exposed,quoteId:q.id,expiresAt:q.expiresAt};}
 async createSession(command:{userId:string;purpose:PaymentPurpose;quoteId:string;acceptedFiatMinor:number;idempotencyKey:string}){
  const terms=await this.quotes.readOwned<PaymentTerms>(command.quoteId,command.purpose,command.userId);
  if(command.acceptedFiatMinor!==terms.fiatAmountMinor)throw new ConflictException('PAYMENT_TERMS_CHANGED');
  const binding={quoteId:command.quoteId,acceptedFiatMinor:command.acceptedFiatMinor};
  if(command.purpose==='wallet_topup')return this.payments.createTopUpSession({userId:command.userId,idempotencyKey:command.idempotencyKey,coinAmountMinor:terms.coinAmountMinor??0,quoteBinding:binding});
  return this.payments.createSteamRefillSession({userId:command.userId,idempotencyKey:command.idempotencyKey,amountRub:terms.amountRub??0,steamLogin:terms.steamLogin??'',quoteBinding:binding});
 }
 async getSession(userId:string,id:string){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new NotFoundException();
  const rows=await this.database.query<{id:string;purpose:PaymentPurpose;payment_status:string;fiat_amount_minor:number;checkout_url:string|null;order_id:string|null;order_status:string|null;coin_amount_minor:number|null;steam_login:string|null;amount_rub_minor:number|null;refund_status:string|null}>(`
    SELECT id,'wallet_topup' AS purpose,status AS payment_status,fiat_amount_minor,provider_checkout_url AS checkout_url,NULL::uuid AS order_id,NULL::text AS order_status,coin_amount_minor,NULL::text AS steam_login,NULL::integer AS amount_rub_minor,NULL::text AS refund_status FROM top_up_payments WHERE id=$1 AND user_id=$2
    UNION ALL SELECT p.id,'steam_refill',p.status,p.fiat_amount_minor,p.provider_checkout_url,p.order_id,o.status,NULL,p.steam_login,p.amount_rub_minor,p.metadata->>'refundStatus' FROM steam_refill_payments p LEFT JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND (p.user_id=$2 OR EXISTS(SELECT 1 FROM steam_refill_claims c WHERE c.payment_id=p.id AND c.user_id=$2))`,[id,userId]);
  const row=rows.rows[0];if(!row)throw new NotFoundException();
  const fulfillmentStatus=row.purpose==='wallet_topup'?'not_applicable':!row.order_id?'not_started':row.order_status==='fulfilled'?'delivered':row.order_status==='failed'?'failed':row.order_status==='partially_fulfilled'?'partial':row.order_status==='manual_review'?'manual_review':'pending';
  return {id:row.id,purpose:row.purpose,paymentStatus:row.payment_status,fulfillmentStatus,fiatAmountMinor:row.fiat_amount_minor,currency:'RUB' as const,checkoutUrl:row.checkout_url,orderId:row.order_id,coinAmountMinor:row.coin_amount_minor,steamLogin:row.steam_login,amountRubMinor:row.amount_rub_minor,refundStatus:row.refund_status};
 }
}
