# Shards — правила проекта
- Название проекта и внутренняя валюта — Shards. Курс: 1 ₽ = 1,6 Shards; пересчёт в целых минимальных единицах, с округлением половины вверх. При изменении валюты сохранять рублёвую стоимость товаров.
- Выполнить семь этапов project-prompts.md, пользователь уже поручил реализацию после промптов.
- Соседние проекты читать, не менять. Не копировать секреты, .git, .env и конфигурацию публикации.
- Структура Flare; визуальные источники только Spectra Lab и Butter.
- Новые GitHub-репозитории только private VV-organization/<name>.
- Любое добавление → видимое нижнее подтверждение со ссылкой на корзину и закрытием, внутри dialog при quick view, aria-live.
- Добавленный товар имеет рабочую ссылку «Перейти в корзину» на карточке, в quick view, на товаре и в комплекте.
- Проверять add → confirmation → cart → item, duplicate prevention, reload, mobile и keyboard.
- Не выдавать локальный кабинет за Steam-сессию, не имитировать оплату, остатки, отзывы и выдачу.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
