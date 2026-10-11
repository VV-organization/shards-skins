import {describe,it,expect,vi} from 'vitest';
import {OrdersService} from './orders.service';
import type {DatabaseService} from '../../common/database/database.service';
describe('order history financial and delivery boundaries',()=>{
 it('does not label a paid Steam payment without delivery evidence as delivered',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'payment',user_id:'owner',status:'paid',amount_rub_minor:10000,steam_login:'login',created_at:new Date()}]});
  const service=new OrdersService({query} as unknown as DatabaseService);
  const result=await service.listUserOrders('owner');
  expect(result.orders[0]?.status).toBe('held');expect(result.orders[0]?.lines[0]?.fulfillmentStage).toBe('pending');
 });
});
