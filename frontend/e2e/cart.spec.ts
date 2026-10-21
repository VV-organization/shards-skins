import {test,expect,type Locator} from '@playwright/test';
async function clickAfterEntrance(target:Locator){
 await target.scrollIntoViewIfNeeded();
 await expect.poll(()=>target.evaluate(el=>{let node:Element|null=el;while(node){if(node.getAnimations().some(a=>a.id.startsWith('shards-enter:')))return false;node=node.parentElement;}return true;})).toBe(true);
 await target.click();
}

test('guest selection survives Steam return; confirmed cart survives reload and removal',async({page})=>{
 let authenticated=false;let version=0;let present=false;
 const product={id:'fixture-knife',slug:'fixture-knife',kind:'skins',category:'Ножи',categoryId:'knife',game:'cs2',productType:'Нож',title:'Huntsman Knife | Damascus Steel (Factory New)',description:'Fixture',condition:'FN',weapon:'Huntsman Knife',stattrak:false,marketHashName:'★ Huntsman Knife | Damascus Steel (Factory New)',priceRevision:'r1',pricingSettingId:'p1',price:{currency:'COINS',amountMinor:10000,scale:2,display:'100'},availability:'available',fulfillmentMode:'steam-trade',createdAt:new Date().toISOString(),popularity:1,meta:[],keywords:[],details:{specifications:[],fulfillment:{title:'Steam',description:'Trade',requirements:[]}}};
 const cart=()=>({version,items:present?[{productId:product.id,productSlug:product.slug,kind:'skins',title:product.title,quantity:1,unitPriceCoinMinor:10000,lineTotalCoinMinor:10000,recipient:{},product,availability:'available'}]:[],totalCoinMinor:present?10000:0,canCheckout:present});
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());const path=url.pathname.replace(/^\/api/,'');
  const send=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/session/me')return send(authenticated?{id:'owner',steam:{connected:true,steamId64:'76561198000000000'}}:{message:'Sign in'},authenticated?200:401);
  if(path==='/auth/steam/start'){authenticated=true;return route.fulfill({status:302,headers:{location:'/cart'}});}
  if(path==='/session/csrf')return send({token:'fixture'});
  if(path==='/me/steam-trade-url/status')return send({configured:true});
  if(path==='/catalog/lookup')return send({items:[product]});
  if(path==='/catalog')return send({items:[product],categoryCounts:{all:1,byCategory:{knife:1}},facets:{kinds:[],games:[],productTypes:[],conditions:[],fulfillmentModes:[],availability:[]},pagination:{limit:60,offset:0,total:1,hasMore:false},pricing:{coinRate:{fiatCurrency:'RUB',fiatMinor:100,coinMinor:160,display:'1.6'}}});
  if(path==='/cart')return send(cart());
  if(path==='/cart/items/fixture-knife'){
   expect(authenticated).toBe(true);expect(route.request().headers()['idempotency-key']).toBeTruthy();
   expect(route.request().postDataJSON().expectedCartVersion).toBe(version);
   present=route.request().method()==='PUT';version++;return send(cart());
  }
  return send({},404);
 });
 await page.goto('http://127.0.0.1:5198/catalog');
 await clickAfterEntrance(page.getByRole('button',{name:`В корзину: ${product.title}`,exact:true}));
 await clickAfterEntrance(page.getByRole('link',{name:'Войти через Steam',exact:true}));
 await expect(page).toHaveURL(/\/cart$/);
 await expect(page.getByText('Добавлено в корзину',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:`Удалить ${product.title}`})).toBeVisible();
 await page.reload();
 await clickAfterEntrance(page.getByRole('button',{name:`Удалить ${product.title}`}));
 await expect(page.getByRole('button',{name:`Удалить ${product.title}`})).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('button',{name:`Удалить ${product.title}`})).toHaveCount(0);
});
