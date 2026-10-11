# Shards Commerce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Implementation was subsequently authorized by the user; work is on main. External activation remains separately gated.

**Goal:** Превратить дизайнерский Shards в самостоятельный магазин CS2 и прямого пополнения Steam, сохранив визуал и добавив надёжный дуэт ножа и перчаток.

**Architecture:** Backend Frags переносится как самостоятельный NestJS modular monolith с собственной PostgreSQL и окружением. Деньги, котировки, заказы, provider operation IDs и durable outboxes принадлежат backend; Next.js сохраняет дизайнерские компоненты и получает типизированные серверные данные. Дуэт добавляет две обычные строки одной транзакцией.

**Tech Stack:** Node 24, Next.js/React/TypeScript из lockfile Shards, NestJS/Drizzle/PostgreSQL и provider clients из проверенного Frags, Redis, Vitest, Node test runner, Playwright для локальных browser regression tests.

**Spec:** [Архитектура коммерческого Shards](../specs/2026-10-11-shards-commerce-design.md). Статус: локальная реализация задач 1–12 завершена; внешняя активация из Task 12 не выполнялась. Результаты и границы проверки: [acceptance-results](../../testing/acceptance-results.md).

## Global Constraints

- Скины оплачиваются только внутренним балансом.
- Steam пополняется отдельным прямым платежом, внутренний баланс не участвует.
- Float удалить полностью из продукта.
- Остальную визуальную систему дизайнерского frontend сохранить.
- Курс: 1 ₽ = 1,6 Shards. Денежные значения — целые minor units, scale=2.
- Корзина серверная, после Steam-входа; максимум 50 различных SKU, quantity=1.
- Избранное локальное. Нет отдельного SKU дуэта, скидки, авто-подбора или гарантии совместной доставки.
- Сумма скинов и состояния операций определяются сервером, не localStorage или параметрами return URL.
- Node 24; версии frontend из существующего lockfile. Любое обновление зависимости требует отдельной причины.
- Новые окружения, cookies, ключи, volumes, origins и VV Admin site identity принадлежат Shards.

## Review Focus

1. Network timeout после фактической покупки SIH не вызывает вторую покупку; стабильный operation ID и recovery проверяет задача 9.
2. Logout/смена пользователя во время add/OTP/payment не переносит корзину или платёж другому владельцу; задачи 3, 5, 8 и 10.
3. Изменившийся SKU/recipient при прежней общей сумме не проходит checkout; задачи 6 и 7 фиксируют состав и версии.
4. Исчезнувший listing/перезапуск worker не оставляет hold бесконечно без наблюдаемого статуса; задачи 9 и 11.
5. Оплата прямого Steam не меняет Shards wallet, а paid не показывается как delivered до ответа выдачи; задачи 8 и 10.

## Основа решения

Самостоятельное исследование: [independent research](../../research/2026-10-11-independent-research.md).

Независимые исследования:
- [System Design](../../research/2026-10-11-system-design/research.md).
- [Product Design](../../research/2026-10-11-product-design/product-design-audit.md).

Security patch exception: final audit required Next 16.3.8, Nodemailer 10.1.0 and patched transitive dependencies; evidence in acceptance-results.

Source baseline: Shards `8d513af5575df4f6b45ebab4c75c2304d1427c88`, Frags `d520298cc1b76392b1cb4da79f35bd9a0d9213c2`. Повторно проверить source revisions перед началом реализации. Не переносить чужие изменения, внесённые после исследования, автоматически.

Согласование независимых выводов: все три исследования поддержали server cart, обычные строки дуэта и сохранение визуала. Из архитектурного разбора взяты stable provider IDs, leases и snapshots; из продуктового — unavailable cart rows, auth return, раздельные статусы и screenshot baseline. Для MVP осознанно не выбраны guest merge и новая схема с нуля: сохраняем проверенную историю миграций Frags и дополняем её Shards corrections в отдельной БД. Предложенные агентом названия routes служили альтернативой; окончательный контракт определён в спецификации и Tasks ниже. Содержательный System Design отчёт доступен в Markdown; шаблонный DOCX не создавался из-за недоступного обязательного document runtime.

## Порядок и структура

Задачи 1–3 задают основу. Каталог (4) и корзина (5) опираются на неё; дуэт (6) — на оба. Checkout (7), платежи (8) и выдача (9) соединяются в сценариях (10), после чего проверяются эксплуатация (11) и полный результат (12). Параллельно можно делать независимые read-only проверки; общие money/DTO/schema интерфейсы сначала фиксируются одним исполнителем.

