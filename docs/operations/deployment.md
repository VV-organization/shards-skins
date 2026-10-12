# Stage deploy Shards Market — стандарт Finext

Единственный stage deploy: `docker-compose.yaml` + `.github/workflows/deploy.yaml`, по multi-service шаблону `../deploy-templates`. Next.js работает как Node SSR, не как static SPA. `compose.local.yml` предназначен только для локальной разработки/тестов.

## Контракт сервера

- Ветка: `main`; self-hosted runner label: `shardsmarket-stage`.
- Серверный env: `~/.envs/shardsmarket/.env` (0600), образец: корневой `.env.example`.
- Compose project: `shardsmarket`; default network, без external networks/container_name/named volumes.
- Данные: `/opt/shardsmarket/volumes/postgres` и `/opt/shardsmarket/volumes/redis`. Подготовить права для пользователей соответствующих контейнеров. Не переименовывать эти пути после появления рабочих данных.
- Frontend: `127.0.0.1:3000` → container `5198`; API: `127.0.0.1:3001` → container `5199`. Оба процесса слушают `0.0.0.0` внутри Docker. DB/Redis наружу не опубликованы.
- Внешние TLS/DNS/reverse proxy настраиваются отдельно. Публичный домен направляется на frontend:3000; Next проксирует `/api/*` к `api:5199`. `PUBLIC_BASE_URL` оканчивается `/api`, `PUBLIC_FRONTEND_ORIGIN` и `CORS_ORIGINS` — origin без пути.

## Runtime env и секреты

Обязательные переменные: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `COOKIE_HMAC_SECRET`, `DATA_ENCRYPTION_SECRET`, `PUBLIC_BASE_URL`, `PUBLIC_FRONTEND_ORIGIN`, `CORS_ORIGINS`. Cookie/encryption secrets — собственные случайные значения не короче 32 символов. Пароль в `DATABASE_URL` должен быть URL-encoded; host — `postgres`, DB/user/password должны совпадать с POSTGRES_*.

Финансовые флаги `SHARDS_CHECKOUT_ENABLED`, `SHARDS_PAYMENTS_ENABLED`, `SHARDS_FULFILLMENT_ENABLED` по умолчанию false; `ARC_PAY_PROVIDER_MODE=disabled`. Остальные необязательные настройки перечислены в `.env.example`. Сохранять encryption key при рестартах и восстановлении базы.

Секреты провайдеров задаются runtime-переменными без `_FILE`: `ARC_PAY_SECRET_KEY`, `ARC_PAY_WEBHOOK_SIGNING_SECRET`, `STEAM_WEB_API_KEY`, `SIH_API_KEY`, `SIH_STEAM_REFILL_API_KEY`, `ADMIN_API_TOKEN`, `PURELYMAIL_SMTP_PASSWORD`, `SLACK_ORDERS_WEBHOOK_URL`, `VV_ADMIN_WEBHOOK_SECRET`, `VV_ADMIN_INTEGRATION_SECRET`. Backend entrypoint создаёт временные файлы с правами 0600 внутри контейнера и передаёт существующим клиентам соответствующие `_FILE` пути. Секреты не требуются при build, не копируются в image и не требуют host bind mount. Для локального запуска без контейнера по-прежнему используется `backend/.env.example` с `_FILE` настройками.

## Порядок запуска

### VV-162 analytics

Runtime configuration: `ANALYTICS_ENABLED=true`, `ANALYTICS_GA_ID=G-XWF1ZMQBL1`,
`ANALYTICS_YANDEX_ID=113586674`, `ANALYTICS_WEBVISOR=true`. Counters load only
in production on `https://shardsmarket.com`, on the home, catalog and legal
pages. Account, cart, payment and auth pages do not load counters. Navigation
across public/private boundaries in either direction opens a fresh document,
ending Webvisor and keeping browser Back from restoring private DOM in a tracked document.
Forms containing Steam login, email and OTP are masked. Yandex manual page views
omit query strings, fragments and external referrers.

GA4 uses the same integration as Frags and Skindrop: standard `gtag('config', id)`
initialization and Enhanced Measurement for SPA history changes. The application
sends no manual GA4 `page_view` events and requires no manual-pageview confirmation
flag. GA4 collects public page URLs through its standard automatic measurement.
Local browser tests intercept both loaders: they verify a single GA initialization,
no duplicate application page views, Yandex route hits and no tracker in private
documents. Real provider delivery must be checked separately.

Workflow строго выполняет checkout → копирование `.env` и chmod → `docker compose build` → `docker compose up -d` → удаление `.env` через `if: always()`. Concurrency `shardsmarket-stage` исключает два одновременных деплоя. Отдельных status/health шагов, `down` или `--no-cache` нет. Существующий CI lint/test/build сохранён отдельно.

