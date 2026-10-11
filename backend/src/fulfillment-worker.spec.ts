import {describe,expect,it} from 'vitest';
import {parseFulfillmentWorkerOptions,runFulfillmentWorkerCycle} from './fulfillment-worker';
describe('fair fulfillment worker',()=>{
 it('runs submit and reconciliation budgets in every busy cycle',async()=>{
  const calls:string[]=[];
  const result=await runFulfillmentWorkerCycle({recoverExpired:()=>Promise.resolve(0),settleTerminalHolds:()=>Promise.resolve(0),submitNext:()=>{calls.push('submit');return Promise.resolve({status:'completed',commandId:'new'});},reconcileNext:()=>{calls.push('reconcile');return Promise.resolve({status:'completed',commandId:'old'});}}, {skinTestMode:false});
  expect(calls).toEqual(['submit','reconcile']);expect(result.didWork).toBe(true);
 });
 it('does not let a submit error starve reconciliation',async()=>{
  let reconciled=false;await runFulfillmentWorkerCycle({recoverExpired:()=>Promise.resolve(0),settleTerminalHolds:()=>Promise.resolve(0),submitNext:()=>Promise.reject(new Error('submit failed')),reconcileNext:()=>{reconciled=true;return Promise.resolve({status:'none'});}}, {skinTestMode:false});expect(reconciled).toBe(true);
 });
 it('parses bounded production-safe loop options',()=>{expect(parseFulfillmentWorkerOptions(['--once'],{FULFILLMENT_WORKER_INTERVAL_MS:'15000',FULFILLMENT_WORKER_SKIN_TEST_MODE:'no'})).toEqual({intervalMs:15000,once:true,skinTestMode:false});});
});