| Путь | Ответственность |
| --- | --- |
| `backend/src/common/money/shards.ts` | Только целочисленные денежные преобразования |
| `backend/src/modules/storefront/` | Публичный config и витринные подборки |
| `backend/src/modules/catalog/` | Каталог, normalized metadata, prices, lookup и freshness |
| `backend/src/modules/cart/` | Версия и атомарные изменения корзины |
| `backend/src/modules/duo/` | Допустимые ножи/перчатки и состав пары |
| `backend/src/modules/quotes/` | Persisted immutable quotes и TTL |
| `backend/src/modules/checkout/` | Snapshot → order/hold/commands transaction |
| `backend/src/modules/payments/` | Отдельные balance/Steam payment sessions |
| `backend/src/modules/fulfillment/` | Stable operations, leases, reconciliation и settlement |
| `frontend/src/lib/api.ts`, `frontend/src/generated/api-types.ts` | Typed API и problem details |
| `frontend/src/lib/catalog.ts`, `presentation.ts`, `pending-intent.ts` | Mapping, стабильные витринные слоты, intent после входа |
| `frontend/src/components/*` | Существующий visual UI и действия на API |
| `docs/testing/`, `docs/operations/` | Сравнение визуала, acceptance и recovery |

Историю миграций Frags сохранить неизменной для переносимости; Shards corrections добавлять следующими миграциями. Унаследованные Apple/other-game/bundle таблицы не требуют отдельной массовой очистки, но API/modules/capabilities этих сценариев не регистрировать. Не копировать `.git`, `.env`, secrets, node_modules, dist, production data, чужой deployment workflow или analytics IDs.

## Task 1: Самостоятельный репозиторий и безопасно запускаемый backend

**Files:** create root `AGENTS.md`, `.gitignore`, `package.json`, `backend/` из source allowlist, `.github/workflows/ci.yml`, `compose.local.yml`; adapt `backend/package.json`, `backend/src/config/app-config.ts`, `backend/src/common/database/database.config.ts`, `backend/src/integration-test-setup.ts`, `backend/vitest.integration.config.ts`; retain `frontend/AGENTS.md` with current scope clarification.

**Interfaces:** produces backend on local port 5199, frontend port 5198, own `SHARDS_TEST_DATABASE_URL`; live money-moving features disabled by default. Local test DB name/user `shards_test` with explicit loopback/container allowlist.

- [x] Снять file/hash baseline designer source и desktop/mobile screenshots из Product Design evidence. Проверить текущий worktree. Нормализовать уже выполненный перенос Git без удаления `frontend` и без попадания node_modules/.next в индекс.
- [x] Перенести только выбранные исходники, lockfile и migrations. Сохранить библиотеки и историю, отключить bundle registration, Apple/other-game public modules и неисполняемый inventory withdrawal API.
- [x] Добавить config tests: production без DB/секретов не использует in-memory fallback; unsafe test DB URL отвергается до DROP; wallet/payment/fulfillment activation flags false по умолчанию; чужие cookie/domain/site defaults отсутствуют.
- [x] Выполнить failing tests, реализовать новые Shards defaults/guards, затем запустить `npm --prefix backend run typecheck` и `npm --prefix backend test -- src/config/app-config.spec.ts src/common/database/database.config.spec.ts`.
- [x] В одноразовой `shards_test` прогнать все migrations с нуля. Backend live/ready должен отражать собственные DB/Redis, без запуска провайдерских действий.
- [x] Проверить diff и сформировать отдельный commit `chore: establish isolated shards backend` только после разрешённого начала реализации.

## Task 2: Единый курс и серверные денежные настройки

**Files:** create `backend/src/common/money/shards.ts`, `shards.spec.ts`, `backend/src/modules/storefront/{storefront.module,storefront.controller,storefront.service}.ts`; modify catalog/payments/wallet DTO/controller schemas, `catalog-pricing.service.ts`, `catalog.service.ts`, `drizzle/schema.ts`; add next migration `shards_pricing` through Drizzle including journal entry. Modify `frontend/src/lib/money.ts`, `frontend/src/config/project.ts`, `frontend/tests/money.test.ts`.

