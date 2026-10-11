import {expect,it} from 'vitest';
import type {ExecutionContext} from '@nestjs/common';
import {CommerceEnabledGuard} from './commerce-enabled.guard';
import {loadAppConfig} from './app-config';
const context=(method:string,path:string)=>({switchToHttp:()=>({getRequest:()=>({method,path})})}) as ExecutionContext;
it('does not accept direct Steam payments while new fulfillment is disabled',()=>{
 const guard=new CommerceEnabledGuard(loadAppConfig({SHARDS_PAYMENTS_ENABLED:'true',SHARDS_CHECKOUT_ENABLED:'true',SHARDS_FULFILLMENT_ENABLED:'false'}));
 expect(()=>guard.canActivate(context('POST','/payments/steam-refill/sessions'))).toThrow();
 expect(()=>guard.canActivate(context('POST','/checkout/cart'))).toThrow();
 expect(guard.canActivate(context('POST','/payments/top-up/sessions'))).toBe(true);
 expect(guard.canActivate(context('POST','/payments/webhooks/arc-pay'))).toBe(true);
 expect(guard.canActivate(context('GET','/payments/sessions/id'))).toBe(true);
});
