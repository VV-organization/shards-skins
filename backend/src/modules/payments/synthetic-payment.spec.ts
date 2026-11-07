import {describe,expect,it,vi} from 'vitest';
import {assertSyntheticPaymentCreationAllowed,paymentEventSource,SYNTHETIC_PAYMENT_USER_ID} from './synthetic-payment';
import type {AppConfig} from '../../config/app-config';
const config={commerce:{paymentsEnabled:true},arcoPay:{providerMode:'real'}} as AppConfig;
describe('synthetic payment admission',()=>{
 it('allows ordinary customers without extra constraints',async()=>{const query=vi.fn();await assertSyntheticPaymentCreationAllowed({query} as never,config,'customer');expect(query).not.toHaveBeenCalled();expect(paymentEventSource('synthetic:someone-else')).toBe('customer');});
 it('rejects disabled/fake test invoice creation before querying',async()=>{const query=vi.fn();await expect(assertSyntheticPaymentCreationAllowed({query} as never,{...config,arcoPay:{...config.arcoPay,providerMode:'fake'}},SYNTHETIC_PAYMENT_USER_ID)).rejects.toThrow('SCENARIO_PAYMENTS_DISABLED');expect(query).not.toHaveBeenCalled();});
 it('blocks a new invoice when one unresolved technical payment exists',async()=>{const query=vi.fn().mockResolvedValue({rows:[{id:'pending'}]});await expect(assertSyntheticPaymentCreationAllowed({query} as never,config,SYNTHETIC_PAYMENT_USER_ID)).rejects.toThrow('SCENARIO_ATTEMPT_REQUIRES_REVIEW');expect(query.mock.calls[0]?.[0]).toContain("'manual_review'");});
 it('allows creation when no pending invoice exists',async()=>{const query=vi.fn().mockResolvedValue({rows:[]});await expect(assertSyntheticPaymentCreationAllowed({query} as never,config,SYNTHETIC_PAYMENT_USER_ID)).resolves.toBeUndefined();expect(paymentEventSource(SYNTHETIC_PAYMENT_USER_ID)).toBe('scenario');});
});
