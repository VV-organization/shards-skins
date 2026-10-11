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