**Interfaces:** `rubToShardsMinor(rubMinor:number):number`; `shardsToRubReferenceMinor(shardsMinor:number):number`; `topUpFiatMinor(shardsMinor:number):number` accepts only 10000..10000000 divisible by100; `GET /storefront/config` per spec. Keep `CoinPriceDto.amountMinor` internal, map label Shards.

- [x] Написать тесты: `rubToShardsMinor(100000)===160000`; `shardsToRubReferenceMinor(2362080)===1476300`; `topUpFiatMinor(100000)===62500`; `topUpFiatMinor(10100)===6313`; reject 10001, negative/NaN/overflow; sum `[101,102]` gives RUB127 after one conversion.
- [x] Проверить FAIL, реализовать BigInt half-up и authoritative server config. Настройка SIH 8/5, наценка2500bps, шаг1 minor; initial FX не активирует продажу без отдельной рабочей настройки.
- [x] Привести SQL effective-price sorting, service quote, cart/checkout, payment snapshots и OpenAPI к одной формуле. Убрать вечный кэш active setting; версия обновляется согласованно.
- [x] Добавить DB test смены pricing version: detail/list/sort/quote дают одинаковые суммы, старый платёж сохраняет свой курс. Run `npm --prefix backend test -- src/common/money/shards.spec.ts`, затем targeted catalog pricing integration в disposable DB и frontend money tests.
- [x] Commit `feat: unify shards pricing and money contracts`.

## Task 3: Реальная идентичность и безопасные возвраты

**Files:** modify `backend/src/modules/{auth,email-auth,sessions,users}/`, cookies/namespaces; create `frontend/src/lib/api.ts`, `pending-intent.ts`, `frontend/tests/{api,pending-intent}.test.ts`; adapt `frontend/src/components/shop-provider.tsx`, existing modal; copy/adapt `frontend/scripts/sync-api.mjs` and add `api:sync`/`api:check` scripts.

**Interfaces:** session `/session/me`, `/session/csrf`, logout; Steam auth returnTo `/cart`; email challenge `{email,purpose:'sign_in'|'link_email'}`. `link_email` binds challenge to current user/session, never switches owner. `PendingIntent` includes displayed price revisions and 15-minute TTL from spec. API error preserves structured `code`, relevant numeric fields, retry status. Same-origin production session cookie Secure/HttpOnly/SameSite=Lax; CSRF remains mandatory, callback browser binding tested.

- [x] Написать tests: preview-login never grants access; foreign trade partner rejected; invalid callback state/nonce rejected; OTP expiry/reuse/rate limit; link email belonging to another user returns conflict without session switch; logout clears old intent/command keys; delayed old response cannot overwrite current user.
- [x] Run targeted tests for FAIL. Replace local login/tradeURL with server identity. Cookie names/HMAC namespaces Shards; credentials encrypted server-side, never localStorage.
- [x] Implement OTP purpose binding and eliminate public-input→verified-email path. Internal wallet topup requires Steam identity. Explicitly reject silent account/wallet merging.
- [x] Add authenticated API adapter with cancellation/session-generation guard, CSRF, structured errors and command keys bound to user+purpose+intent. Keep financial API production relative `/api` with same-origin proxy; local backend5199 allowed via config.
- [x] Run backend auth/email/session/users tests plus frontend pending-intent/API tests; regenerate OpenAPI/types and check diff. Commit `feat: connect shards identity and session boundaries`.

## Task 4: Live каталог с сохранением витрины и удалением float

**Files:** modify backend catalog service/types/controller/projection/sync, storefront service; frontend `src/lib/{types,catalog,filters,presentation}.ts`, `src/app/{layout,page}.tsx`, `src/app/catalog/[id]/page.tsx`, `components/{home,catalog-view,products,skin-compare,cart-view}.tsx`, `src/data/catalog.json`, relevant tests, only orphan float rules in `globals.css`.

**Interfaces:** API catalog filters `categoryId/condition/stattrak/weapon/min/max/sort/limit/offset`, `POST /catalog/lookup {slugs}` max50, stable slug/availability/priceRevision; frontend Product loses float, gains availability/priceRevision; presentation maps designer slots to market names. Preserve wear codes. Read-only lookup endpoint has no financial side effect.

