import {BadRequestException,Body,Controller,Headers,HttpCode,Inject,Post,UseGuards} from '@nestjs/common';
import {ApiBody,ApiCreatedResponse,ApiHeader,ApiOkResponse,ApiTags} from '@nestjs/swagger';
import {productSchema} from '../catalog/catalog.controller';
import {SteamCustomerGuard} from '../sessions/steam-customer.guard';
import {CsrfGuard} from '../sessions/csrf.guard';
import {CurrentCustomerContext} from '../sessions/current-customer';
import {CustomerSessionGuard} from '../sessions/customer-session.guard';
import type {CurrentCustomer} from '../sessions/sessions.service';
import {QuotedCheckoutService} from './quoted-checkout.service';
function bodyRecord(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new BadRequestException('INVALID_CHECKOUT');
 return value as Record<string,unknown>;
}
export const orderSchema={type:'object',required:['id','userId','status','totalCoinMinor','recipientSnapshots','lines'],properties:{id:{type:'string',format:'uuid'},userId:{type:'string'},status:{type:'string',enum:['held']},totalCoinMinor:{type:'integer',minimum:1},recipientSnapshots:{type:'array',items:{type:'object'}},lines:{type:'array',items:{type:'object'}}}};
@ApiTags('Checkout')
@UseGuards(CustomerSessionGuard,SteamCustomerGuard,CsrfGuard)
@Controller('checkout')
export class CheckoutController {
 constructor(@Inject(QuotedCheckoutService)private readonly checkout:QuotedCheckoutService){}
 @Post('quotes')
 @HttpCode(200)
 @ApiBody({schema:{type:'object',additionalProperties:false,required:['cartVersion'],properties:{cartVersion:{type:'integer',minimum:0}}}})
 @ApiOkResponse({schema:{type:'object',required:['id','expiresAt','cartVersion','items','totalCoinMinor','totalRubMinor','recipient'],properties:{id:{type:'string'},expiresAt:{type:'string'},cartVersion:{type:'integer'},items:{type:'array',items:productSchema},totalCoinMinor:{type:'integer'},totalRubMinor:{type:'integer'},recipient:{type:'object',required:['steamId64','partner'],properties:{steamId64:{type:'string'},partner:{type:'string'}}}}}})
 quote(@CurrentCustomerContext()customer:CurrentCustomer,@Body()body:unknown){
  const data=bodyRecord(body,['cartVersion']);if(typeof data.cartVersion!=='number')throw new BadRequestException('INVALID_CART_VERSION');
  return this.checkout.createCheckoutQuote({userId:customer.userId,cartVersion:data.cartVersion});
 }
 @Post('cart')
 @ApiHeader({name:'idempotency-key',required:true})
 @ApiBody({schema:{type:'object',additionalProperties:false,required:['quoteId','cartVersion'],properties:{quoteId:{type:'string'},cartVersion:{type:'integer',minimum:0}}}})
 @ApiCreatedResponse({schema:orderSchema})
 create(@CurrentCustomerContext()customer:CurrentCustomer,@Headers('idempotency-key')key:string,@Body()body:unknown){
  const data=bodyRecord(body,['quoteId','cartVersion']);if(typeof data.quoteId!=='string'||typeof data.cartVersion!=='number')throw new BadRequestException('INVALID_CHECKOUT');
  return this.checkout.checkoutFromServerCart({userId:customer.userId,quoteId:data.quoteId,cartVersion:data.cartVersion,idempotencyKey:key});
 }
}
