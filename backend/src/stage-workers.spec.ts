import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseNotificationsWorkerOptions} from './notifications-worker';
import {parseVvAdminDispatcherWorkerOptions} from './vv-admin-dispatcher-worker';
import {parseCatalogSyncWorkerOptions} from './catalog-sync-worker';

describe('stage worker lifecycle contract',()=>{
 const compose=readFileSync('../docker-compose.yaml','utf8');
 for(const [script,parse] of [
  ['notifications-worker',parseNotificationsWorkerOptions],
  ['vv-admin-dispatcher-worker',parseVvAdminDispatcherWorkerOptions],
  ['catalog-sync-worker',parseCatalogSyncWorkerOptions],
 ] as const)it(`${script} runs continuously with the actual Compose arguments`,()=>{
  const line=compose.split('\n').find(line=>line.includes(`dist/${script}.js`));
  if(!line)throw new Error('Missing Compose command');
  const args=Array.from(line.matchAll(/'([^']*)'/g),match=>match[1]??'').slice(2);
  expect(parse(args,{}).once).toBe(false);
 });
});