- [x] Tests before changes: knife/gloves category normalization handles ★, StatTrak and Hand Wraps via metadata/explicit aliases; FN and FT distinguishable; empty/bad sync does not erase last good snapshot; stale availability is non-purchasable; list/detail and paging agree; unavailable old slug still renderable in cart.
- [x] Remove all float field, display, track, option and fixture dependencies. Legacy `sort=float` normalizes to default, without API error. Delete stale CSS only when no caller remains; preserve surrounding grid and typography.
- [x] Replace global snapshot hydration/static product generation with server catalog reads and explicit loading/error states. Route parameters/filter URLs work over all pages; local saved IDs resolved via batch lookup and remain removable if unavailable.
- [x] Preserve hero assets, featured row counts and imagery positioning. Fallback stays inside same slot; never offer snapshot-only item for live purchase. Add tests for missing curated SKU and unavailable thumbnail.
- [x] Run catalog unit/DB tests, frontend catalog/filter/contract tests, `api:check`, typecheck/lint/build. Use `rg` scoped to active Product/UI to verify no float feature; SQL float types unrelated to skin attribute need no deletion.
- [x] Commit `feat: connect live catalog and remove skin float`.

## Task 5: Версионированная серверная корзина

**Files:** modify `backend/src/modules/cart/{cart.service,cart.controller}.ts`, `drizzle/schema.ts`; add migration `shards_cart_version` including `cart_items.product_snapshot`, `cart.integration.spec.ts`; frontend provider/cart view/pending-intent tests.

**Interfaces:** `getCart(userId):Promise<CartDto>` with `version`, unavailable lines and `canCheckout`; `setItem({userId,productSlug,quantity:1,expectedCartVersion})`; `removeItem({userId,productSlug,expectedCartVersion})`. Uniqueness cart_id+slug; max50 distinct items. Idempotency replay checked before current version for repeated successful command.

- [x] DB tests: add same SKU twice yields one row; two concurrent mutations at same version give one accepted mutation and one409; repeated completed key returns original result; unavailable product remains visible/removable;50→51 rejected; changed SKU with equal price is still changed composition.
- [x] Implement per-cart lock and version increment only when content changes. Use no guest merge/prototype ID migration. Match all mutations to current authenticated owner.
- [x] Wire existing buttons and notices. Guest click saves15-minute intent including displayed revisions, opens Steam modal, returns to `/cart` and resumes after authoritative session and fresh quote. Changed/missing revisions require confirmation; anonymous→expected callback preserves intent, existing-owner switch clears it. Lost/expired intent produces no silent add; unauthenticated API never creates a cart for another user.
- [x] Run cart DB tests and frontend tests for redirect/reload/logout/race handling. Browser check product→login→same product in cart→delete→reload. Commit `feat: add authoritative shards cart`.

## Task 6: Серверный дуэт и атомарное добавление пары

**Files:** create `backend/src/modules/duo/{duo.module,duo.controller,duo.service,duo.types}.ts`, `duo.spec.ts`, `duo.integration.spec.ts`; create quotes module/store with migration `shards_commerce_quotes`; modify cart service/controller and frontend `duo-builder.tsx`, `shards-select.tsx`, `lib/duo.ts`, tests.

**Interfaces:** `listOptions({slot,cursor,limit})`; `quotePair({knifeSlug,gloveSlug,budgetRubMinor}):Promise<DuoQuoteDto>`; `addPair({userId,quoteId,expectedCartVersion,idempotencyKey}):Promise<CartDto>`. Public quote rate-limited; mutation session+CSRF. Quotes immutable, TTL60seconds.

- [x] Tests: one knife+one gloves only; two knives/repeated slug/forged prices rejected; example2362080 Shards minor gives1476300 RUB minor and1023700 remaining at2500000 budget; budget below result blocks; wrong category/unavailable second member leaves cart unchanged.
- [x] DB tests: existing knife plus pair produces only missing gloves; repeat callback/double click has no duplicates; rollback after first insert leaves no partial pair; TTL expiry/price change returns requote, no automatic substitution;50-SKU limit checked for missing members.
- [x] Implement normalized options with pagination, exact wear/StatTrak labels, immutable quote and one cart transaction. Do not register `/bundles` or discount semantics.
- [x] Wire current duo stage/receipt/select without layout/style redesign. Add optional `onLoadMore`, `hasMore`, `loadingMore`, `loadMoreError`, `onRetryLoadMore` to ShardsSelect;60-options pages reachable by scroll/keyboard, status/retry footer outside listbox, selection kept independently of pages. Test loading second page, network retry, option outside page and focus preservation. Out-of-order quote responses cannot show prices for previous selection. Loading blocks add; selected unavailable item remains identifiable with an actionable error.
- [x] Run duo unit/integration/frontend tests, then browser pair→notice→cart2lines→remove1→reload, keyboard dropdown/Escape and390px. Commit `feat: add authoritative knife and gloves duo`.

