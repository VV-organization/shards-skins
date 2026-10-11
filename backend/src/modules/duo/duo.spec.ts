import {describe,expect,it} from 'vitest';
import {duoTotals} from './duo.types';
describe('duo totals',()=>{
 it('rounds the pair only once and reports the design budget exactly',()=>{
  expect(duoTotals([1029000,1333080],2500000)).toEqual({totalCoinMinor:2362080,totalRubMinor:1476300,budgetRubMinor:2500000,remainingRubMinor:1023700,withinBudget:true});
 });
 it('does not silently raise an insufficient budget',()=>{expect(duoTotals([1029000,1333080],1000000)).toMatchObject({remainingRubMinor:-476300,withinBudget:false});});
 it('rejects fractional, negative and unsafe budgets',()=>{for(const value of [-1,.1,NaN,Number.MAX_SAFE_INTEGER+1])expect(()=>duoTotals([100,100],value)).toThrow();});
});
