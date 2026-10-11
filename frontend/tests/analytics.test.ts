import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsConfig,publicAnalyticsUrl,googleBootstrap,yandexBootstrap} from '../src/lib/analytics.ts';
test('analytics only enables explicit production configuration',()=>{
 assert.equal(analyticsConfig({NODE_ENV:'development',ANALYTICS_ENABLED:'true'}),null);
 assert.equal(analyticsConfig({NODE_ENV:'production'}),null);
 assert.deepEqual(analyticsConfig({NODE_ENV:'production',ANALYTICS_ENABLED:'true',ANALYTICS_GA_ID:'G-XWF1ZMQBL1',ANALYTICS_GA_MANUAL_PAGEVIEWS_CONFIRMED:'true',ANALYTICS_YANDEX_ID:'113586674'}),{googleId:'G-XWF1ZMQBL1',yandexId:113586674,webvisor:true});
});
test('page URLs never contain queries, fragments or private routes',()=>{
 assert.equal(publicAnalyticsUrl('https://shardsmarket.com/catalog?search=secret#token'),'https://shardsmarket.com/catalog');
 for(const path of ['/account','/cart','/payments/return?session=secret','/api/session/me','/auth/steam/callback?token=secret'])assert.equal(publicAnalyticsUrl('https://shardsmarket.com'+path),null);
 assert.equal(publicAnalyticsUrl('http://127.0.0.1:5198/'),null);
 assert.equal(publicAnalyticsUrl('https://other.example/'),null);
});
test('bootstrap contains only sanitized initial URLs and uses one page-view mechanism per counter',()=>{
 const url='https://shardsmarket.com/catalog';
 const ga=googleBootstrap('G-XWF1ZMQBL1',url);assert.match(ga,/send_page_view:false/);assert.match(ga,/page_referrer:""/);
 const ym=yandexBootstrap(113586674,true,url);assert.match(ym,/defer:true/);assert.match(ym,/referrer:""/);
});
