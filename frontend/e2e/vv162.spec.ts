import {test,expect} from '@playwright/test';
test('VV-162 section order, copy, deferred skins and legal shells',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 expect(await page.locator('#featured').evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('#topups')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await expect(page.locator('#steam')).not.toContainText('Комиссия 5% включена в итог');
 await expect(page.locator('#balance')).toContainText('Способ оплаты: СБП');await expect(page.locator('#balance input[type=radio]')).toHaveCount(0);
 await expect(page.locator('#faq details')).toHaveCount(7);await expect(page.locator('#faq')).toContainText('support@shardsmarket.com');
 await expect(page.locator('footer')).not.toContainText('Личный отбор');await expect(page.locator('.footer-baseline')).toContainText('Скины CS2');await expect(page.locator('.footer-baseline')).not.toContainText('Steam');
 await expect(page.locator('header a[aria-label="Отложенные"]')).toHaveAttribute('href','/catalog?saved=1');
 for(const [url,title] of [['/privacy','Политика конфиденциальности'],['/terms','Пользовательское соглашение']]){await page.goto(url);await expect(page.getByRole('heading',{name:title})).toBeVisible();await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex, follow');expect(await page.locator('main p').count()).toBeGreaterThan(30);await expect(page.locator('main')).toContainText('Smartvesta');}
});
test('analytics initializes automatic GA once without manual duplicates and isolates private documents',async({page})=>{
 // The target origin is simulated locally; never contact the real site/counters.
 await page.route('https://shardsmarket.com/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:'http://127.0.0.1:5198'+url.pathname+url.search});await route.fulfill({response});});
 let googleLoads=0,ymLoads=0;
 await page.route('https://www.googletagmanager.com/**',route=>{googleLoads++;return route.fulfill({contentType:'application/javascript',body:'/* intercepted GA loader */'});});
 await page.route('https://mc.yandex.ru/**',route=>{ymLoads++;return route.fulfill({contentType:'application/javascript',body:'/* intercepted Metrika loader */'});});
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('https://shardsmarket.com/?session=DO_NOT_SEND');
 const pageViews=()=>page.evaluate(()=>((window as unknown as {dataLayer?:IArguments[]}).dataLayer??[]).map(args=>Array.from(args)).filter(args=>args[0]==='event'&&args[1]==='page_view'));
 const configurations=()=>page.evaluate(()=>((window as unknown as {dataLayer?:IArguments[]}).dataLayer??[]).map(args=>Array.from(args)).filter(args=>args[0]==='config'));
 await expect.poll(configurations).toEqual([['config','G-XWF1ZMQBL1']]);expect(await pageViews()).toEqual([]);
 await expect(page.locator('#steam form')).toHaveClass(/ym-hide-content/);
 await page.locator('.hero-actions a[href="/catalog"]').click();await expect(page).toHaveURL('https://shardsmarket.com/catalog');expect(await pageViews()).toEqual([]);await expect.poll(configurations).toEqual([['config','G-XWF1ZMQBL1']]);
 expect(googleLoads).toBe(1);expect(ymLoads).toBe(1);
 await page.locator('header a[href="/cart"]').click();await expect(page).toHaveURL('https://shardsmarket.com/cart');await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as {dataLayer?:unknown}).dataLayer)).toBe('undefined');
 expect(googleLoads).toBe(1);expect(ymLoads).toBe(1);
 // A document originating on a private page must not gain trackers that survive Back.
 await page.locator('header a[href="/catalog"]').click();
 await expect(page).toHaveURL('https://shardsmarket.com/catalog');
 await expect.poll(configurations).toEqual([['config','G-XWF1ZMQBL1']]);expect(await pageViews()).toEqual([]);
 await page.goBack();await expect(page).toHaveURL('https://shardsmarket.com/cart');
 await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as {dataLayer?:unknown}).dataLayer)).toBe('undefined');
});
