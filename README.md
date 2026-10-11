# Shards Market

Независимый магазин CS2: существующий дизайнерский frontend и собственный NestJS/PostgreSQL backend. Скины покупаются только за внутренние Shards; прямое пополнение Steam оплачивается отдельно в RUB. Дуэт — выбранные пользователем нож и перчатки, без фиксированного набора или скидки. Float удалён.

## Локальный запуск

Node.js 24, npm, Docker Compose. Из корня:

```sh
npm --prefix backend ci
npm --prefix frontend ci
docker compose -f compose.local.yml up -d --wait postgres redis
cp backend/.env.example backend/.env
npm --prefix backend run db:migrate
npm run dev:api
```

В другом терминале `npm run dev`. Интерфейс: http://127.0.0.1:5198, API: http://127.0.0.1:5199. Next проксирует `/api` к backend; `SHARDS_BACKEND_ORIGIN` меняет внутренний адрес API. Для собственного окружения задать отдельные cookie/encryption secrets и параметры интеграций, описанные в `.env.example`. Секреты в Git не хранить.

По умолчанию покупки, платежи и выдача выключены. Локальная база не содержит живого каталога и финансовых данных. Для настоящей авторизации, OTP, синхронизации каталога и провайдеров нужны собственные настройки. Browser fixtures — отдельный тестовый сервер, не режим коммерческого API.

## Проверки

```sh
npm run verify
docker compose -f compose.local.yml up -d --wait postgres-test
SHARDS_TEST_DATABASE_URL=postgres://shards_test:shards_test_local_only@127.0.0.1:55440/shards_test npm --prefix backend run test:integration
npx --prefix frontend playwright install chromium
npm --prefix frontend run test:e2e
npm --prefix frontend run visual:compare
```

Integration suite пересоздаёт только отдельную базу `shards_test`. Не подставлять рабочую БД. Browser suite запускает локальные fixture API и production frontend; порты 5198/5199 должны быть свободны.

## Документы

- [Архитектура и продуктовые решения](docs/superpowers/specs/2026-10-11-shards-commerce-design.md)
- [План реализации](docs/superpowers/plans/2026-10-11-shards-commerce.md)
- [Результаты приёмки](docs/testing/acceptance-results.md)
- [Визуальная проверка](docs/testing/visual-regression.md)
- [Запуск](docs/operations/deployment.md), [восстановление](docs/operations/recovery.md), [активация провайдеров](docs/operations/provider-acceptance.md)

Реальные платежи, доставка SMTP, Steam OpenID callback и выдача SIH требуют отдельной проверки в целевом окружении. Локальные тесты их не подтверждают. Production не развёрнут.
