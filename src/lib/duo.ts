import {parseAmount,sumPrices} from './money.ts';
export function duoQuote(prices:readonly number[],amount:string){const total=sumPrices(prices),budget=parseAmount(amount);return {...total,budget,remaining:budget===null?null:budget-total.rub,withinBudget:budget!==null&&budget>=total.rub};}
export function mergeCartIds(current:readonly string[],incoming:readonly string[],valid:readonly string[]){const allowed=new Set(valid);return [...new Set([...current,...incoming])].filter(id=>allowed.has(id));}
