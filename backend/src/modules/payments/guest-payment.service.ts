import {createHash,randomUUID} from 'node:crypto';
import {Inject,Injectable,ForbiddenException,UnauthorizedException,ServiceUnavailableException} from '@nestjs/common';
import type {Request,Response} from 'express';
import {DatabaseService} from '../../common/database/database.service';
import {APP_CONFIG} from '../../config/app-config.module';
import type {AppConfig} from '../../config/app-config';
import {createOpaqueToken,digestToken,parseExactCookie,secureCookie,createCsrfToken,verifyCsrfToken} from '../sessions/session-cookies';
export const GUEST_COOKIE='__Host-shards_guest_payment';
const age=30*24*60*60;
@Injectable()
export class GuestPaymentService {
 private readonly secret=createHash('sha256').update('guest-payment:'+ (process.env.COOKIE_HMAC_SECRET??'shards-development-cookie-secret')).digest();
 constructor(@Inject(DatabaseService)private readonly db:DatabaseService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
 requireEnabled(){if(!this.config.commerce?.guestSteamRefillEnabled||!this.config.commerce.paymentsEnabled||!this.config.commerce.fulfillmentEnabled)throw new ServiceUnavailableException({code:'COMMERCE_UNAVAILABLE',message:'Пополнение временно недоступно.'});}
 private token(req:Request){try{return parseExactCookie(req.headers.cookie,GUEST_COOKIE);}catch{throw new UnauthorizedException();}}
 async authenticate(req:Request,mutating=false){
  const token=this.token(req);if(!token)throw new UnauthorizedException();
  if(mutating&&(typeof req.headers['x-csrf-token']!=='string'||!verifyCsrfToken(token,req.headers['x-csrf-token'],this.secret)))throw new ForbiddenException();
  const r=await this.db.query<{id:string;user_id:string}>('SELECT g.id,g.user_id FROM guest_payment_contexts g JOIN users u ON u.id=g.user_id WHERE g.token_digest=$1 AND g.expires_at>now() AND NOT u.disabled',[digestToken(token)]);
  const row=r.rows[0];if(!row)throw new UnauthorizedException();return {...row,token};
 }
 async context(req:Request,res:Response){
  // A cross-site form must not replace the browser's guest context.
  if(req.headers['sec-fetch-site']==='cross-site')throw new ForbiddenException();
  let existing:Awaited<ReturnType<GuestPaymentService['authenticate']>>|null=null;
  try{existing=await this.authenticate(req);}catch(error){if(!(error instanceof UnauthorizedException))throw error;}
  if(existing)return {id:existing.id,csrfToken:createCsrfToken(existing.token,this.secret)};
  this.requireEnabled();const token=createOpaqueToken(),id=randomUUID(),userId=`guest_${id}`;
  await this.db.transaction(async c=>{await c.query('INSERT INTO users(id) VALUES($1)',[userId]);await c.query("INSERT INTO guest_payment_contexts(id,user_id,token_digest,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",[id,userId,digestToken(token)]);});
  res.setHeader('Set-Cookie',secureCookie(GUEST_COOKIE,token,age));return {id,csrfToken:createCsrfToken(token,this.secret)};
 }
 async currentContext(req:Request){
  const existing=await this.authenticate(req);
  return {id:existing.id,csrfToken:createCsrfToken(existing.token,this.secret)};
 }
}