## Task 7: Checkout с привязкой к котировке и получателю

**Files:** modify quotes module, checkout service/controller, wallet holds, order schema, cart cleanup; create `checkout-quote.integration.spec.ts`, `recipient-snapshot.spec.ts`; migration `shards_order_snapshots`.

**Interfaces:** `createCheckoutQuote({userId,cartVersion}):Promise<CheckoutQuoteDto>`; `checkoutFromServerCart({userId,quoteId,cartVersion,idempotencyKey}):Promise<OrderDto>`. Quote binds SKU, unit prices, total, user, cartVersion, pricingVersion, immutable recipient credential revision and supplier cost cap.

- [x] Write DB tests: insufficient balance/wrong trade URL/expired quote/cart version or recipient changes create no order/hold; equal total with different composition rejected; concurrent checkout never overdrafts; successful retry returns same order/hold after quote expiry; different payload+same key409; same consumed quote with new key cannot create another order.
- [x] Implement supplier read-only preflight outside transaction. Persist immutable quote; revalidate all local versions under cart→wallet locks. No unbounded external HTTP while holding DB locks.
- [x] Atomically persist order+lines+hold+encrypted recipient snapshot+stable fulfillment commands+outbox, then remove only purchased cart entries. Fail any insert→full rollback. Match capture/release exactly to stored line amounts.
- [x] Verify direct checkout has no `method=card|sbp` bypass and Steam refill cannot enter skin cart/order charge. Run checkout/wallet/cart integration including combined faults.
- [x] Commit `feat: bind checkout to prices cart and recipient snapshots`.

## Task 8: Два разных платёжных сценария

**Files:** modify `payments/{payments.service,payments.controller,payments-webhook.controller}.ts`, Arc Pay client, histories, config and reconciliation script; add `payments-binding.integration.spec.ts`, `steam-refill-auth.integration.spec.ts`; extend OpenAPI/types.

**Interfaces:** `POST /payments/top-up/quotes {coinAmountMinor}` requires Steam session+CSRF; `POST /payments/steam-refill/quotes {amountRub,steamLogin}` requires session+verified email+CSRF, recipient email derived server-side. Both return `PaymentQuoteDto {quoteId,purpose,fiatAmountMinor,currency:'RUB',termsVersion,expiresAt,...creditTerms}`. Respective `/sessions` routes take `{quoteId,acceptedFiatMinor}` with Idempotency-Key; no fresh recipient/amount override. Add ownership-protected `GET /payments/sessions/{id}` with purpose, paymentStatus and fulfillmentStatus kept separate.

- [x] Tests:1000Shards→625RUB; changed fee/rate/recipient or expired quote creates no payment until reconfirmed; same consumed quote/new key cannot create duplicate session; same payment callback twice credits once; mismatched provider/external ID/environment/purpose/amount/currency gives no credit; redirect query success gives no credit; unknown create does not start second checkout; callback-before-create-response safely binds one provider ID.
- [x] Steam tests:50/9433 whole RUB bounds,5% fee, invalid/decimal reject; contact email input alone cannot verify identity; wrong user cannot read payment; paid creates exactly one Steam order; wallet ledger/holds unchanged for all Steam statuses.
- [x] Implement email OTP→authenticated direct Steam quote→explicit payable confirmation→session. Persist provider check transaction reference before pay; pre-payment login validation rejects known-invalid recipient before charging, revalidation/unknown outcomes handled without silently changing recipient. Confirmed form already shows server payable; no unnecessary extra confirmation dialog when terms are unchanged.
- [x] Keep supported SBP method server-owned. Store checked hosted URL, allow only configured provider HTTPS origins in production. Server status is the only return-page authority; polling has bounded backoff and resumes on focus.
- [x] Run payments/provider unit+DB tests with intercepted provider responses, never real charge. Commit `feat: separate wallet funding from direct steam payments`.

## Task 9: Выдача без повторных покупок и потерянных резервов

**Files:** modify fulfillment service/provider client/contract/worker; create `fulfillment-operation.service.ts`, `fulfillment-recovery.service.ts`, `fulfillment-recovery.integration.spec.ts`, `fulfillment-lease.integration.spec.ts`; migrations `shards_fulfillment_operations`; update worker tests/admin audited recovery.

