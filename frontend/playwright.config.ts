import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:5198',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:[
  {command:'node e2e/fixtures/server.mjs',url:'http://127.0.0.1:5199/health/live',reuseExistingServer:false,timeout:30000},
  {command:'npm run start:local',env:{ANALYTICS_ENABLED:'true',ANALYTICS_GA_ID:'G-XWF1ZMQBL1',ANALYTICS_YANDEX_ID:'113586674',ANALYTICS_GA_MANUAL_PAGEVIEWS_CONFIRMED:'true'},url:'http://127.0.0.1:5198',reuseExistingServer:!process.env.CI,timeout:30000},
 ],
});
