import {BadRequestException,Body,Controller,Get,Header,Headers,HttpCode,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {ApiBody,ApiHeader,ApiOkResponse,ApiCreatedResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {GuestPaymentService} from './guest-payment.service';
import {PaymentQuotesService} from './payment-quotes.service';
import {QuotesService} from '../quotes/quotes.service';
import {quoteSchema,sessionBody,steamRefillSessionSchema,paymentStatusSchema} from './payments.controller';
@ApiTags('Guest payments')
@Controller('payments/guest')
export class GuestPaymentsController {
 constructor(@Inject(GuestPaymentService)private readonly guests:GuestPaymentService,@Inject(PaymentQuotesService)private readonly payments:PaymentQuotesService,@Inject(QuotesService)private readonly quotes:QuotesService){}
 @Post('context')
 @ApiCreatedResponse({schema:{type:'object',required:['id','csrfToken'],properties:{id:{type:'string'},csrfToken:{type:'string'}}}})
 async context(@Req()req:Request,@Res({passthrough:true})res:Response){await this.quotes.limit(`guest-context:${req.ip}`);res.setHeader('Cache-Control','no-store');return this.guests.context(req,res);}
 @Get('context') @Header('Cache-Control','private, no-store')
 @ApiOkResponse({schema:{type:'object',required:['id','csrfToken'],properties:{id:{type:'string'},csrfToken:{type:'string'}}}})
 currentContext(@Req()req:Request){return this.guests.currentContext(req);}
 @Post('steam-refill/quotes') @HttpCode(200)
 @ApiBody({schema:{type:'object',additionalProperties:false,required:['amountRub','steamLogin','email'],properties:{amountRub:{type:'integer',minimum:50,maximum:9433},steamLogin:{type:'string'},email:{type:'string',format:'email'}}}})
 @ApiOkResponse({schema:quoteSchema})
 async quote(@Req()req:Request,@Body()body:Record<string,unknown>|null){
  this.guests.requireEnabled();const g=await this.guests.authenticate(req,true);await this.quotes.limit(`guest-quote:${req.ip}`);
  if(!body||Object.keys(body).some(k=>!['amountRub','steamLogin','email'].includes(k))||typeof body.amountRub!=='number'||typeof body.steamLogin!=='string'||typeof body.email!=='string')throw new BadRequestException('INVALID_STEAM_REFILL');
  return this.payments.quoteSteam(g.user_id,body.amountRub,body.steamLogin,body.email,true);
 }
 @Post('steam-refill/sessions') @HttpCode(200)
 @ApiHeader({name:'idempotency-key',required:true}) @ApiBody({schema:sessionBody}) @ApiOkResponse({schema:steamRefillSessionSchema})
 async create(@Req()req:Request,@Headers('idempotency-key')key:string,@Body()body:Record<string,unknown>|null){
  this.guests.requireEnabled();const g=await this.guests.authenticate(req,true);
  if(!body||Object.keys(body).some(k=>!['quoteId','acceptedFiatMinor'].includes(k))||typeof body.quoteId!=='string'||typeof body.acceptedFiatMinor!=='number')throw new BadRequestException('INVALID_PAYMENT');
  return this.payments.createSession({userId:g.user_id,purpose:'steam_refill',idempotencyKey:key,quoteId:body.quoteId,acceptedFiatMinor:body.acceptedFiatMinor});
 }
 @Header('Cache-Control','private, no-store')
 @Get('steam-refill/sessions/:id') @ApiOkResponse({schema:paymentStatusSchema})
 async get(@Req()req:Request,@Param('id')id:string){const g=await this.guests.authenticate(req);return this.payments.getSession(g.user_id,id);}
 @Post('steam-refill/sessions/:id/check') @HttpCode(200) @Header('Cache-Control','private, no-store')
 @ApiOkResponse({schema:paymentStatusSchema})
 async check(@Req()req:Request,@Param('id')id:string){const g=await this.guests.authenticate(req,true);return this.payments.checkSession(g.user_id,id);}
}
