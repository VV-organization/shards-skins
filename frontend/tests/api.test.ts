import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError } from '../src/lib/api.ts';
test('an old account response cannot be accepted after session reset', async () => {
  let complete!: (r:Response)=>void;
  const client = new ApiClient(() => new Promise<Response>(resolve=>{complete=resolve;}));
  client.setOwner('first');
  const pending = client.get('/session/me');
  client.setOwner('second');
  complete(Response.json({id:'first'}));
  await assert.rejects(pending, {name:'AbortError'});
});
test('writes use same-origin credentials, CSRF and the same command key across retries', async () => {
  const requests: Array<{url:string;options?:RequestInit}> = [];
  const client = new ApiClient(async (url,options)=>{requests.push({url:String(url),options});return Response.json(String(url).endsWith('/csrf')?{token:'csrf'}:{ok:true});});
  client.setOwner('owner');
  const key = client.commandKey('cart','intent');
  assert.equal(client.commandKey('cart','intent'),key);
  await client.post('/cart/duo',{quoteId:'one'},{idempotencyKey:key});
  const sent = requests[1];
  assert.equal(sent?.url,'/api/cart/duo');
  assert.equal(sent?.options?.credentials,'same-origin');
  assert.equal(new Headers(sent?.options?.headers).get('x-csrf-token'),'csrf');
  client.setOwner(null);
  client.setOwner('owner');
  assert.notEqual(client.commandKey('cart','intent'),key);
});
test('structured errors retain server data and status', async () => {
  const client = new ApiClient(async()=>Response.json({code:'CART_VERSION_CONFLICT',currentVersion:4},{status:409}));
  await assert.rejects(client.get('/cart'),(error:unknown)=>error instanceof ApiError && error.status===409 && error.code==='CART_VERSION_CONFLICT' && error.details.currentVersion===4);
});

test('unreadable successful command retains original request and key', async () => {
  let broken=true;const keys:string[]=[];const bodies:unknown[]=[];
  const client=new ApiClient(async(url,init)=>{if(String(url).endsWith('/csrf'))return Response.json({token:'token'});keys.push(new Headers(init?.headers).get('Idempotency-Key')!);bodies.push(init?.body);return broken?new Response('{broken',{status:200}):Response.json({id:'payment'});});
  client.setOwner('owner');
  await assert.rejects(client.command('payment','POST','/payments/top-up/sessions',{quoteId:'original'}));
  assert.ok(client.pendingCommand('payment'));broken=false;
  await client.command('payment','POST','/payments/top-up/sessions',{quoteId:'new'});
  assert.equal(keys[0],keys[1]);assert.equal(bodies[0],bodies[1]);assert.equal(client.pendingCommand('payment'),null);
});
test('session rotation refreshes csrf while preserving same-owner recovery',async()=>{
 let token='old';const tokens:string[]=[];let fail=true;
 const client=new ApiClient(async(url,init)=>{if(String(url).endsWith('/csrf'))return Response.json({token});tokens.push(new Headers(init?.headers).get('x-csrf-token')!);if(fail)throw new Error('lost response');return Response.json({id:'order'});});
 client.setOwner('owner');await assert.rejects(client.command('checkout','POST','/checkout/cart',{quoteId:'original'}));
 const pending=client.pendingCommand('checkout');token='new';client.reset();client.setOwner('owner');fail=false;
 assert.deepEqual(client.pendingCommand('checkout'),pending);await client.command('checkout','POST','/checkout/cart',{});assert.deepEqual(tokens,['old','new']);
});

test('incomplete successful financial result retains recovery until valid response',async()=>{
 let complete=false;const client=new ApiClient(async url=>Response.json(String(url).endsWith('/csrf')?{token:'token'}:complete?{id:'payment',checkoutUrl:null}:{id:'payment'}));client.setOwner('owner');
 const valid=(value:{id:string;checkoutUrl:string|null})=>typeof value?.id==='string'&&(value.checkoutUrl===null||typeof value.checkoutUrl==='string');
 await assert.rejects(client.command('payment','POST','/payments/top-up/sessions',{},valid));assert.ok(client.pendingCommand('payment'));complete=true;await client.command('payment','POST','/payments/top-up/sessions',{},valid);assert.equal(client.pendingCommand('payment'),null);
});

test('guest context uses separate CSRF and keeps unresolved commands across customer login',async()=>{
 const sent:Array<{url:string;headers:Headers}>=[];let fail=true;
 const guest=new ApiClient(async(url,init)=>{sent.push({url:String(url),headers:new Headers(init?.headers)});if(fail)throw new Error('lost');return Response.json({id:'payment'});});
 guest.setContext('guest:one','guest-csrf');
 await assert.rejects(guest.command('steam','POST','/payments/guest/steam-refill/sessions',{quoteId:'first'}));
 const customer=new ApiClient();customer.setOwner('steam-account');customer.setOwner(null);
 guest.setContext('guest:one','guest-csrf-new');fail=false;
 await guest.command('steam','POST','/payments/guest/steam-refill/sessions',{quoteId:'different'});
 assert.equal(sent.length,2);assert.equal(sent[0]?.headers.get('x-csrf-token'),'guest-csrf');assert.equal(sent[1]?.headers.get('x-csrf-token'),'guest-csrf-new');assert.equal(sent[0]?.headers.get('Idempotency-Key'),sent[1]?.headers.get('Idempotency-Key'));
});
