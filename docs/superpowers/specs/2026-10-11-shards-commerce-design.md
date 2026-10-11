# Архитектура коммерческого Shards

Статус: предлагаемая спецификация для реализации; код продукта ещё не изменён. Дата: 11 октября 2026.

## Цель и границы

Подключить дизайнерский Shards к самостоятельному backend на основе текущего Frags, сохранив визуальную систему. Скины покупаются только за внутренний баланс. Прямое пополнение Steam не использует Shards wallet. Float удаляется полностью. Дуэт — произвольный нож и перчатки без скидки. Реальный запуск выполняется только после проверки собственного окружения и контрактов поставщиков.

Backend Frags читается как исходная реализация, но его секреты, базы, production-конфигурация, сторонние реквизиты и разрешения не переносятся. Не создаём микросервисы: NestJS modular monolith, PostgreSQL, отдельные процессы worker, Next.js frontend. PostgreSQL хранит финансовое состояние и durable commands/outbox; Redis не является источником денег или статусов.

## Зафиксированные правила

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

## Модули и публичный контракт

| Модуль | Ответственность |
| --- | --- |
| Identity | Steam OpenID, email OTP, server session, CSRF, ownership trade-URL |
| Catalog and pricing | SIH CS2, metadata, нормализованные category/wear/StatTrak, versioned цены |
| Cart and duo | Версия корзины, обычные строки, атомарное добавление пары |
| Quotes and checkout | Снимок состава и цены, подтверждение, заказ и wallet hold |
| Wallet and payments | Ledger, баланс/резерв, Arc Pay, отдельные назначения платежей |
| Fulfillment | Постоянная внешняя операция, закупка, статусы, recovery, частичное завершение |
| Operations | Histories, outboxes, metrics/health, reconciliation, audit |

Новые/изменённые DTO публикуются через OpenAPI и генерируются для frontend. Внутренние имена `coinMinor`/`COINS` можно сохранить в унаследованном коде: они обозначают Shards в отдельной базе, без механического массового переименования. Пользовательские тексты, платёжные описания, cookies и события должны говорить Shards.

### Каталог

`GET /storefront/config` возвращает `rate:{fiatMinor:100,coinMinor:160}`, `rateVersion`, допустимые лимиты пополнений, `steamFeeBps:500`, разрешённые способы оплаты и готовность коммерческих сценариев без секретов. Идентификаторы товарных вариантов стабильны по SIH market name, включая wear/StatTrak.

`GET /catalog` расширяется точными фильтрами `categoryId`, `condition`, `stattrak`, `weapon`, границами Shards и серверной пагинацией. Товар содержит `priceRevision`, меняющуюся при изменении цены, её версии или availability. `GET /catalog/{slug}` отдаёт доступность даже исчезнувшего ранее публичного SKU; не раскрывает никогда не опубликованные товары. `POST /catalog/lookup {slugs}` разрешает максимум 50 известных slug; он нужен избранному/витрине, без 50 индивидуальных запросов. Корзина дополнительно хранит собственный безопасный display snapshot на случай физического отсутствия catalog row.

Торговый SKU публикуется только при надёжно определённой категории, положительной цене и пригодном supplier listing. Пустой/ошибочный ответ поставщика не стирает последний успешный каталог молча. Last-success timestamp и ошибки sync наблюдаемы. Исторические seed-товары не участвуют в live продаже. Статические декоративные изображения дизайнера остаются; продаваемые карточки получают актуальную идентичность и данные.

### Деньги и котировки

`rubToShardsMinor(R)=floor((8R+2)/5)` и `shardsToRubReferenceMinor(S)=floor((5S+4)/8)`. Выполнять в BigInt, проверять safe integer, отрицательные значения и overflow. Суммировать Shards до обратного пересчёта. Данные поставщика и наценка не превращаются в float-number деньги.

Пополнение Shards: целые 100–100000 Shards, то есть minor кратны 100. `fiatAmountMinor=ceil(5S/8)`; на разрешённых входах совпадает с half-up. Курс фиксируется в платёжной сессии. Примеры: 1000 Shards → 62500 RUB minor, 101 Shards → 6313 RUB minor. Дробный ввод отклоняется до создания платежа.

