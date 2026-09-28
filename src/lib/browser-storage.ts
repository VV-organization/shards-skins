type StoragePort={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
export function createSafeStorage(getStorage:()=>StoragePort){
 const memory=new Map<string,string>(),pending=new Set<string>();
 return {
  read(key:string,fallback:string){if(pending.has(key))return memory.get(key)??fallback;try{return getStorage().getItem(key)??memory.get(key)??fallback;}catch{return memory.get(key)??fallback;}},
  write(key:string,value:string){memory.set(key,value);try{getStorage().setItem(key,value);pending.delete(key);}catch{pending.add(key);}},
  invalidate(key:string|null){if(key===null){memory.clear();pending.clear();}else{memory.delete(key);pending.delete(key);}},
 };
}
