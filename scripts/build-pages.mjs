import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const project=process.cwd();
const stage=await mkdtemp(path.join(tmpdir(),"prism-skins-pages-"));
const basePath=process.env.PRISM_PAGES_BASE_PATH??"/prism-skins-site";
if(basePath && !/^\/[a-zA-Z0-9_-]+$/.test(basePath))throw new Error("Invalid Pages base path");
try {
  for(const entry of ["src","public","next.config.ts","next-env.d.ts","tsconfig.json","package.json"]){
    await cp(path.join(project,entry),path.join(stage,entry),{recursive:true});
  }
  // Only the isolated export copy excludes server routes. The Node app retains them.
  await rm(path.join(stage,"src/app/api"),{recursive:true});
  await symlink(path.join(project,"node_modules"),path.join(stage,"node_modules"),"dir");
  const result=spawnSync(process.execPath,[path.join(project,"node_modules/next/dist/bin/next"),"build","--webpack"],{
    cwd:stage,stdio:"inherit",env:{...process.env,NEXT_PUBLIC_STATIC_EXPORT:"true",NEXT_PUBLIC_BASE_PATH:basePath,NEXT_PUBLIC_CATALOG_MODE:"preview"},
  });
  if(result.status!==0)throw new Error(`Pages build failed (${result.status})`);
  const output=path.join(project,"out-pages");
  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  await cp(path.join(stage,"out"),output,{recursive:true});
  await writeFile(path.join(output,".nojekyll"),"");
  console.log(`GitHub Pages build ready: ${output}, base path: ${basePath}`);
} finally {
  await rm(stage,{recursive:true,force:true});
}
