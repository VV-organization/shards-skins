import {test,expect,type Locator} from '@playwright/test';
async function settled(target:Locator){await target.scrollIntoViewIfNeeded();await expect.poll(()=>target.evaluate(el=>{let node:Element|null=el;while(node){if(node.getAnimations().some(a=>a.id.startsWith('shards-enter:')))return false;node=node.parentElement;}return true;})).toBe(true);}
function product(index:number,categoryId='knife') {const id=`${categoryId}-${index}`;return {id,slug:id,kind:'skins',category:'Скины',categoryId,game:'cs2',productType:categoryId,title:`${categoryId==='knife'?'Huntsman Knife':'Hydra Gloves'} | Finish ${index} (Factory New)`,description:'Fixture',condition:'FN',weapon:categoryId==='knife'?'Huntsman Knife':'Hydra Gloves',stattrak:false,marketHashName:id,priceRevision:'r1',pricingSettingId:'p1',price:{currency:'COINS',amountMinor:10000+index,scale:2,display:'100'},availability:'available',fulfillmentMode:'steam-trade',createdAt:new Date().toISOString(),popularity:1,meta:[],keywords:[],details:{specifications:[],fulfillment:{title:'Steam',description:'Trade',requirements:[]}}};}
for(const width of [1440,390])test(`duo pagination, retry, keyboard and atomic cart at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const knives=Array.from({length:61},(_,i)=>product(i)),glove=product(0,'gloves');let failedPage=false;let version=0;let items:ReturnType<typeof product>[]=[];let quoteSerial=0;
 const quotes=new Map<string,ReturnType<typeof product>[]>();
 const cart=()=>({version,items:items.map(p=>({productId:p.id,productSlug:p.slug,kind:'skins',title:p.title,quantity:1,unitPriceCoinMinor:p.price.amountMinor,lineTotalCoinMinor:p.price.amountMinor,recipient:{},product:p,availability:'available'})),totalCoinMinor:items.reduce((s,p)=>s+p.price.amountMinor,0),canCheckout:items.length>0});
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace(/^\/api/,'');const send=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/session/me')return send({id:'duo-owner',steam:{connected:true}});
  if(path==='/session/csrf')return send({token:'csrf'});
  if(path==='/me/steam-trade-url/status')return send({configured:true});
  if(path==='/cart')return send(cart());
  if(path==='/duo/options'){
   if(url.searchParams.get('slot')==='gloves')return send({items:[glove],nextCursor:null});
   if(url.searchParams.has('cursor')){if(!failedPage){failedPage=true;return send({},503);}return send({items:[knives[60]],nextCursor:null});}
   return send({items:knives.slice(0,60),nextCursor:'page-two'});
  }
  if(path==='/duo/quotes'){
   const body=route.request().postDataJSON();const knife=knives.find(p=>p.id===body.knifeSlug);if(!knife||body.gloveSlug!==glove.id)return send({},400);
   const id=`quote-${++quoteSerial}`;quotes.set(id,[knife,glove]);const totalCoinMinor=knife.price.amountMinor+glove.price.amountMinor,totalRubMinor=Math.round(totalCoinMinor*5/8);
   return send({id,expiresAt:new Date(Date.now()+60000).toISOString(),items:[knife,glove],totalCoinMinor,totalRubMinor,budgetRubMinor:body.budgetRubMinor,remainingRubMinor:body.budgetRubMinor-totalRubMinor,withinBudget:true});
  }
  if(path==='/cart/duo'){const body=route.request().postDataJSON();expect(body.expectedCartVersion).toBe(version);items=quotes.get(body.quoteId)!;version++;return send(cart());}
  if(path.startsWith('/cart/items/')&&route.request().method()==='DELETE'){items=items.filter(p=>p.id!==path.split('/').at(-1));version++;return send(cart());}
  return send({},404);
 });
 await page.goto('http://127.0.0.1:5198/');
 const select=page.locator('#duo-0');await settled(select);await select.focus();await select.press('Enter');await select.press('End');
 await expect(page.getByRole('button',{name:'Повторить',exact:true})).toBeVisible();
 await select.press('Tab');await expect(page.getByRole('button',{name:'Повторить',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByRole('option')).toHaveCount(61);
 await select.focus();await select.press('End');await select.press('Enter');await expect(select).toContainText('Finish 60');
 await select.press('Enter');await select.press('Escape');await expect(select).toHaveAttribute('aria-expanded','false');await expect(select).toBeFocused();
 const add=page.getByRole('button',{name:'Добавить дуэт',exact:true});await expect(add).toBeEnabled();await settled(add);await add.click();
 await expect(page.getByText('Дуэт добавлен в корзину',{exact:true})).toBeVisible();
 await page.goto('http://127.0.0.1:5198/cart');await expect(page.locator('.cart-item')).toHaveCount(2);
 const remove=page.getByRole('button',{name:`Удалить ${knives[60].title}`});await settled(remove);await remove.click();await expect(page.locator('.cart-item')).toHaveCount(1);
 await page.reload();await expect(page.locator('.cart-item')).toHaveCount(1);expect(items[0]?.id).toBe(glove.id);
});
