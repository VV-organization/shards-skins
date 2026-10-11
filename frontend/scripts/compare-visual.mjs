import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const baseline=process.platform==='darwin'?'../docs/testing/visual-baseline':'../.qa/visual-baseline-platform';
const browser=await chromium.launch(),page=await browser.newPage(),results=[];
for(const width of [1440,768,390,320])for(const name of ['home','catalog']){
 const source=`${baseline}/${name}-${width}.png`,current=`../.qa/visual-current/${name}-${width}.png`;
 const result=await page.evaluate(async({a,b})=>{
  const load=async src=>{const i=new Image();i.src=src;await i.decode();return i;};const [old,next]=await Promise.all([load(a),load(b)]);
  const w=Math.min(old.width,next.width),h=Math.min(old.height,next.height);
  const pixels=i=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(i,0,0);return c.getContext('2d').getImageData(0,0,w,h).data;};
  const x=pixels(old),y=pixels(next);let changed=0,upperChanged=0;const upper=Math.min(h,550);
  for(let i=0;i<x.length;i+=4){if(Math.max(...[0,1,2].map(j=>Math.abs(x[i+j]-y[i+j])))>12){changed++;if(i/4<w*upper)upperChanged++;}}
  return {baseline:{width:old.width,height:old.height},current:{width:next.width,height:next.height},changedFraction:changed/(w*h),upper550ChangedFraction:upperChanged/(w*upper)};
 },{a:`data:image/png;base64,${readFileSync(source).toString('base64')}`,b:`data:image/png;base64,${readFileSync(current).toString('base64')}`});
 results.push({page:name,width,...result});
 if(result.upper550ChangedFraction>(name==='home'?0.001:0.025))throw new Error(`Unexpected header/hero difference: ${name}-${width}`);
}
writeFileSync('../.qa/visual-current/comparison.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await browser.close();
