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
