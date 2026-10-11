# Приёмка Shards commerce — 2026-10-11

Реализация находится в `main`. Собственный backend, API-контракты, сценарии frontend и эксплуатационная конфигурация реализованы. Это локальная приёмка кода; production и реальные операции провайдеров не активированы.

## Матрица доказательств

| Область | Локальная проверка | PostgreSQL / mock HTTP | Provider read-only | Sandbox | Production |
|---|---|---|---|---|---|
| Steam / email / CSRF | UI-сценарии, смена владельца, OTP ошибки, обновление CSRF при том же владельце | purpose/owner/session binding, ротация cookie, рестарт | Не выполнялась | Не выполнялась | Не выполнялась |
| Каталог / цены | generated API, integer minor units, серверные цены | пустая мигрированная БД, stale/missing listings, FX/price revisions | Не выполнялась | SIH opt-in тест пропущен | Не выполнялась |
| Дуэт / корзина | пагинация, клавиатура, retry, desktop/mobile | атомарные две строки, бюджет, cart version, повтор ключа | Не применимо | Не применимо | Не выполнялась |
| Скины / wallet | только Shards, available/held, пополнение без auto-buy | quote → hold → supplier command → capture/release; partial settlement | Не выполнялась | Не выполнялась | Не выполнялась |
| Пополнение Shards | unknown/reload, повреждённый HTTP 200, повтор исходного запроса | подпись + authoritative provider GET, binding суммы/назначения/ID, однократный кредит | Не выполнялась | Не выполнялась | Не выполнялась |
| Прямой Steam | email OTP, сумма/логин сохраняются, paid отдельно от delivered | исходный transaction ID, pay один раз, wallet/holds не меняются | Не выполнялась | Не выполнялась | Не выполнялась |
| Recovery / events | состояние review, owner-protected история | crash/timeout, lease fencing, sibling race, orphan sweep, outbox recovery и causal ordering | VV/SMTP отправка не выполнялась | Не выполнялась | Не выполнялась |
| Дизайн | четыре ширины, исходные CSS/assets/animations | fixture API использует детерминированные DTO | Не применимо | Не применимо | Опубликованные assets не проверялись |

## Автоматические проверки

После чистого `npm ci` в обеих папках:

- `npm run verify`: backend lint/typecheck/build/OpenAPI, **172 unit tests**; frontend generated API, **38 unit tests**, lint/typecheck/production build, проверка исходного дизайна.
- `SHARDS_TEST_DATABASE_URL=…/shards_test npm --prefix backend run test:integration`: **105 passed**, один SIH sandbox test пропущен, поскольку live credentials/acceptance не включены. 23 файла passed.
- `npm --prefix frontend run test:e2e`: **17 passed**, включая четыре визуальных viewport и восстановление финансовых команд после потерянного/повреждённого ответа.
- `visual:source`: 79 исходных assets/fonts/animation sources совпадают, CSS совпадает за исключением разрешённого удаления float.
- `visual:compare`: hero upper 550 px совпадает на всех четырёх ширинах; изменения верхней части каталога ниже 2%. Полные страницы не pixel-identical: удалён float, добавлены серверные состояния и пагинация, часть baseline-изображений была lazy-unloaded. Подробнее [визуальная проверка](visual-regression.md). Старые PNG не заменялись.

Один промежуточный полный unit run вернул 401 вместо 204 при logout; изолированный и повторный полный прогоны не воспроизвели сбой. Регрессия усилена проверкой, что запрос без CSRF не вызывает revoke и сохраняет действующую сессию, а корректный logout вызывает revoke один раз. Итоговый полный прогон проходит.

Backend unit run намеренно пропускает DB integration tests; они выполняются отдельной командой против изолированной БД. Browser tests используют fixture server, а не реальные платежи. Полные цепочки на настоящем Postgres и mock провайдерах проверяет `backend/src/smoke/commerce-flow.integration.spec.ts` (3 сценария).

## Полные цепочки и сбои

1. Каталог → авторизованная Steam identity → cart → trade URL → quote пополнения → подписанный callback → кредит → отдельное подтверждение покупки → order/hold → SIH submit → lookup delivered → settlement. Рестарт приложения сохраняет quote/order/payment/command; повтор исходного ключа возвращает тот же заказ.
2. Произвольные нож + перчатки → budget quote → атомарная корзина → два supplier command → один delivered, другой failed → capture только доставленной строки, release остатка, partial order и корректная история выдачи.
3. Email challenge → неправильный OTP → правильный OTP → direct Steam quote → платёж → paid/pending → рестарт → pay по сохранённому reference → delivered. Никаких Shards начислений/списаний/резервов.
4. Повтор callback, неверные amount/currency/owner/purpose, потерянный ответ provider create, crash до/после dispatch, устаревший lease, параллельное завершение sibling lines, changed recipient/cart/price, expired quote, unavailable catalog и неизвестный Steam pay покрыты отдельными DB/provider suites.
5. Потерянный ответ checkout после очистки серверной корзины: reload показывает recovery, исходный key/body возвращает прежний заказ; следующая покупка получает новый ключ. Повреждённый 2xx или неполный финансовый DTO сохраняет журнал. Подтверждение email в Steam-аккаунте сбрасывает старый CSRF без потери журнала.

