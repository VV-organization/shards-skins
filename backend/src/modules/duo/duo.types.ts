import {BadRequestException} from '@nestjs/common';
import {shardsToRubReferenceMinor,sumShardsMinor} from '../../common/money/shards';
import type {CatalogProductDto} from '../catalog/catalog.types';
export function duoTotals(amounts:number[],budgetRubMinor:number){
 if(!Number.isSafeInteger(budgetRubMinor)||budgetRubMinor<0)throw new BadRequestException('INVALID_BUDGET');
 const totalCoinMinor=sumShardsMinor(amounts),totalRubMinor=shardsToRubReferenceMinor(totalCoinMinor);
 return {totalCoinMinor,totalRubMinor,budgetRubMinor,remainingRubMinor:budgetRubMinor-totalRubMinor,withinBudget:totalRubMinor<=budgetRubMinor};
}
export type DuoSnapshot=ReturnType<typeof duoTotals>&{items:CatalogProductDto[]};
export type DuoQuoteDto=DuoSnapshot&{id:string;expiresAt:string};