**Interfaces:** immutable operation `{commandId,providerOperationId,requestSnapshotHash,recipientSnapshot,costCap}`; attempts reference operation; `claim({workerId,now})` returns leaseToken; `complete({commandId,leaseToken,result})`; `recoverExpired({limit,now})`. Separate submit/reconcile/recovery per-cycle budgets.

- [x] Fault tests: provider accepts create then connection times out→lookup old customId, no second new-ID create; crash before/after dispatch persistence; stale worker response loses fencing; two workers cannot terminal-settle same line twice; disappeared listing becomes explicit result, not invisible pending.
- [x] Persist operation ID and exact request before HTTP. Unknown result keeps hold and moves to reconciliation/manual_review; never generate a new operation ID because an attempt failed. Resend same ID only if provider contract guarantees safety; otherwise operator evidence required.
- [x] Use encrypted recipient/cost cap snapshot, not current user/listing. Supplier preflight rejects higher cost or no stock before first submit; do not charge additional balance automatically. Build fair cycles and bounded backoff; age alerts route unresolved cases to review.
- [x] Steam unknown pay uses original transaction reference; no new check/pay chain without outcome evidence. Known definitive failure records refundable/manual-refund state for direct RUB payment, not a Shards credit. Do not claim automatic RUB refund until provider refund contract implemented.
- [x] Serialize terminal line update and aggregate settlement in one transaction with wallet→order→line/hold locks, after separate claim transaction. Add DB race test: two final sibling lines complete concurrently→terminal order, exact capture/release, no active orphan hold. Add idempotent terminal-order settlement sweep using the same locks/invariants, never releasing unknown outcomes.
- [x] Settlement tests: both delivered→full capture; one delivered+one failed→partial capture/rest release after all terminal; both failed→release all; protection pending→hold; protection failed/unknown→manual review. Replay terminal events does not change settled ledger.
- [x] Run fault/DB/worker suites; no tests invoke real providers. Commit `fix: make fulfillment retries and settlement recoverable`.

## Task 10: Полные пользовательские сценарии в прежнем дизайне

**Files:** modify `frontend/src/components/{shop-provider,topups,cart-view,account-view,products,duo-builder}.tsx`, existing shell/modal; create small `payment-status.tsx` and `email-verification.tsx` using existing styles; histories via API; frontend scenario/contract tests.

**Interfaces:** consumes generated APIs tasks2–9; no independent money, auth or fulfillment truth. API-driven statuses `loading|ready|error`, payment pending/paid/failed/review distinct from fulfillment pending/sent/protection/delivered/partial/failed.

- [x] Tests: skin cart offers only Shards; available balance (not posted total) determines insufficiency, separately show held funds. Prefill whole-Shards topup `max(100,ceil(shortfallMinor/100))`;100000 limit exceeded is explained, never silently clamped. After callback refresh balance and checkout quote but require explicit buy; reload/back retains payment command; no delayed response contaminates another account.
- [x] Replace SteamID64 with login; place email/OTP in existing visual language. Keep input/login/amount on OTP error, expiry or edit. Existing Steam user with email need not verify again; user without email links in current session. Conflict leaves current account untouched. Add «Войти по почте» in existing login modal for repeat Steam history access; payment return401 restores auth and reads original paymentId, with no new session creation. Wrong owner gets access denied.
- [x] Implement cart→account trade panel→save→«Продолжить покупку»→cart with preserved nonfinancial checkout intent and new quote. Test validation errors retain form/context and do not lose cart.
- [x] Remove card/SBP skin-payment claims from product/quick/cart; topup methods reflect config. Fill existing account balance/orders/transactions panels with real states, including partial duo delivery and direct Steam failure after payment. Retry of HTTP status read is not retry of charge.
- [x] Use existing loading space/form messages/notices; no fake zero balance/empty history during loading. Keep focus, aria-live, modal Escape and reduced-motion. Error adding pair shows no success notice.
- [x] Run unit/typecheck/lint/build plus desktop/mobile scenario browser checks. Commit `feat: connect shards purchase and account journeys`.

## Task 11: Эксплуатация, согласованные события и CI