Начальная наценка SIH — 25% как явно выбранный параметр переноса Frags; хранится версионированно и может меняться. Исторический FX 95 RUB/USD не является live-настройкой: рабочие значения задаются и проверяются до активации. Округление клиентской цены до 0.01 Shards, не до целого Coin. Кэш pricing учитывает ID версии; каталог, SQL сортировки, quote и checkout используют одну формулу.

`commerce_quotes`: UUID, purpose `duo|checkout|wallet_topup|steam_refill`, optional user_id (только public duo), cart_version (checkout), payload JSON с точными строками/суммами/pricing versions, content hash, created_at, expires_at, consumed_entity_id. TTL по умолчанию 60 секунд. Поглощённый checkout/payment quote не создаёт второй бизнес-объект с новым command key. Quote — снимок и основание подтверждения, не резерв предметов у SIH. Read-only create quote не делает платёж или резерв кошелька.

### Корзина и дуэт

`GET /cart` возвращает `version`, строки с состояниями `available|unavailable|price_changed`, итог и `canCheckout`. Недоступные строки остаются видимыми и удаляемыми. Mutation требует session+CSRF и `expectedCartVersion`; несовпадение возвращает 409 с актуальной корзиной. `carts.version` увеличивается при изменении состава; одинаковое идемпотентное добавление его не увеличивает.

`GET /duo/options?slot=knife|gloves&limit=...&cursor=...` использует нормализованные категории, сортировку по цене и стабильному ID. Список не ограничен первой страницей общего каталога. Состояние и StatTrak различимы в существующем списке; интерфейс не меняет выбранный вариант автоматически при новой цене/наличии. Страница по умолчанию 60 вариантов, следующие страницы подгружаются внутри прежнего popup при достижении конца мышью или клавиатурой. Loading/retry доступны в footer popup вне listbox; выбранный SKU хранится независимо от загруженной страницы. Повторные страницы дедуплицируются по slug, reset фильтра не теряет выбор.

`POST /duo/quotes {knifeSlug,gloveSlug,budgetRubMinor}` проверяет ровно один knife и один gloves, положительную цену и доступность. Ответ: `quoteId`, `items`, `totalCoinMinor`, `totalRubReferenceMinor`, `budgetRubMinor`, `remainingRubMinor`, `withinBudget`, `expiresAt`. Бюджет относится только к паре и является сравнением её RUB эквивалента, не кошельком и не бюджетом всей корзины.

`POST /cart/duo {quoteId,expectedCartVersion}` с `Idempotency-Key` повторно проверяет quote и актуальность данных; в одной DB transaction добавляет недостающие строки quantity=1. Если один предмет недоступен, quote устарел или пара превышает бюджет, не добавляет ничего. Повтор не дублирует предметы. Превышение лимита 50 SKU отклоняет всю операцию. В корзине пару можно разбирать обычным удалением.

Гость, нажавший добавить, видит текущий modal Steam-входа. `sessionStorage` хранит intent `{kind,slugs,budget,displayedRevisions,createdAt,nonce,returnTo}` максимум 15 минут в этой вкладке, без credentials и доверенных клиентских сумм. `displayedRevisions` содержит только `{slug,priceRevision}` для сравнения с новой серверной котировкой. `returnTo` для первого релиза всегда `/cart`; детали выбора хранятся в intent, не в redirect URL. После callback новую сессию проверяет API, сервер заново котирует intent. Совпавшие revisions допускают добавление; изменение или отсутствие revision требует подтверждения. Повтор callback не повторяет mutation. Logout/смена уже авторизованного пользователя очищает pending intent, command keys и user-specific UI; переход anonymous→ожидаемый Steam callback не уничтожает собственный intent. Старый preview-login игнорируется.

### Checkout и получение

`POST /checkout/quotes {cartVersion}` возвращает quote checkout для текущей корзины, точных цен и текущего принадлежащего пользователю recipient. Перед созданием quote запрашивает read-only свежие предложения SIH; сетевые обращения выполняются вне DB transaction. Неполная проверка не выдаёт пригодный к покупке quote.

