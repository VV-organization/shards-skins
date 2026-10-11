type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type JournalCommand={key:string;method:'POST'|'PUT'|'DELETE';path:string;body:unknown};
/** Persist exact requests, not just keys: a reload must not retry a changed payload. */
export class CommandJournal {
 private storage:()=>StorageLike;
 private fallback=new Map<string,Record<string,JournalCommand>>();
 constructor(storage:()=>StorageLike=()=>sessionStorage){this.storage=storage;}
 private storageKey(owner:string){return `shards:commands:${owner}`;}
 private read(owner:string):Record<string,JournalCommand>{
  try {const value:unknown=JSON.parse(this.storage().getItem(this.storageKey(owner))??'{}');if(value&&typeof value==='object'&&!Array.isArray(value))return value as Record<string,JournalCommand>;}catch{}
  return this.fallback.get(owner)??{};
 }
 private write(owner:string,value:Record<string,JournalCommand>){this.fallback.set(owner,value);try{this.storage().setItem(this.storageKey(owner),JSON.stringify(value));}catch{}}
 pending(owner:string,intent:string):JournalCommand|null {return this.read(owner)[intent]??null;}
 begin(owner:string,intent:string,method:JournalCommand['method'],path:string,body:unknown):JournalCommand {
  const all=this.read(owner);const prior=all[intent];
  if(prior&&prior.method===method&&prior.path===path&&typeof prior.key==='string')return prior;
  const command={key:crypto.randomUUID(),method,path,body};all[intent]=command;this.write(owner,all);return command;
 }
 complete(owner:string,intent:string){const all=this.read(owner);delete all[intent];this.write(owner,all);}
 clear(owner:string){this.fallback.delete(owner);try{this.storage().removeItem(this.storageKey(owner));}catch{}}
}
