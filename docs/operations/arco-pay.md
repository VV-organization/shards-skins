# Arco Pay / Clickit: магазин 1581

Новые пополнения Shards и прямой Steam используют Arco Pay: API
`https://api.clickit.team/api/v1`, форма `https://payment.paidlayer.com`, магазин 1581.
Существующий курс 1 RUB = 1,6 Shards, комиссия Steam и гостевой сценарий сохранены.

## Контракт

- CREATE отправляет CARD, PayIn, IsForm=true, LifeTime=900, сумму в копейках,
  UUID локального платежа как MerchantOrderId и x-req-id. Авторизация — bearer + x-api-key.
- Callback: `https://shardsmarket.com/api/payments/webhooks/arco-pay`.
  Payment-Sign проверяется RSA-SHA1 по исходным байтам, затем статус запрашивается в API.
- Проверяются магазин, RUB, сумма, локальный UUID и сохранённый OrderId.
  Только CHARGED или IPS_ACCEPTED подтверждают оплату. CREATED/AUTHORIZED не начисляют деньги.
- OrderId сохраняется как provider_session_id и provider_payment_id. Ранний callback
  не может потерять привязку, другой OrderId не может её перезаписать.
- При неизвестном результате CREATE новый запрос не создаётся: manual_review,
  восстановление по подписанному callback. Если OrderId сохранён, его опрашивает reconciliation.
- Оба перехода на форму (создание и продолжение оплаты) используют POST с successUrl/failUrl
  на `/payments/return?session=...`. Возврат браузера не подтверждает оплату.
- Новая форма создаёт отдельный платёж с новой котировкой и ключом. Только восстановление
  неизвестного HTTP-результата повторяет исходные key/body.
- Продолжение оплаты выполняет ownership/CSRF-защищённый `POST /payments/sessions/:id/check`
  (для гостя — `/payments/guest/steam-refill/sessions/:id/check`). Проверяется только выбранная
  операция, без нового CREATE. Ошибка проверки не разрешает переход по старой ссылке.
- `expires_at` фиксирует 900 секунд жизни формы; migration 0040 заполняет его для старых
  Arco Pay платежей. Подтверждённый `EXPIRED` становится `failed` с публичным
  `failureReason=expired`. Само истечение локального времени не доказывает отсутствие оплаты.
- Спустя 5 минут после срока неподтверждённые `checkout_pending` переходят в `manual_review`
  с `paymentStatusUnresolved=true` и остаются в фоновой сверке. Поздний успех использует
  прежнюю идемпотентную обработку. Метрика `unresolved_payments` в integration health
  показывает manual review и просроченные ожидающие операции; ненулевое значение — degraded.
- Прямой Steam не начисляет Shards; оплаченный Steam создаёт одну команду выдачи.

## Конфигурация

См. `.env.example` и `backend/.env.example`. Ключи API, bearer и публичный ключ
задаются через ARCO_PAY_API_KEY, ARCO_PAY_BEARER_TOKEN, ARCO_PAY_PUBLIC_KEY на сервере;
entrypoint создаёт файлы 0600 и убирает значения из окружения дочернего процесса.
Локальный запуск использует соответствующие *_FILE. Секретов в репозитории нет.
Старые ARC_PAY_* переменные больше не используются. Перед переключением проверено:
на production отсутствуют top_up_payments, steam_refill_payments и orders.

## Проверки и границы

Unit/API contract, frontend build/typecheck/lint и интеграционные проверки выполняются
локально. Интеграции используют только изолированную shards_test с пользователем shards_test.
GitHub CI не создаёт тестовую базу. Проверяются подпись, чужой магазин/заказ, несовпадение
суммы, дубли, callback до ответа CREATE, потеря ответа и обработка обоих типов пополнения.

Проверка fxVerified удалена из checkout и конфигурации витрины; миграция 0039
удаляет устаревшее поле из metadata, сохраняя параметры расчёта цены. Проверки
активной версии цены, баланса, котировки и получателя остаются. Покупка скинов
включается через SHARDS_CHECKOUT_ENABLED при настроенной выдаче SIH.
Реальные списания и выдача в ходе проверки не выполняются.
Доступность карточной формы зависит от настройки общего магазина на стороне провайдера.