`POST /checkout/cart {quoteId,cartVersion}` с `Idempotency-Key` создаёт заказ только для указанной версии и состава. Порядок блокировок единый: cart → wallet → order/hold. Quote/user/recipient/pricing версии сверяются в transaction; при необходимости внешней перепроверки её выполняют перед transaction и повторно сверяют локальные версии. Повтор успешного command возвращает сохранённый результат даже после истечения quote; тот же ключ с другим payload отклоняется.

В одной transaction: order, строки, wallet hold, encrypted recipient snapshot, supplier request snapshot/cost cap, fulfillment commands, outbox и удаление именно купленных строк. Другие изменения корзины не теряются. Пустой баланс, чужой trade-URL, другая версия корзины, expired/изменившийся quote не создают hold/order. Ни картой, ни SBP в этом endpoint заплатить нельзя.

### Внешняя выдача и неопределённые результаты

`fulfillment_commands.provider_operation_id` уникален и неизменяем; SIH `customId` не меняется при HTTP retry. Каждая attempt — запись истории одной операции, не новая покупка. Фиксируются точные recipient, market name, max cost, operation purpose. Поздние изменения профиля или listings не меняют созданную операцию.

Claim не зависит от JOIN с активным listing. До первой отправки свежая проверка availability/cost; рост выше snapshot cap не компенсируется дополнительным списанием. До отправки безопасно завершить строку отказом; после неизвестного исхода hold сохраняется до выяснения.

Lease: owner token, locked_until, next_attempt_at. Изменение результата требует актуального token; поздний ответ старого worker не перезаписывает новое состояние. Recovery после истёкшей lease сначала ищет SIH order по постоянному customId. При неизвестном исходе и отсутствии доказательства безопасности повтора — manual_review, не новый create. Повтор с тем же ID разрешён только после подтверждения provider idempotency. Steam pay также фиксирует transactionId; неизвестный pay не запускает новый check/pay с новым ID.

В каждом worker cycle есть отдельные ограниченные проходы submit, reconcile и recovery, чтобы очередь новых заказов не останавливала завершение старых. Backoff и max age настраиваемы; превышение порога → наблюдаемое manual_review, не незаметный вечный pending.

Для SIH `sent` не означает доставку; protection processing сохраняет ожидание, protection failure → ручной разбор. Terminal transition сериализуется по заказу: wallet lock → order lock → line/hold updates, при этом claim transaction уже завершена. После terminal результата всех строк capture равен сумме реально завершённых строк, remainder hold освобождается в той же transaction. Это исключает гонку одновременного завершения двух последних строк, когда обе могли бы не увидеть завершение соседней. Дополнительный settlement sweep восстанавливает terminal orders с active hold по тем же инвариантам, никогда не освобождает средства неизвестных операций. Не выдавать частичную доставку за успех всего дуэта. Внутренний inventory withdrawal endpoint без исполнителя не публиковать.

### Платежи и подтверждение почты

Shards topup требует Steam identity и текущую сессию. Steam refill требует сессию и подтверждённый email, но не Steam identity и не Shards wallet. Форма прямого Steam содержит RUB amount, Steam login, email; гостю существующий modal показывает OTP. Подтверждённый email повторно не запрашивается. Contact email не означает verified identity.

Email OTP modes различаются: `sign_in` для гостя и `link_email` для текущего Steam user. Link challenge привязан к user/session; при смене user или занятом email не переключать владельца и не объединять записи/деньги. Переключение email-only → Steam — явная новая сессия без автоматического слияния. Email-only пользователь может оплачивать Steam, но не пополнять внутренний кошелёк до корректного Steam-входа. В существующем modal доступна ссылка «Войти по почте» для повторного доступа к истории Steam. Payment return после 401 сохраняет paymentId, восстанавливает session и продолжает status read, не создаёт новый платёж; при другом владельце показывает отказ доступа.

`POST /payments/top-up/quotes {coinAmountMinor}` и `POST /payments/steam-refill/quotes {amountRub,steamLogin}` требуют соответствующие identity/session/CSRF и возвращают `quoteId`, `purpose`, `fiatAmountMinor`, `currency:'RUB'`, `termsVersion`, `expiresAt` и точные условия зачисления. Steam quote выполняет проверку логина и сохраняет её provider reference. `POST /payments/top-up/sessions` и `POST /payments/steam-refill/sessions` принимают `{quoteId,acceptedFiatMinor}` и Idempotency-Key, не произвольные цены/получателя. Изменение fee/rate/recipient/лимита после отображения требует новой котировки и подтверждения.

