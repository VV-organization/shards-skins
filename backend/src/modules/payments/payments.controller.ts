import {BadRequestException,Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,UseGuards} from '@nestjs/common';
import {ApiBody,ApiHeader,ApiOkResponse,ApiTags} from '@nestjs/swagger';
import {CurrentCustomerContext} from '../sessions/current-customer';
import {CsrfGuard} from '../sessions/csrf.guard';
import {CustomerSessionGuard} from '../sessions/customer-session.guard';
import type {CurrentCustomer} from '../sessions/sessions.service';
import {PaymentQuotesService} from './payment-quotes.service';
const topUpSessionSchema = {
  type: "object",
  required: ["id", "userId", "status", "provider", "coinAmountMinor", "fiatAmountMinor", "fiatCurrency", "rate", "checkoutUrl"],
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string" },
    status: { type: "string", enum: ["provider_configuration_required", "provider_creation_pending", "checkout_pending", "paid", "failed", "manual_review"] },
    provider: { type: "string", enum: ["arc_pay"] },
    coinAmountMinor: { type: "integer", minimum: 10_000, maximum: 10_000_000 },
    fiatAmountMinor: { type: "integer", minimum: 1 },
    fiatCurrency: { type: "string", enum: ["RUB"] },
    rate: {
      type: "object",
      required: ["fiatMinor", "coinMinor"],
      properties: {
        fiatMinor: { type: "integer", enum: [100] },
        coinMinor: { type: "integer", enum: [160] },
      },
    },
    checkoutUrl: { type: "string", nullable: true },
  },
};

const steamRefillSessionSchema = {
  type: "object",
  required: ["id", "userId", "status", "provider", "amountRubMinor", "feeRubMinor", "fiatAmountMinor", "fiatCurrency", "steamLogin", "checkoutUrl"],
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string" },
    status: { type: "string", enum: ["provider_configuration_required", "provider_creation_pending", "checkout_pending", "paid", "failed", "manual_review"] },
    provider: { type: "string", enum: ["arc_pay"] },
    amountRubMinor: { type: "integer", minimum: 5_000, maximum: 943_300 },
    feeRubMinor: { type: "integer", minimum: 250, maximum: 47_165 },
    fiatAmountMinor: { type: "integer", minimum: 5_250, maximum: 990_465 },
    fiatCurrency: { type: "string", enum: ["RUB"] },
    steamLogin: { type: "string" },
    checkoutUrl: { type: "string", nullable: true },
  },
};

const quoteSchema={type:'object',required:['quoteId','purpose','fiatAmountMinor','currency','termsVersion','expiresAt'],properties:{quoteId:{type:'string'},purpose:{type:'string',enum:['wallet_topup','steam_refill']},fiatAmountMinor:{type:'integer'},currency:{type:'string',enum:['RUB']},termsVersion:{type:'string'},expiresAt:{type:'string'},coinAmountMinor:{type:'integer'},amountRub:{type:'integer'},feeRubMinor:{type:'integer'},steamLogin:{type:'string'},contactEmail:{type:'string'}}};
const sessionBody={type:'object',additionalProperties:false,required:['quoteId','acceptedFiatMinor'],properties:{quoteId:{type:'string'},acceptedFiatMinor:{type:'integer',minimum:1}}};
function record(value:unknown,allowed:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new BadRequestException('INVALID_PAYMENT');return value as Record<string,unknown>;}
function session(value:unknown){const body=record(value,['quoteId','acceptedFiatMinor']);if(typeof body.quoteId!=='string'||typeof body.acceptedFiatMinor!=='number')throw new BadRequestException('INVALID_PAYMENT');return {quoteId:body.quoteId,acceptedFiatMinor:body.acceptedFiatMinor};}
@ApiTags('Payments')
@UseGuards(CustomerSessionGuard)
@Controller('payments')
export class PaymentsController {
 constructor(@Inject(PaymentQuotesService)private readonly payments:PaymentQuotesService){}
 @Post('top-up/quotes') @HttpCode(200) @UseGuards(CsrfGuard)
 @ApiBody({schema:{type:'object',additionalProperties:false,required:['coinAmountMinor'],properties:{coinAmountMinor:{type:'integer',minimum:10000,maximum:10000000}}}})
 @ApiOkResponse({schema:quoteSchema})
 quoteWallet(@CurrentCustomerContext()customer:CurrentCustomer,@Body()value:unknown){const body=record(value,['coinAmountMinor']);if(typeof body.coinAmountMinor!=='number')throw new BadRequestException('INVALID_AMOUNT');return this.payments.quoteWallet(customer.userId,body.coinAmountMinor);}
 @Post('steam-refill/quotes') @HttpCode(200) @UseGuards(CsrfGuard)
 @ApiBody({schema:{type:'object',additionalProperties:false,required:['amountRub','steamLogin'],properties:{amountRub:{type:'integer',minimum:50,maximum:9433},steamLogin:{type:'string'}}}})
 @ApiOkResponse({schema:quoteSchema})
 quoteSteam(@CurrentCustomerContext()customer:CurrentCustomer,@Body()value:unknown){const body=record(value,['amountRub','steamLogin']);if(typeof body.amountRub!=='number'||typeof body.steamLogin!=='string')throw new BadRequestException('INVALID_STEAM_REFILL');return this.payments.quoteSteam(customer.userId,body.amountRub,body.steamLogin);}
 @Post('top-up/sessions') @HttpCode(200) @UseGuards(CsrfGuard)
 @ApiHeader({name:'idempotency-key',required:true}) @ApiBody({schema:sessionBody}) @ApiOkResponse({schema:topUpSessionSchema})
 createWallet(@CurrentCustomerContext()customer:CurrentCustomer,@Headers('idempotency-key')key:string,@Body()value:unknown){return this.payments.createSession({userId:customer.userId,purpose:'wallet_topup',idempotencyKey:key,...session(value)});}
 @Post('steam-refill/sessions') @HttpCode(200) @UseGuards(CsrfGuard)
 @ApiHeader({name:'idempotency-key',required:true}) @ApiBody({schema:sessionBody}) @ApiOkResponse({schema:steamRefillSessionSchema})
 createSteam(@CurrentCustomerContext()customer:CurrentCustomer,@Headers('idempotency-key')key:string,@Body()value:unknown){return this.payments.createSession({userId:customer.userId,purpose:'steam_refill',idempotencyKey:key,...session(value)});}
 @Get('sessions/:id')
 @ApiOkResponse({schema:{type:'object',required:['id','purpose','paymentStatus','fulfillmentStatus','fiatAmountMinor','currency','checkoutUrl','orderId','coinAmountMinor','steamLogin','amountRubMinor'],properties:{id:{type:'string'},purpose:{type:'string',enum:['wallet_topup','steam_refill']},paymentStatus:{type:'string'},fulfillmentStatus:{type:'string',enum:['not_applicable','not_started','pending','delivered','partial','failed','manual_review']},fiatAmountMinor:{type:'integer'},currency:{type:'string',enum:['RUB']},checkoutUrl:{type:'string',nullable:true},orderId:{type:'string',nullable:true},coinAmountMinor:{type:'integer',nullable:true},steamLogin:{type:'string',nullable:true},amountRubMinor:{type:'integer',nullable:true}}}})
 get(@CurrentCustomerContext()customer:CurrentCustomer,@Param('id')id:string){return this.payments.getSession(customer.userId,id);}
}
