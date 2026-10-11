type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type DisplayRevision={slug:string;priceRevision:string};
export type PendingIntent={kind:'item'|'duo';slugs:string[];budgetRubMinor?:number;displayedRevisions:DisplayRevision[];createdAt:number;nonce:string;returnTo:'/cart'};
const KEY='shards:pending-intent';
const TTL=15*60*1000;
export function clearPendingIntent(storage:StorageLike) { try{storage.removeItem(KEY);}catch{} }
export function savePendingIntent(storage:StorageLike,input:Pick<PendingIntent,'kind'|'slugs'|'budgetRubMinor'|'displayedRevisions'>,now=Date.now()):PendingIntent {
  const intent:PendingIntent={...input,createdAt:now,nonce:crypto.randomUUID(),returnTo:'/cart'};
  try{storage.setItem(KEY,JSON.stringify(intent));}catch{}
  return intent;
}
export function readPendingIntent(storage:StorageLike,now=Date.now()):PendingIntent|null {
  try {
    const value:unknown=JSON.parse(storage.getItem(KEY)??'null');
    if(!value||typeof value!=='object')return null;
    const v=value as Record<string,unknown>;
    if((v.kind!=='item'&&v.kind!=='duo')||v.returnTo!=='/cart'||typeof v.nonce!=='string'||typeof v.createdAt!=='number'||v.createdAt>now||now-v.createdAt>TTL||!Array.isArray(v.slugs)||v.slugs.length!==(v.kind==='duo'?2:1)||!v.slugs.every(x=>typeof x==='string'&&x.length>0&&x.length<=250)||new Set(v.slugs).size!==v.slugs.length||!Array.isArray(v.displayedRevisions)||!v.displayedRevisions.every(x=>x&&typeof x==='object'&&typeof x.slug==='string'&&typeof x.priceRevision==='string')||(v.budgetRubMinor!==undefined&&(!Number.isSafeInteger(v.budgetRubMinor)||Number(v.budgetRubMinor)<0))){clearPendingIntent(storage);return null;}
    return v as PendingIntent;
  } catch {clearPendingIntent(storage);return null;}
}
export function revisionsMatch(intent:PendingIntent,fresh:DisplayRevision[]):boolean {
  return intent.slugs.every(slug=>{const old=intent.displayedRevisions.find(x=>x.slug===slug);return Boolean(old?.priceRevision&&fresh.some(x=>x.slug===slug&&x.priceRevision===old.priceRevision));});
}