Платёжные сессии создаются с durable idempotency; до получения checkoutUrl повторяется прежний ключ. Backend проверяет связь provider payment ID, external session ID, environment, purpose, amount и currency; при callback до сохранения provider ID привязка устанавливается только по проверенному ответу провайдера и уникальному неизменяемому external ID. Несовпадение → rejected/manual_review без денег. `GET /payments/sessions/{id}` доступен только владельцу и возвращает раздельные paymentStatus и fulfillmentStatus.

Return URL показывает ожидание и читает серверный статус. Только проверенный webhook/reconciliation зачисляет Shards или создаёт Steam fulfillment. Повтор callback не повторяет credit/order. Статусы «оплачено» и «зачислено в Steam» раздельны. SBP — начальный способ текущего клиента Arc Pay; банковскую карту не изображать рабочей до её отдельной интеграции.

## Визуальная и продуктовая интеграция

Сохраняются внешний вид hero, каталог/карточки, инспектор изображения, duo stage/receipt, структура кабинета, шрифт, цвета, анимация и responsive сетка. Существующие компоненты получают адаптеры API. Удаляется float: Product.float, snapshot/fixtures, сортировка, карточка/quick view, cart, «В твоём фокусе», шкала и осиротевший CSS; wear FN/MW/FT/WW/BS остаётся.

В skin checkout остаётся один способ — баланс Shards. Для покупки показывается `availableCoinMinor`; `heldCoinMinor` объясняется отдельно как резерв незавершённых заказов. Освобождение резерва не называется уже выполненным возвратом до settlement. Недостаток средств ведёт в существующий блок пополнения с сохранённым returnTo=cart и предзаполнением `max(100,ceil(shortfallMinor/100))` целых Shards. Если результат больше100000, отображается лимит и оставшаяся нехватка, без скрытого уменьшения суммы или серии автоплатежей. После платежа обновляется баланс и quote, покупка не запускается автоматически. Переход за trade-URL открывает текущую account panel с returnTo=cart; успешное сохранение предлагает продолжить покупку с новой quote. Действительные ошибки/статусы показываются существующими notice/modal/form-message. Loading не показывает фиктивный нулевой баланс или «покупок нет». Уведомление «Дуэт добавлен» только после успешного server response и отражает фактически добавленные/уже присутствующие строки.

Слоты витринных подборок сопоставляются со стабильными market names; не оставлять hardcoded snapshot IDs на live странице. На отсутствие товара есть честный fallback внутри прежнего layout, не сдвигающий всю композицию. Каталог/страницы товара работают динамически, production не использует static export snapshot.

## Проверка и активация

Обязательны отдельная disposable PostgreSQL, suite миграций с нуля, unit/DB/contract/browser проверки и визуальное сравнение с исходным дизайнерским состоянием. Source Frags clean; Shards changes scoped. Разрешённые визуальные отличия перечислены выше, остальные считаются регрессией.

Перед live: собственные домены/секреты/SMTP/Arc Pay/SIH/VV Admin, проверенный FX/markup, backup и migration dry run, workers/reconciliation расписания, read-only provider acceptance, затем отдельно разрешённые платёж/выдача acceptance. Платежи/выдача по умолчанию выключены, пока их readiness не подтверждён. Откат выключает новые операции, но оставляет status/reconciliation для уже отправленных; unresolved orders нельзя откатывать удалением БД или повторным созданием. Notification/VV outbox также имеет lease recovery и стабильный eventId; accepted remote response с потерянным локальным ack не теряет событие и не меняет заказ повторно.

## Что не входит в первый запуск

Скидочные наборы Frags; автоматический подбор/совместимость цветов; межустройственное избранное; гостевая корзина и миграция prototype cart; прямые карточные покупки скинов; другие игры/Apple; обещания точного float/asset; автоматическое объединение аккаунтов и кошельков; неподтверждённый inventory withdrawal. Исторические миграции можно сохранить, но эти модули не должны быть активными API/capabilities.
