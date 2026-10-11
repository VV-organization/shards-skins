import { expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { SteamCustomerGuard } from './steam-customer.guard';
import { CURRENT_CUSTOMER } from './current-customer';
it('rejects email-only identity for the wallet and cart', async()=>{
  const request = {[CURRENT_CUSTOMER]:{userId:'email',sessionId:'one'}};
  const context={switchToHttp:()=>({getRequest:()=>request})} as ExecutionContext;
  const guard=new SteamCustomerGuard({requireUser:()=>Promise.resolve({id:'email',steam:{connected:false}})} as never);
  await expect(guard.canActivate(context)).rejects.toMatchObject({status:403});
});
