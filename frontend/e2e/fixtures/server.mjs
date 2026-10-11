// Explicit local test server. Never imported by application code or enabled in production.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const design=JSON.parse(readFileSync(new URL('../../src/data/catalog.json',import.meta.url),'utf8'));
const slots=JSON.parse(readFileSync(new URL('../../src/data/presentation.json',import.meta.url),'utf8'));
const items=design.products.map((p,i)=>{const slot=slots.find(s=>s.slot===p.id);return {id:slot?.slug??p.id,slug:slot?.slug??p.id,kind:'skins',category:'Скины',categoryId:p.categoryId,game:'cs2',productType:p.weapon,title:p.name,description:p.description,image:p.imageUrl,condition:p.condition,weapon:p.weapon,stattrak:p.stattrak,marketHashName:slot?.marketHashName??p.name,priceRevision:`fixture-${i}`,pricingSettingId:'fixture',price:{currency:'COINS',amountMinor:p.priceMinor,scale:2,display:''},availability:'available',fulfillmentMode:'steam-trade',createdAt:'2026-10-11T00:00:00Z',popularity:design.products.length-i,meta:[p.rarity],keywords:[],details:{specifications:[],fulfillment:{title:'Steam',description:'',requirements:[]}}};});
const config={currency:'Shards',rate:{fiatMinor:100,coinMinor:160},rateVersion:'fixture',paymentMethods:['sbp'],capabilities:{checkoutEnabled:true,walletTopUpEnabled:true,steamRefillEnabled:true}};
createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1:5199');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/health/live')return send({status:'fixture'});
 if(url.pathname==='/storefront/config')return send(config);
 if(url.pathname==='/session/me')return send({message:'Guest'},401);
 if(url.pathname==='/catalog/lookup')return send({items:items.filter(p=>body.slugs.includes(p.slug))});
 if(url.pathname==='/catalog')return send({items:items.slice(0,60),facets:{kinds:[],games:[],productTypes:[],conditions:[],fulfillmentModes:[],availability:[]},pagination:{limit:60,offset:0,total:items.length,hasMore:false},pricing:{coinRate:{fiatCurrency:'RUB',fiatMinor:100,coinMinor:160,display:'1.6'}}});
 if(url.pathname==='/duo/options')return send({items:items.filter(p=>p.categoryId===url.searchParams.get('slot')).slice(0,60),nextCursor:null});
 if(url.pathname==='/duo/quotes'){const pair=[items.find(p=>p.slug===body.knifeSlug),items.find(p=>p.slug===body.gloveSlug)];if(pair.some(p=>!p))return send({},400);const totalCoinMinor=pair.reduce((s,p)=>s+p.price.amountMinor,0),totalRubMinor=Math.round(totalCoinMinor*5/8);return send({id:'fixture-quote',expiresAt:new Date(Date.now()+60000).toISOString(),items:pair,totalCoinMinor,totalRubMinor,budgetRubMinor:body.budgetRubMinor,remainingRubMinor:body.budgetRubMinor-totalRubMinor,withinBudget:totalRubMinor<=body.budgetRubMinor});}
 if(url.pathname.startsWith('/catalog/'))return send(items.find(p=>p.slug===url.pathname.split('/').at(-1))??{},items.some(p=>p.slug===url.pathname.split('/').at(-1))?200:404);
 return send({},404);
}).listen(5199,'127.0.0.1',()=>process.stdout.write('Shards test fixture on 5199\n'));
