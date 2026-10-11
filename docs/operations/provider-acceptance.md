# Отдельная активация провайдеров

Код и mocked/DB проверки не подтверждают доступность оплачиваемых методов. Перед реальным запуском нужны собственные домены/ключи/аккаунты Shards. Не использовать Frags как платёжную конфигурацию.

- `npm --prefix backend run acceptance:readiness` печатает только наличие/доступность необходимых параметров, без значений секретов. Это конфигурационная проверка, не provider acceptance.
- Steam: проверить HTTPS OpenID callback с PUBLIC_BASE_URL=/api, реальные cookies, привязку аккаунта и trade partner. SMTP: собственный sender, доставка OTP, expiry/resend/link conflict без смены владельца.
- SIH: read-only каталог, доступность CS2, текущие supplier prices, срок свежести и подтверждённый FX. Отдельно санкционированный sandbox skin order должен пройти lookup исходного custom ID, trade protection и terminal outcome.
- ArcPay: реальные методы, лимиты и checkout origin сверить с собственным аккаунтом; проверить независимые session ID/payment ID, внешнюю подпись, authoritative GET, callbacks/reconciliation и суммы. Нельзя считать redirect success оплатой. Allowlist только подтверждённых provider origins.
- Steam refill: повторно подтвердить действующие лимиты/комиссию и семантику check/pay/transaction ID. Paid-but-unknown остаётся review до подтверждения. В local-коде 50–9433 RUB и 5% — выбранные условия проекта, не доказательство текущих provider limits.
- После отдельного разрешения провести контролируемую реальную оплату/выдачу и подтвердить ledger, возврат, уведомления и VV event. Только затем включать соответствующие feature flags. Контролируемые live charges и production mutation текущим заданием не разрешены и не выполнялись.
