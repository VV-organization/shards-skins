import {BadRequestException,Body,Controller,Get,Headers,HttpCode,Inject,Post,Query,Req,UseGuards} from '@nestjs/common';
import {ApiBody,ApiHeader,ApiOkResponse,ApiQuery,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {productSchema} from '../catalog/catalog.controller';
import {cartSchema} from '../cart/cart.controller';
import {CurrentCustomerContext} from '../sessions/current-customer';
import {CustomerSessionGuard} from '../sessions/customer-session.guard';
import {SteamCustomerGuard} from '../sessions/steam-customer.guard';
import {CsrfGuard} from '../sessions/csrf.guard';
import type {CurrentCustomer} from '../sessions/sessions.service';
import {QuotesService} from '../quotes/quotes.service';
import {DuoService} from './duo.service';
const quoteSchema={type:'object',required:['id','expiresAt','items','totalCoinMinor','totalRubMinor','budgetRubMinor','remainingRubMinor','withinBudget'],properties:{id:{type:'string'},expiresAt:{type:'string'},items:{type:'array',items:productSchema},totalCoinMinor:{type:'integer'},totalRubMinor:{type:'integer'},budgetRubMinor:{type:'integer'},remainingRubMinor:{type:'integer'},withinBudget:{type:'boolean'}}};
@ApiTags('Duo')
@Controller()
export class DuoController {
 constructor(@Inject(DuoService)private readonly duo:DuoService,@Inject(QuotesService)private readonly quotes:QuotesService){}
 @Get('duo/options')
 @ApiQuery({name:'slot',enum:['knife','gloves'],required:true})
 @ApiQuery({name:'cursor',type:String,required:false})
 @ApiOkResponse({schema:{type:'object',required:['items','nextCursor'],properties:{items:{type:'array',items:productSchema},nextCursor:{type:'string',nullable:true}}}})
 options(@Query('slot')slot:unknown,@Query('cursor')cursor:unknown){return this.duo.listOptions(slot,cursor);}
 @Post('duo/quotes')
 @HttpCode(200)
 @ApiBody({schema:{type:'object',additionalProperties:false,required:['knifeSlug','gloveSlug','budgetRubMinor'],properties:{knifeSlug:{type:'string'},gloveSlug:{type:'string'},budgetRubMinor:{type:'integer',minimum:0}}}})
 @ApiOkResponse({schema:quoteSchema})
 async quote(@Body()body:unknown,@Req()request:Request){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['knifeSlug','gloveSlug','budgetRubMinor'].includes(k)))throw new BadRequestException('INVALID_DUO');
  await this.quotes.limit(request.ip??request.socket.remoteAddress??'unknown');
  return this.duo.quotePair(body as {knifeSlug:string;gloveSlug:string;budgetRubMinor:number});
 }
 @Post('cart/duo')
 @HttpCode(200)
 @UseGuards(CustomerSessionGuard,SteamCustomerGuard,CsrfGuard)
 @ApiHeader({name:'Idempotency-Key',required:true})
 @ApiBody({schema:{type:'object',required:['quoteId','expectedCartVersion'],properties:{quoteId:{type:'string'},expectedCartVersion:{type:'integer',minimum:0}}}})
 @ApiOkResponse({schema:cartSchema})
 add(@CurrentCustomerContext()customer:CurrentCustomer,@Body()body:{quoteId:string;expectedCartVersion:number}|undefined,@Headers('idempotency-key')key:string){
  return this.duo.addPair({userId:customer.userId,quoteId:body?.quoteId??'',expectedCartVersion:body?.expectedCartVersion??-1,idempotencyKey:key});
 }
}