Compose сам поднимает PostgreSQL, ждёт его healthcheck, выполняет одноразовый `migrate` (`restart: "no"`), затем запускает API и workers. Каждый backend process имеет собственный build context. Frontend ждёт healthy API; API проверяет `/health/ready` внутри контейнера. В первый запуск отсутствие/ошибка миграций блокирует зависимые процессы.

Перед первым запуском подготовить каталог данных, собственный env и backup-процедуру. Если уже существовали данные старого compose project `shards` в named volumes, выполнить backup/restore в новые host paths **до** переключения: Compose сам их не переносит. Старый `compose.yml` удалён; не запускать старую и новую конфигурации параллельно.

Новый коммит в `main`, отправленный в remote, запускает deploy workflow при наличии runner. Само добавление workflow не является фактом деплоя. Активация денег/поставщиков выполняется отдельно по [provider-acceptance.md](provider-acceptance.md).

При откате сохранить БД и принятые операции: выключить новые финансовые команды, продолжить reconciliation и вернуть совместимый образ. Не удалять схему и persistent data. Каталог обновляется раз в 5 минут; payment/wallet reconciliation — раз в 60 секунд, fulfillment имеет отдельный цикл, SMTP/VV — собственные outbox workers.

## Локальная проверка конфигурации (2026-10-11)

`docker compose config` с безопасным тестовым env прошёл; проверены project name, host ports, bind volumes, restart policy и собственный build каждого процесса. `docker compose build` успешно собрал все восемь application images. Docker entrypoint проверен на тестовых значениях: секрет передаётся в файл 0600, исходная переменная убирается из окружения дочернего процесса, runtime работает от UID 1000, `/app/.env` отсутствует. Backend lint/build и `git diff --check` проходят. Временный корневой `.env` удалён после проверки. На отдельной пустой disposable PostgreSQL БД выполнены миграции из Docker image, API readiness с Redis вернул ok, финансовые capabilities остались false. Проверена цепочка frontend container → Next `/api` proxy → API → PostgreSQL/Redis. Временные контейнеры, сеть и БД удалены; рабочие серверы и данные не использовались.

Сам workflow не запускался, push/remote deploy и изменения сервера не выполнялись. Это проверка конфигурации и локальных образов; наличие runner, stage env, домена и реальное состояние сервера не проверялись.


## VV-162 server setup (2026-10-11)

Server: 147.93.85.171, Ubuntu24.04, Docker29.9, Compose5.6. Repository default
branch is main. The shardsmarket-stage runner runs as deploy from
/home/deploy/actions-runner. Runtime env is /home/deploy/.envs/shardsmarket/.env,
mode0600, with newly generated database/session/encryption secrets.

Nginx proxies shardsmarket.com to localhost3000. HTTPS is enabled with Let's
Encrypt and certbot.timer renewal. Initial deployment38174164378 of b02c1cf
completed successfully; public API readiness confirmed PostgreSQL and Redis.
Live active markup is2000bps; previous pricing rows remain superseded.

Notifications, catalog and VV Admin commands require --watch. Without it they
finish one cycle and Docker repeatedly restarts them. Stage CLI contract tests
check the actual Compose arguments against worker parsers.

A root cron job at02:17UTC runs /root/shards-backup.sh, retaining local database
dumps and matching runtime env snapshots for14days in /opt/shardsmarket/backups
(mode0700, files0600). Initial dump was created and its archive index read.
This is a local backup, not an off-host disaster-recovery copy.

SMTP authentication for support@shardsmarket.com passed without sending a test
email. ArcPay is not configured; financial flags remainfalse. See the provider
configuration update below for SIH.

GA4 was activated in aa364e0 using the same automatic SPA tracking as Frags and
Skindrop. Live verification observed one page_view for / and one for /catalog,
both accepted with HTTP204, with no manual duplicate events. The private cart
document had no GA loader. Yandex remains enabled. CI38176686221 and
deploy38176686220 completed successfully. Dashboard ingestion was not inspected.


## SIH provider configuration (2026-10-12)

The owner-supplied skin market key is installed in the Shards runtime environment.
At the owner's explicit request, only the Steam refill key was read from the
Frags server's dedicated secret file and installed as SIH_STEAM_REFILL_API_KEY.
Frags configuration was not modified. No credential values are stored in Git.

After backup and service recreation, the catalog worker successfully loaded
28,281 supplier listings and published 25,006 CS2 products. Public catalog API
confirmed the published total. API and catalog containers are running.

A check-only Steam request through the application's Node runtime returned HTTP200
with the expected account-not-found response for a synthetic probe login. This
confirms authenticated access, not successful refill delivery. No pay call was made.
An earlier Python probe received Cloudflare1010; the runtime probe did not.

ArcPay remains unconfigured and the active skin pricing row still has
fxVerified=false. Financial flags were not activated. Local DB/env backups were
created before and after this configuration change. Temporary credential copies
were removed after installation.
