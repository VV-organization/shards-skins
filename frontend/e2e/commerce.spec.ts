import {test,expect,type Locator,type Page} from '@playwright/test';
async function settled(target:Locator){await target.scrollIntoViewIfNeeded();await expect.poll(()=>target.evaluate(el=>{let node:Element|null=el;while(node){if(node.getAnimations().some(a=>a.id.startsWith('shards-enter:')))return false;node=node.parentElement;}return true;})).toBe(true);await target.click();}
const sessionId='11111111-1111-4111-8111-111111111111';
const product={id:'knife',slug:'knife',kind:'skins',category:'Ножи',categoryId:'knife',game:'cs2',productType:'Нож',title:'Huntsman Knife | Damascus Steel',description:'',condition:'FN',weapon:'Huntsman Knife',stattrak:false,marketHashName:'knife',priceRevision:'r1',pricingSettingId:'p1',price:{currency:'COINS',amountMinor:25001,scale:2,display:'250,01'},availability:'available',fulfillmentMode:'steam-trade',createdAt:new Date().toISOString(),popularity:1,meta:[],keywords:[],details:{specifications:[],fulfillment:{title:'Steam',description:'',requirements:[]}}};
async function fixture(page:Page){
 const state={available:10000,held:90000,trade:true,fulfillment:'pending',checkoutCalls:0,paymentCalls:0,failSession:false,keys:[] as string[],bodies:[] as unknown[]};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace(/^\/api/,'');const body=()=>route.request().postDataJSON();const send=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/session/me')return send({id:'owner',steam:{connected:true,steamId64:'76561198000000000'},email:{address:'owner@example.test',verified:true}});
  if(path==='/session/csrf')return send({token:'csrf'});
  if(path==='/storefront/config')return send({paymentMethods:['sbp'],capabilities:{checkoutEnabled:true,walletTopUpEnabled:true,steamRefillEnabled:true}});
  if(path==='/wallet/me')return send({postedCoinMinor:state.available+state.held,availableCoinMinor:state.available,heldCoinMinor:state.held});
  if(path==='/me/steam-trade-url/status')return send({configured:state.trade});
  if(path==='/me/steam-trade-url'){state.trade=true;return send({configured:true});}
  if(path==='/cart')return send({version:1,items:[{product,quantity:1,availability:'available'}],totalCoinMinor:25001,canCheckout:true});
  if(path==='/checkout/quotes')return send({id:'checkout-quote',expiresAt:new Date(Date.now()+60000).toISOString(),cartVersion:1,items:[product],totalCoinMinor:25001,totalRubMinor:15626,recipient:{steamId64:'76561198000000000',partner:'1'}});
  if(path==='/checkout/cart'){state.checkoutCalls++;return send({id:'order'});}
  if(path==='/orders/me')return send({orders:[]});
  if(path==='/wallet/me/transactions')return send({transactions:[]});
  if(path==='/payments/me/history')return send({payments:[]});
  if(path==='/payments/top-up/quotes')return send({quoteId:crypto.randomUUID(),purpose:'wallet_topup',coinAmountMinor:body().coinAmountMinor,fiatAmountMinor:Math.ceil(body().coinAmountMinor*5/8),currency:'RUB',termsVersion:'v1',expiresAt:new Date(Date.now()+60000).toISOString()});
  if(path==='/payments/top-up/sessions'){state.paymentCalls++;state.keys.push(route.request().headers()['idempotency-key']);state.bodies.push(body());if(state.failSession)return route.abort('failed');return send({id:sessionId,checkoutUrl:null});}
  if(path===`/payments/sessions/${sessionId}`)return send({id:sessionId,purpose:'steam_refill',paymentStatus:'paid',fulfillmentStatus:state.fulfillment,fiatAmountMinor:105000,steamLogin:'player',checkoutUrl:null,refundStatus:null});
  return send({},404);
 });return state;
}
for(const width of [1440,390])test(`available balance shortfall and explicit purchase ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await fixture(page);await page.goto('http://127.0.0.1:5198/cart');
 await expect(page.getByText(/Доступно 100 Shards/)).toBeVisible();await expect(page.getByText(/Не хватает 150,01 Shards/)).toBeVisible();
 await expect(page.getByRole('radio')).toHaveCount(1);await expect(page.getByRole('radio',{name:'Баланс Shards'})).toBeChecked();
 await settled(page.getByRole('link',{name:'Пополнить баланс',exact:true}));await expect(page).toHaveURL(/amount=151/);
 await expect(page.getByLabel('Сколько Shards зачислить')).toHaveValue('151');expect(state.checkoutCalls).toBe(0);
 state.available=30000;await settled(page.getByRole('link',{name:'Продолжить покупку',exact:true}));await expect(page.getByRole('button',{name:'Купить скины',exact:true})).toBeEnabled();expect(state.checkoutCalls).toBe(0);
 await settled(page.getByRole('button',{name:'Купить скины',exact:true}));await expect(page).toHaveURL(/tab=orders/);expect(state.checkoutCalls).toBe(1);
});
test('unknown payment creation survives reload with exact original command',async({page})=>{
 const state=await fixture(page);state.failSession=true;await page.goto('http://127.0.0.1:5198/account?tab=balance&amount=151');
 await settled(page.locator('form').getByRole('button',{name:'Пополнить баланс',exact:true}));await expect(page.getByText(/Результат запроса пока неизвестен/)).toBeVisible();
 await page.reload();state.failSession=false;await settled(page.getByRole('button',{name:'Проверить результат запроса',exact:true}));await expect(page).toHaveURL(/payments\/return/);
 expect(state.paymentCalls).toBe(2);expect(state.keys[0]).toBe(state.keys[1]);expect(state.bodies[0]).toEqual(state.bodies[1]);
 await page.goto('http://127.0.0.1:5198/account?tab=balance');await settled(page.getByRole('button',{name:'Открыть созданный платёж'}));await expect(page).toHaveURL(/payments\/return/);expect(state.paymentCalls).toBe(2);
});
test('paid Steam is pending; callback query cannot declare delivery',async({page})=>{
 const state=await fixture(page);await page.goto(`http://127.0.0.1:5198/payments/return?session=${sessionId}&payment=success`);
 await expect(page.getByRole('heading',{name:'Оплата получена. Пополнение Steam выполняется.'})).toBeVisible();expect(state.paymentCalls).toBe(0);
 state.fulfillment='delivered';await settled(page.getByRole('button',{name:'Обновить статус'}));await expect(page.getByRole('heading',{name:'Баланс Steam пополнен'})).toBeVisible();expect(state.paymentCalls).toBe(0);
});
test('trade URL saves and returns to the preserved cart',async({page})=>{
 const state=await fixture(page);state.trade=false;await page.goto('http://127.0.0.1:5198/cart');await settled(page.getByRole('link',{name:'Добавить trade-URL'}));
 await page.getByLabel('Ссылка на обмен Steam').fill('https://steamcommunity.com/tradeoffer/new/?partner=39734272&token=abcdefgh');await settled(page.getByRole('button',{name:'Сохранить',exact:true}));
 await settled(page.getByRole('link',{name:'Продолжить покупку',exact:true}));await expect(page).toHaveURL(/\/cart$/);await expect(page.getByText('Trade-URL сохранён. Его можно изменить в кабинете.')).toBeVisible();
});
