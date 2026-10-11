// Render the immutable designer commit on the SAME OS/browser as the comparison.
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const revision='8d513af5575df4f6b45ebab4c75c2304d1427c88';
const root=resolve('..'),workspace=resolve(root,'.qa/designer-original'),output=resolve(root,'.qa/visual-baseline-platform');
mkdirSync(workspace,{recursive:true});mkdirSync(output,{recursive:true});
execFileSync('git',['archive',revision,'--output='+resolve(workspace,'source.tar')],{cwd:root});
execFileSync('tar',['-xf','source.tar','-C',workspace],{cwd:workspace});
execFileSync('npm',['ci'],{cwd:workspace,stdio:'inherit'});
execFileSync('npm',['run','build'],{cwd:workspace,stdio:'inherit'});
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','5298'],{cwd:workspace,stdio:'inherit'});
let browser;
try{
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){
  if(server.exitCode!==null)throw new Error('Designer server exited');
  try{if((await fetch('http://127.0.0.1:5298')).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!ready)throw new Error('Designer server did not start');
 browser=await chromium.launch();const page=await browser.newPage();
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const [width,height] of [[1440,900],[768,1024],[390,844],[320,780]]){
  await page.setViewportSize({width,height});
  for(const [name,path] of [['home','/'],['catalog','/catalog']]){
   await page.goto('http://127.0.0.1:5298'+path,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:resolve(output,name+'-'+width+'.png'),fullPage:true});
  }
 }
 writeFileSync(resolve(output,'provenance.json'),JSON.stringify({revision,platform:process.platform,browser:browser.version()},null,2));
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