**Files:** create `compose.yml`, independent deployment configuration staged inactive, `docs/operations/{deployment,recovery,provider-acceptance}.md`, `docs/testing/visual-regression.md`; modify worker/schedulers/health/integration outbox; `.github/workflows/ci.yml`, root verify scripts, `frontend/playwright.config.ts`, browser fixtures.

**Interfaces:** health readiness includes API dependencies and exposes worker/sync age through protected monitoring; schedules payment reconciliation, wallet reconciliation, catalog sync, fulfillment, notification and VV Admin dispatch. Durable events have Shards identity and distinguish held/paid/delivered/partial/refund-review.

- [x] Add tests for terminal event dedup/order, stalled lease/unknown age reporting, failed catalog sync keeping last good snapshot, dispatcher crash after claim and remote acceptance without duplicate logical event. Implement lease/fencing recovery for VV/notification outboxes, not just normal retry. Replace inherited `order.created payment.paid` interpretation where only hold exists.
- [x] Configure own network/volumes/cookies/origins/secret file paths, SMTP sender and VV Admin identity. Integration DB destructive guard only allows shards_test. Do not copy auto-deploy trigger to somebody else's runner.
- [x] CI: backend lint/typecheck/unit/build/OpenAPI check; isolated DB integration; frontend api check/unit/lint/typecheck/build; fixture E2E/visual regression. Readiness script reports presence/absence without secret values.
- [x] Visual fixtures cover1440×900,768×1024,390×844,320×780 with deterministic data/fonts. Compare current source baseline and approved float/payment/Steam field differences; no blanket image rebaseline to hide changes. Animations checked separately in time; reduced-motion screenshots deterministic.
- [x] Recovery runbook has safe unknown-order lookup, auditable manual resolution, disabling new payments/submits without stopping reconciliation, and backup/restore rehearsal. Define alerts for orphan holds, aged unknown operations and broken outbox.
- [x] Commit `chore: add shards operations and full verification pipeline`.

## Task 12: Полная приёмка и отдельная активация

**Files:** `docs/testing/acceptance-results.md`, final source docs/readme, environment-specific release checklist without secret values.

**Interfaces:** produces evidence matrix with separate local, DB/mock, provider read-only, sandbox, production columns; unverified is not pass.

- [x] Run `npm run verify`, disposable DB integration and fixture E2E/visual suite from clean install. Confirm migrated empty DB and restart preserve identities/cart/quotes/orders/payments/holds. Review new source diff and compare designer baseline.
- [x] Pass full journey: product→Steam login→cart→tradeURL→wallet topup→verified credit→explicit buy→SIH terminal delivery; duo→pair budget→atomic cart→partial failure; direct Steam→email OTP→payment→pending→delivery with zero wallet impact.
- [x] Exercise failures: lost callback, delayed callback, duplicate click, provider timeout after acceptance, worker crash, wrong amount/currency/owner, catalog stale/disappeared item, changed recipient, concurrent cart edits and retry after restart. All must yield bounded observable states and no duplicate money movement.
- [ ] Validate own credentials/read-only catalog/provider methods and current limits/FX in the target environment. Only after separately authorised controlled payment/fulfillment acceptance enable corresponding feature flags. This planning task grants no production mutation or live charge.
- [x] Review rollback: keep already accepted operations reconciling; migrations/data not reverted by destructive reset. Record actual deployment workflow, health, published assets and provider outcomes separately.
- [x] Final implementation commit(s)/PR and deployment require the task's actual execution authorisation; do not commit or publish this plan merely because it exists.

## Что считается готовым

Все обязательные задачи имеют проверки и evidence; внешний вид совпадает с baseline за перечисленными разрешёнными изменениями. Нет float, client-controlled денег, фальшивой авторизации и неподтверждённых успешных операций. Дуэт переживает повторные клики, истечение quote, смену цены и частичную выдачу. Прямое пополнение Steam никогда не затрагивает Shards wallet. Неопределённый исход провайдера не превращается в новую покупку.

## Решения и зависимости перед запуском

Выбраны серверная корзина после Steam-входа, whole-Shards пополнение100–100000, прямой Steam50–9433RUB+5%, подтверждение email через существующий modal,25% стартовая наценка как конфиг. Пользователь может скорректировать эти выбранные детали при чтении плана. Для реализации не нужны новые дизайны. Для реальной активации нужны собственные secrets/domains/SMTP/provider acceptance и рабочий FX; их отсутствие не мешает закончить код и тестовый контур, но не даёт права объявить рабочие платежи/выдачу.