## Резервная копия и рестарт

Выполнен `pg_dump -Fc` тестовой БД после smoke-сценариев, затем `pg_restore` в отдельную disposable `shards_restore_test`. Исходные/восстановленные счётчики совпали: users 2, sessions 2, quotes 5, orders 3, order lines 4, payments 2, commands 4, holds 2, ledger rows 6; user wallet balance 62000 minor. `wallet:reconcile` восстановленной БД: `status=ok`, issues=[], invalidAmountRows/orphanHolds/terminalOrderActiveHolds/unbalancedTransactions = 0.

Это проверка восстановления локальных тестовых данных, не production backup. Собственные production encryption/cookie keys необходимо сохранять отдельно от DB backup; их восстановление в целевом окружении ещё не проверено. Совместимый откат кода сохраняет БД и reconciliation, не удаляет миграции или принятые операции.

## Review и зависимости

Независимое финальное ревью выявило три Important замечания: декодирование успешного финансового ответа, CSRF после email link и recovery пустой корзины. Все исправлены; повторное ревью не нашло новых Critical/Important проблем в исправлениях. Регрессии включены в unit/browser suite.

Обновлены Next/ESLint config до 16.3.8, Nodemailer до 10.1.0, транзитивные runtime-пакеты и уязвимые test-worker/brace-expansion/js-yaml. `npm audit --omit=dev`: 0 vulnerabilities в backend и frontend на дату проверки. В полном developer dependency tree остаются 6 moderate advisory backend и 5 high advisory frontend для инструментов (в том числе braces в Next ESLint и esbuild/Vitest chain); автоматический `--force` с откатом Next или сменой major toolchain не применён. Это не доказательство отсутствия всех уязвимостей. Перед публичным CI с недоверенными PR и production сборкой повторить аудит; dev-зависимости присутствуют в текущих Docker images для миграций/worker CLI.

## Не выполнено и не объявляется готовым

- Собственные production domains, credentials, SMTP delivery, Steam OpenID callback, SIH каталог/FX, ArcPay методы/origins/лимиты и текущие Steam fee/limits ещё не подтверждены.
- Нет live charge, реальной выдачи/возврата, отправки VV/Slack/SMTP, production deployment, live health или проверки опубликованной версии.
- CI workflow подготовлен; удалённый запуск workflow не выполнялся. Docker Compose config проверен, production images в целевом окружении не запускались.
- Исторические неэкспонированные donor checkout/fulfillment paths удалены; намеренно не поддерживаются unquoted checkout, guest email-payment upsert, Apple commerce, фиксированные bundle discounts или повторная inventory withdrawal.

Активация следует отдельному [provider acceptance checklist](../operations/provider-acceptance.md). Все финансовые флаги по умолчанию выключены; отсутствие реального acceptance не маскируется успешными mock-тестами.

## VV-162 local acceptance (2026-10-11)

Approved copy, section order, deferred-items labels, empty legal page shells and
cart summary redesign are implemented. Original designer stylesheet and 79
protected resources remain unchanged. The new summary is isolated in vv162.css.
Coverage and top-up use available funds, with held funds shown separately.
Pricing migration 0036 creates a new 20% setting and retains historical 25%
settings and the deployment's FX verification metadata.

- Backend verification: 172 unit tests, lint, types, build and OpenAPI passed.
- Disposable PostgreSQL: 107 passed; one real SIH sandbox test skipped without credentials.
- Frontend: 42 unit tests, lint, types, production build and API contract passed.
- Browser: 19 commerce/layout/analytics tests plus 4 cart state matrix tests passed.
- Cart matrix: zero, insufficient, exact and surplus balances at 320/390/768/1440px.
- Original visual comparison passed at all four widths; approved lower-page changes are intentional.
- Analytics loaders are stubbed in the local browser test. It verifies sanitized
  manual public page views and a fresh tracker-free private document, not receipt
  of real events by Google/Yandex dashboards. GA activation still requires the
  property configuration described in operations/deployment.md.

These checks do not establish real payment acceptance, Steam delivery or mailbox
delivery. Own provider credentials and a separate acceptance run remain required.
