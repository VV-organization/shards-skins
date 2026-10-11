import {CommandJournal,type JournalCommand} from './command-journal.ts';
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Options = { signal?: AbortSignal; idempotencyKey?: string; anonymous?: boolean };
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, details: Record<string, unknown>) {
    super(typeof details.message === 'string' ? details.message : typeof details.detail === 'string' ? details.detail : 'Не удалось выполнить действие');
    this.name = 'ApiError'; this.status=status; this.code=typeof details.code==='string'?details.code:`HTTP_${status}`; this.details=details;
  }
}
/** A generation invalidates both network work and deferred responses across owner changes. */
export class ApiClient {
  private fetcher: Fetch;
  private generation=0;
  private owner: string|null=null;
  private csrf: string|null=null;
  private controllers=new Set<AbortController>();
  private keys=new Map<string,string>();
  private journal=new CommandJournal();
  constructor(fetcher:Fetch=(input,init)=>fetch(input,init)) { this.fetcher=fetcher; }
  setOwner(owner:string|null) { if(owner!==this.owner){if(this.owner)this.journal.clear(this.owner);this.reset();this.owner=owner;} }
  reset() { this.generation++;this.csrf=null;this.keys.clear();for(const controller of this.controllers)controller.abort();this.controllers.clear(); }
  commandKey(purpose:string,intent:string) {
    if(!this.owner)throw new ApiError(401,{code:'SESSION_REQUIRED'});
    const scope=JSON.stringify([this.owner,purpose,intent]);
    let key=this.keys.get(scope);if(!key){key=crypto.randomUUID();this.keys.set(scope,key);}return key;
  }
  pendingCommand(intent:string) {return this.owner?this.journal.pending(this.owner,intent):null;}
  async command<T>(intent:string,method:JournalCommand['method'],path:string,body:unknown):Promise<T> {
    const owner=this.owner;if(!owner)throw new ApiError(401,{code:'SESSION_REQUIRED'});
    const command=this.journal.begin(owner,intent,method,path,body);
    try {
      const result=await this.request<T>(command.method,command.path,command.body,{idempotencyKey:command.key});
      this.journal.complete(owner,intent);return result;
    } catch(error) {
      // A definitive client rejection did not commit. Network/5xx outcomes remain replayable.
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408&&error.status!==429)this.journal.complete(owner,intent);
      throw error;
    }
  }
  get<T>(path:string,options:Options={}) { return this.request<T>('GET',path,undefined,options); }
  post<T>(path:string,body:unknown,options:Options={}) { return this.request<T>('POST',path,body,options); }
  put<T>(path:string,body:unknown,options:Options={}) { return this.request<T>('PUT',path,body,options); }
  delete<T>(path:string,body:unknown,options:Options={}) { return this.request<T>('DELETE',path,body,options); }
  private async request<T>(method:string,path:string,body:unknown,options:Options):Promise<T> {
    if(!path.startsWith('/')||path.startsWith('//')||path.includes('://'))throw new Error('Invalid API path');
    const epoch=this.generation;
    const current=()=>{if(epoch!==this.generation)throw new DOMException('Session changed','AbortError');};
    const controller=new AbortController();this.controllers.add(controller);
    const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    try {
      const headers:Record<string,string>={Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(method!=='GET'&&!options.anonymous){
        if(!this.csrf){const result=await this.get<{token:string}>('/session/csrf',{signal});current();this.csrf=result.token;}
        headers['x-csrf-token']=this.csrf;
      }
      if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
      current();
      const response=await this.fetcher(`/api${path}`,{method,headers,credentials:'same-origin',cache:'no-store',signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
      const data:unknown=response.status===204?undefined:await response.json().catch(()=>({message:'Не удалось прочитать ответ сервера'}));
      current();
      if(!response.ok)throw new ApiError(response.status,data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{});
      return data as T;
    } finally {this.controllers.delete(controller);}
  }
}
export const api=new ApiClient();
export function errorMessage(error:unknown):string { return error instanceof Error ? error.message : 'Не удалось выполнить действие'; }
