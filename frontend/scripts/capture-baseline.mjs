import {existsSync} from 'node:fs';
if(existsSync('../docs/testing/visual-baseline/home-1440.png'))throw new Error('Baseline already exists; do not overwrite approved evidence.');
import { chromium } from '@playwright/test';
const browser=await chromium.launch();
for(const [width,height] of [[1440,900],[768,1024],[390,844],[320,780]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
 await page.goto('http://127.0.0.1:5198/',{waitUntil:'networkidle'});
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`../docs/testing/visual-baseline/home-${width}.png`,fullPage:true});
 await page.goto('http://127.0.0.1:5198/catalog',{waitUntil:'networkidle'});
 await page.screenshot({path:`../docs/testing/visual-baseline/catalog-${width}.png`,fullPage:true});
 await page.close();
}
await browser.close();
