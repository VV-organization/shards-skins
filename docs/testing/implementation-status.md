# Проверки реализации Shards

Работа ведётся в `main` по прямому указанию пользователя. Исходный frontend: `8d513af5575df4f6b45ebab4c75c2304d1427c88`; donor Frags: `d520298cc1b76392b1cb4da79f35bd9a0d9213c2`.

## Исходное состояние

- Frontend: 23 unit tests passed до изменений.
- `designer-source-baseline.json` фиксирует SHA-256 src/public/tests до изменений продукта.
- Скриншоты: `../research/2026-10-11-product-design/screenshots/` (desktop 1231×792, mobile 390×844). Дополнительные viewport fixtures будут сняты до соответствующих визуальных изменений.
- Backend перенесён по allowlist: src, drizzle, package/lock, TypeScript/Vitest/ESLint/Drizzle configs, Dockerfile, OpenAPI. Секреты, окружение, зависимости и deployment workflow Frags не копировались.
- Новая локальная PostgreSQL: compose project `shards-local`, ephemeral service `postgres-test`, port 55440, user/database `shards_test`. Никакая соседняя БД не используется.

Это журнал промежуточных результатов, не акт полной приёмки. Live provider acceptance и deployment не выполнялись.

## Каталог и исходный визуал

- В `visual-baseline/` сняты главная и каталог до удаления float, viewport 1440×900, 768×1024, 390×844, 320×780, reduced motion. Это исходные снимки для сравнения, не подтверждение завершённого visual QA.
- CSS проверен побайтно после исключения правил `.float-block`, `.float-track`, `.float-labels`: других стилевых изменений нет.
- Backend: 167 unit tests; PostgreSQL каталог/прайсинг/sync: 17 tests passed. Frontend: 32 tests, typecheck/lint/build passed.
- Динамические страницы получают API-цены; старый каталог используется только как источник витринных иллюстраций. Отсутствующие SKU не получают цену или разрешение на покупку из snapshot.

Task 5: authoritative versioned cart, one unit per SKU, 50-SKU cap, durable owner-scoped idempotency responses, snapshot retention and serialized mutations. PostgreSQL 6/6 cart/bundle-boundary checks; backend verify 167 unit checks; frontend 34 unit checks, lint/typecheck; Playwright guest→Steam callback fixture→cart→reload→remove→reload passed with real entrance animations. Browser provider responses are fixtures, not live Steam acceptance. Atomic duo and duo intent resume belong to Task 6.

Task 6: durable 60-second duo quotes, normalized 60-item cursor pages, integer pair budget, rate-limited public quotation and atomic quote consumption with cart mutation. PostgreSQL duo/cart 13/13 checks, including late-failure rollback, consumed/expired quote, price drift, missing member, capacity and cursor ties. Backend verify 170 units; frontend 34 tests, lint/typecheck/build passed. Desktop 1440px and mobile 390px Playwright checks passed for second-page loading, failed-page retry, keyboard selection/Escape, pair add, one-line removal and reload. Existing composition/CSS preserved; quote states and list footer reuse existing classes.

Task 7: `/checkout/quotes` and `/checkout/cart` now require an owned cart version and immutable quote; the unquoted `/checkout` route was removed. Fresh SIH reads run outside DB locks, pricing requires explicitly verified FX. Quote snapshots bind local catalog revisions, supplier cost caps and encrypted trade credentials. Cart→wallet transaction persists order/hold/commands/outboxes/quote consumption and cart cleanup together. Checkout/cart/wallet PostgreSQL 18/18 tests and backend verify 170 unit tests passed; frontend regenerated contract/typecheck passed. Stable operation IDs are persisted now; worker consumption of these snapshots is Task 9. The imported legacy CheckoutService remains unexposed for historical donor test fixtures; production routes use QuotedCheckoutService exclusively.

Task 8: owner-bound wallet and direct-Steam quotes, exact accepted fiat amount, 60-second TTL, atomic quote consumption/payment creation, owner-only status endpoint with separate payment/fulfillment states. Direct Steam requires verified account email and persists SIH precheck transaction; no wallet charge/credit. Arc Pay hosted checkout ID and payment ID are stored separately (0034). Signed callback and reconciliation bind provider identity, external ID, environment, purpose, amount and currency; callback-before-ack and unknown-create recovery retain one operation. Production hosted origins require `ARC_PAY_CHECKOUT_ALLOWED_ORIGINS`; empty list fails before HTTP. Return URLs carry the session ID for the Task 10 status page, never an authoritative success flag. Payment/provider PostgreSQL 29/29; backend verify 171 unit checks, frontend contract/typecheck passed. Provider HTTP fully intercepted in tests; no real payment made.

Task 9: worker and audited admin reconciliation now use FulfillmentOperationService with immutable operation IDs, encrypted recipient/cost-cap snapshots, durable dispatch boundary, 3-minute fenced leases, expiry recovery/audit, and separate per-cycle submit/reconcile/settlement budgets. Unknown skin creation performs lookup only; unknown Steam pay moves to review with the original transaction ID and no fresh check/pay. Direct-Steam failures record manual refund/outcome review, never wallet credit. Wallet→order→line serialization handles simultaneous terminal siblings, and an idempotent sweep repairs terminal holds without releasing unknown outcomes. Ten fault/settlement DB tests passed; combined checkout/wallet/payment/fulfillment 28/28 and backend verify 171 unit checks passed. Provider calls mocked. Old donor fulfillment implementation remains for internal legacy fixtures/enqueue only; worker/admin use the new engine.

Task 10 connects existing UI to authoritative wallet, checkout quotes, payment quotes/sessions and account histories. Skins offer only Shards; shortfall uses available funds; held funds remain visible. Direct Steam uses login plus verified email. Return pages ignore provider success query parameters, poll owner-bound status with a bounded budget and never create a charge. Unknown create commands survive reload with their original request/key; successful session IDs remain resumable until the customer explicitly starts a new top-up. Trade URL save returns to cart; entering cart refreshes funds/contents. Removed designer placeholder API routes. No CSS/composition/assets/animation changes.
