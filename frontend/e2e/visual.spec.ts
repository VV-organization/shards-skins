import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
for(const [width,height] of [[1440,900],[768,1024],[390,844],[320,780]])test(`designer composition at ${width}`,async({page})=>{
 await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'reduce'});
 for(const [name,path] of [['home','/'],['catalog','/catalog']]){
  await page.goto(path,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  mkdirSync('../.qa/visual-current',{recursive:true});await page.screenshot({path:`../.qa/visual-current/${name}-${width}.png`,fullPage:true});
  if(name==='home'){const duo=page.locator('#duo');await duo.scrollIntoViewIfNeeded();await expect.poll(()=>duo.locator('img').evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true);await duo.screenshot({path:`../.qa/visual-current/duo-${width}.png`});}
 }
});
