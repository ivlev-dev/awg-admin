# HTTP API

Базовый путь: `/api/v1`. Формат ошибок:

```json
{"error":{"code":"not_found","message":"..."}}
```

Коды: `bad_request`, `invalid_idempotency_key`, `idempotency_in_progress`, `idempotency_key_mismatch`, `invalid_token`, `invalid_filter`, `unauthorized`, `forbidden`, `not_found`, `billing_disabled`, `conflict`, `tariff_required`, `too_many_requests`, `internal`, `totp_required`, `totp_invalid`, `email_not_verified`, `pending_approval`, `rejected`, `account_disabled`. Пагинации нет. Права: `public`, `user`, `admin`; `user (self)` — только владелец объекта или admin. Ответ `429` дополнительно содержит заголовок `Retry-After` (секунды).

## Маршруты

| Метод | Путь | Права | Запрос | Ответ |
|---|---|---|---|---|
| GET | `/health` | public | — | `{status,service,version}` |
| GET | `/dev/mail` | admin | — | `DevMail[]` (только dev; `404` в production) |
| DELETE | `/dev/mail` | admin | — | `204` (только dev) |
| POST | `/auth/login` | public | `LoginRequest` | `AuthView` |
| POST | `/auth/register` | public | `{email,login?,password}` | `202 {status:"pending_email"}` |
| POST | `/auth/verify-email` | public | `{token}` | `{status:"pending_approval"}` |
| POST | `/auth/resend-verification` | public | `{email}` | `202 {status:"sent"}` |
| POST | `/auth/forgot-password` | public | `{email}` | `202 {status:"sent"}` |
| POST | `/auth/reset-password` | public | `{token,password}` | `200 {status:"reset"}` |
| POST | `/auth/totp/setup` | user | `{password?,code?}`¹ | `{secret,otpauth_url,recovery_codes}` |
| POST | `/auth/totp/enable` | user | `{code}` | `{enabled:true}` |
| POST | `/auth/totp/disable` | user | `{password,code}` | `{enabled:false}` |
| POST | `/auth/refresh` | public | `RefreshRequest` | `AuthView` |
| POST | `/auth/logout` | user | `LogoutRequest` | `{ok:true}` |
| POST | `/auth/logout-all` | user | — | `{ok:true,revoked}` |
| GET | `/auth/me` | user | — | `UserView` |
| POST | `/auth/password` | user | `{current_password,new_password,totp_code?}` | `{ok:true}` |
| GET | `/auth/sessions` | user | — | `SessionView[]` |
| DELETE | `/auth/sessions/{jti}` | user | — | `{ok:true}` |
| POST | `/auth/logout-all` | user | — | `{ok:true,revoked}` |
| GET | `/auth/sessions` | user | — | `SessionView[]` |
| DELETE | `/auth/sessions/{jti}` | user | — | `{ok:true}` |
| GET | `/users` | admin | — | `UserView[]` |
| GET | `/users/page` | admin | query `limit,offset,q,role,status,tab` (см. «Серверная пагинация») | `{items: UserView[], total, limit, offset}` |
| GET | `/users/pending` | admin | — | `UserView[]` (pending approval) |
| POST | `/users/{id}/approve` | admin | `{tariff_id,node_id?,group_id?}` | `UserView` |
| POST | `/users/{id}/reject` | admin | — | `UserView` |
| POST | `/users` | admin | `CreateUserRequest` | `UserView` |
| GET | `/users/{id}` | admin | — | `UserView` |
| PATCH | `/users/{id}` | admin | `UpdateUserRequest` | `UserView` |
| DELETE | `/users/{id}` | admin | — | `{ok:true}` (каскадно удаляет устройства, пиры и share-ссылки) |
| POST | `/users/bulk` | admin | `{action,ids}` (см. «Массовые действия») | `{done,failed[]}` |
| POST | `/users/{id}/password` | admin | `{new_password}` (по контроллеру) | `{ok:true}` |
| GET | `/tariffs` | admin | — | `TariffView[]` |
| POST | `/tariffs` | admin | `CreateTariffRequest` | `TariffView` |
| PATCH | `/tariffs/{id}` | admin | `UpdateTariffRequest` | `TariffView` |
| DELETE | `/tariffs/{id}` | admin | — | `{ok:true}` |
| POST | `/tariffs/bulk` | admin | `{action,ids}` (см. «Массовые действия») | `{done,failed[]}` |
| GET | `/groups` | user | — | `GroupView[]` (interfaces, devices) |
| POST | `/groups` | admin | `CreateGroupRequest` | `GroupView` |
| PATCH | `/groups/{id}` | admin | `UpdateGroupRequest` | `GroupView` |
| DELETE | `/groups/{id}` | admin | — | `{ok:true}` |
| POST | `/groups/bulk` | admin | `{action,ids}` (см. «Массовые действия») | `{done,failed[]}` |
| GET | `/groups/{id}/pools` | user | — | `PoolView[]` |
| POST | `/groups/{id}/pools` | admin | `CreatePoolRequest` | `PoolView` |
| PATCH | `/pools/{id}` | admin | `UpdatePoolRequest` | `PoolView` |
| DELETE | `/pools/{id}` | admin | — | `{ok:true}` |
| GET | `/nodes` | user | — | `NodeView[]` |
| POST | `/nodes` | admin | `CreateNodeRequest` | `NodeView` |
| DELETE | `/nodes/{id}` | admin | — | `{ok:true}` |
| POST | `/nodes/bulk` | admin | `{action,ids}` (см. «Массовые действия») | `{done,failed[]}` |
| POST | `/nodes/{id}/rotate` | admin | — | `{node: NodeView, token}` (токен показывается один раз) |
| GET | `/interfaces` | user | — | `InterfaceView[]` |
| POST | `/interfaces` | admin | `CreateInterfaceRequest` | `InterfaceView` |
| PATCH | `/interfaces/{id}` | admin | `UpdateInterfaceRequest` | `InterfaceView` |
| DELETE | `/interfaces/{id}` | admin | — | `{ok:true}` |
| POST | `/interfaces/bulk` | admin | `{action,ids}` (см. «Массовые действия») | `{done,failed[]}` |
| POST | `/interfaces/{id}/rotate` | admin | — | `{ok:true}` |
| GET | `/devices` | user | — | `DeviceView[]` (admin видит все, user — свои) |
| GET | `/devices/page` | user | query `limit,offset,q,status,interface_id,user_id,sort,order` (см. «Серверная пагинация») | `{items: DeviceView[], total, limit, offset}` |
| POST | `/devices` | user | `CreateDeviceRequest` | `DeviceView` |
| GET | `/devices/{id}` | self/admin | — | `DeviceView` |
| PATCH | `/devices/{id}` | self/admin | `UpdateDeviceRequest` | `DeviceView` |
| DELETE | `/devices/{id}` | self/admin | — | `{ok:true}` |
| POST | `/devices/bulk` | self/admin | `{action,ids}` (см. «Массовые действия») | `{done,failed[]}` |
| GET | `/devices/{id}/profiles` | self/admin | — | `ProfileView[]` (по одному на каждый пир устройства, отсортировано по `interface_name`, `label`, `peer_id`) |
| GET | `/devices/{id}/profiles/{interface_id}` | self/admin | — | `ProfileView` (primary-пир интерфейса) |
| GET | `/devices/{id}/profiles/by-peer/{peer_id}` | self/admin | — | `ProfileView` конкретного пира |
| POST | `/devices/{id}/tunnels` | self/admin | `{interface_id, label?}` | `DeviceView` (создан новый пир) |
| PATCH | `/devices/{id}/tunnels/{peer_id}` | self/admin | `{label}` | `DeviceView` |
| DELETE | `/devices/{id}/tunnels/{peer_id}` | self/admin | — | `204` (последний пир удалить нельзя — `409`) |
| GET | `/devices/{id}/shares` | self/admin | — | `ShareLinkView[]` |
| POST | `/devices/{id}/shares` | self/admin | `CreateShareRequest` | `ShareLinkView` |
| DELETE | `/devices/{id}/shares` | self/admin | — | `{revoked:N}` (отзыв всех ссылок устройства) |
| GET | `/devices/{id}/stats` | self/admin | — | `DeviceTrafficView` (через stats) |
| DELETE | `/shares/{token}` | self/admin | — | `{ok:true}` (ставит `revoked_at`; чужой токен — `403`, неизвестный — `404`) |
| GET | `/stats/overview` | user/admin | — | `OverviewView` |
| GET | `/stats/series` | user/admin | query `scope,id,from,to` | `StatsPoint[]` |
| GET | `/stats/aggregate` | user/admin | query `scope,id,bucket,from,to` (см. «Агрегация статистики») | `{bucket,points}` |
| GET | `/quota` | user/admin | — | `QuotaView` (только своя квота) |
| GET | `/quota/users` | admin | — | `QuotaUserView[]` |
| GET | `/settings` | admin | — | `SettingsView` (obfuscation, share TTL, stats retention) |
| PUT | `/settings` | admin | `UpdateSettingsRequest` | `SettingsView` |
| GET | `/audit` | admin | query `limit`, `before`, `action`, `entity`, `actor`, `status`, `from`, `to` (см. «Аудит») | `{items, next_cursor}` |
| DELETE | `/audit` | admin | те же фильтры, что у `GET /audit` | `{deleted}` |
| POST | `/import` | admin | `ImportRequest` (устаревший) | `{group_id,interface_id,imported_devices,failed_devices}` |
| POST | `/import/preview` | admin | `BatchImportRequest` | `ImportPreviewView` (без записи в БД) |
| POST | `/import/apply` | admin | `BatchImportRequest` | `ImportApplyView` |
| POST | `/import/clients/preview` | admin | `ClientsImportRequest` | `ClientsImportPreviewView` (без записи в БД) |
| POST | `/import/clients/apply` | admin | `ClientsImportRequest` | `ClientsImportApplyView` |
| GET | `/ws/stats` | user | query `token,scope,id` | WebSocket |
| GET | `/app/bootstrap` | user | — | `AppBootstrapView` (профиль, тариф, квота, подписка, доступ, устройства, `devices_total`, доступные интерфейсы) |
| GET | `/app/devices/page` | user | query `limit,offset,q,status` (см. «Серверная пагинация») | `{items: DeviceView[], total, limit, offset}` (только свои устройства) |
| POST | `/app/devices` | user | `{name, interface_ids?}`, заголовок `Idempotency-Key` (опционально) | `{device: DeviceView, config: AppConfigView, configs: AppConfigView[]}` |
| GET | `/app/devices/{id}/config` | self/admin | — | `AppConfigView` (primary-интерфейс) |
| GET | `/app/devices/{id}/configs` | self/admin | — | `AppConfigView[]` (все пиры) |
| POST | `/app/devices/{id}/tunnels` | self/admin | `{interface_id, label?}` | `{device: DeviceView, config: AppConfigView, configs: AppConfigView[]}` |
| PATCH | `/app/devices/{id}/tunnels/{peer_id}` | self/admin | `{label}` | `{device: DeviceView, config: AppConfigView, configs: AppConfigView[]}` |
| DELETE | `/app/devices/{id}/tunnels/{peer_id}` | self/admin | — | `204` (последний пир удалить нельзя — `409`) |
| PATCH | `/app/devices/{id}` | self/admin | `{name}` | `DeviceView` |
| DELETE | `/app/devices/{id}` | self/admin | — | `204` |
| GET | `/share/{token}` | public | — | файл конфигурации (`download`) |
| GET | `/billing/plans` | admin | — | `Plan[]` |
| POST | `/billing/plans` | admin | `CreatePlanRequest` | `Plan` |
| PATCH | `/billing/plans/{id}` | admin | `UpdatePlanRequest` | `Plan` |
| GET | `/billing/subscription` | user | — | `Subscription` или `null` |
| GET | `/billing/invoices` | self/admin | query `user_id?`, `limit?` | `Invoice[]` |
| GET | `/billing/admin/subscriptions` | admin | query `status?`, `page?`, `per_page?` | `SubscriptionPageView` |
| POST | `/billing/checkout` | user | `{plan_id}` | `{invoice, checkout_url}` |
| GET | `/billing/payment-methods` | user | — | `PaymentMethodView[]` |
| POST | `/billing/webhook/{provider}` | public | подписанный webhook шлюза | `{status, event_id}` |

¹ `password` и `code` обязательны при повторной привязке, когда TOTP уже включён.

## Идемпотентность

Любой бизнес-`POST` под `/api/v1` можно сделать идемпотентным: достаточно
передать заголовок `Idempotency-Key` (имя регистронезависимо). Тогда повтор
запроса с тем же ключом и тем же телом адреса не выполнит операцию второй раз,
а вернёт сохранённый ответ первого успешного вызова.

- Заголовок действует на все `POST /api/v1/*`, кроме `POST /auth/*` и
  `POST /billing/webhook/*` (они не кэшируются: у логина, refresh и webhook
  своя семантика), а также кроме `POST /app/devices` — у него отдельный
  обработчик, см. «Идемпотентность создания устройства».
- Ключ: 8..128 символов из `A-Z`, `a-z`, `0-9`, `-`, `_`, `.`. Некорректный
  ключ — `400` с кодом `invalid_idempotency_key`; запрос до обработчика не
  доходит.
- Область ключа — пара «пользователь + метод + путь с query + ключ».
  Владелец определяется по заголовку `Authorization` (без токена — `anon`).
  Одинаковый ключ у разных пользователей или для разных маршрутов не
  конфликтует; повтор с тем же ключом на другой `path` — это другой запрос.
- TTL записи — 24 часа, после чего ключ можно использовать снова.
  Просроченная запись удаляется при чтении.
- Повтор во время выполнения первого запроса получает `409` с кодом
  `idempotency_in_progress`: второй эффект не создаётся. Если тело повтора
  отличается от тела уже выполняющегося запроса, ответ — `409` с кодом
  `idempotency_key_mismatch`. После успеха повтор возвращает готовый ответ,
  после ошибки запись освобождается и повтор разрешён. Проверка «выполняется»
  снимается автоматически через 5 минут, если процесс не успел завершить запрос.
- Поведение при повторе: возвращается статус и тело первого ответа (`2xx`),
  `Content-Type` восстанавливается из записи; обработчик не вызывается.
  После успешного завершения тело запроса повтора не сравнивается —
  возвращается первый результат.
- Кэшируются только успешные (`2xx`) ответы с JSON-телом не больше 2 МиБ.
  Ответы `4xx`/`5xx`, таймауты и ошибки не запоминаются: после исправления
  запроса тот же ключ выполнит операцию.
- `GET`/`PATCH`/`PUT`/`DELETE` заголовок игнорируют.
- Тело сохранённого ответа шифруется мастер-ключом (`AWG_MASTER_KEY`):
  в redb-таблице `idempotency` лежит только зашифрованная строка, открытых
  конфигов, ключей и приватных данных там нет.

Поддерживается заголовок в CORS: `Access-Control-Allow-Headers` содержит
`Idempotency-Key`, так что браузерный клиент может отправлять его напрямую.

## Пользователи и привязка к ноде

`UserView` (ответы `/auth/me`, `/auth/login`, `/auth/refresh`, `/users*`)
содержит обычные поля пользователя и:

- `email: string` — основной идентификатор, всегда заполнен (после миграции
  схемы); нормализуется (trim + нижний регистр), уникален без учёта регистра;
- `login: string` — устаревшее поле (deprecated), сохранено для совместимости;
  новые интеграции и UI используют `email`;
- `node_id: string|null` — нода, к интерфейсам которой привязываются новые
  устройства пользователя; `null` — нода не задана;
- `group_id: string|null` — устаревшее поле (deprecated), сохранено для
  совместимости и квот; новые интеграции используют `node_id`.

`CreateUserRequest`:

- `email: string` — обязательный; невалидный email даёт `400 bad_request`,
  занятый (без учёта регистра) — `409 conflict`;
- `password?: string` — опционально; если не передан или пуст, генерируется
  случайный пароль, который затем меняется через `POST /users/{id}/password`;
- `role`, `tariff_id`, `group_id?`, `node_id?` — как раньше;
- `login` больше не принимается: лишнее поле в JSON игнорируется. Внутренний
  `login` генерируется из local-part email: нижний регистр, допустимые символы
  `[a-z0-9._-]`, при коллизии добавляется суффикс (`user-2`). Для существующих
  пользователей `login` не меняется.

`UpdateUserRequest` принимает `email?: string` — смена email с нормализацией и
проверкой уникальности (занятый чужой email — `409 conflict`); отсутствие поля
оставляет email без изменений. `login` в `UpdateUserRequest` отсутствует.
Также `UpdateUserRequest` принимает `node_id` как double option:
поле отсутствует — привязка не меняется, `null` — очистить, строка — привязать
к ноде. `POST /users/{id}/approve` принимает `node_id?: string|null`;
`group_id` в этом запросе считается устаревшим, но если он передан, он
записывается пользователю для совместимости. Несуществующая нода даёт
`404 not_found`.

## Тарифы и привязка к интерфейсу

`TariffView` (ответ `GET/POST/PATCH /tariffs`) содержит обычные поля тарифа и:

- `interface_id: string|null` — интерфейс, который тариф назначает новым
  устройствам; `null` — интерфейс не задан;
- `interface_name: string|null` — имя интерфейса для отображения, `null` если
  интерфейс не задан или уже удалён.

`CreateTariffRequest` принимает `interface_id?: string|null`. `UpdateTariffRequest`
принимает `interface_id` как double option: поле отсутствует — привязка не
меняется, `null` — очистить, строка — привязать к интерфейсу. Несуществующий
интерфейс даёт `404 not_found`.

`DeviceView` (устройства) дополнительно содержит:

- `interface_id` — интерфейс устройства (primary);
- `interface_name` — имя интерфейса;
- `node_id` — нода интерфейса;
- `node_name` — имя ноды;
- `peers[]` — все пиры устройства (`peer_id`, `label`, `interface_id`,
  `interface_name`, `public_key`, `addresses`). Один интерфейс может содержать
  несколько пиров; `peer_id` уникален в пределах базы и используется в
  `/tunnels/{peer_id}` и `/profiles/by-peer/{peer_id}`. `label` — имя туннеля
  (по умолчанию имя интерфейса), 1..64 символа.

`CreateDeviceRequest` принимает `interface_id?: string` (устаревшее, один
интерфейс), `interface_ids?: string[]` (список интерфейсов) и необязательный
`group_id?: string` (устаревший; используется только если у пользователя нет
ноды и интерфейсы не выбраны тарифом или запросом). Правила выбора:

1. Если у тарифа пользователя задан `interface_id`, используется только он;
   `interface_ids` и `interface_id` запроса игнорируются.
2. Иначе, если `interface_ids` непуст, используются все перечисленные
   интерфейсы по порядку. Дубликаты отбрасываются. Все интерфейсы обязаны
   быть включёнными, принадлежать ноде пользователя (если `node_id` задан) и
   одной группе устройства; иначе `403 forbidden` (другая нода/группа или
   интерфейсы из разных групп) либо `409 conflict` (интерфейс выключен или не
   найден — `404 not_found`). Устаревший `interface_id` учитывается, когда
   `interface_ids` пуст.
3. Иначе работает автоопределение: единственный включённый интерфейс ноды
   пользователя (`node_id`) → единственный включённый интерфейс устаревшей
   группы пользователя (`group_id`) → ошибка.

Если у ноды нет включённых интерфейсов — `400 bad_request`
(`node has no enabled interfaces`), если их несколько — `400 bad_request`
(`node has multiple enabled interfaces; interface_id is required`). Если не
заданы ни нода, ни группа, ни интерфейс тарифа/запроса — `400 bad_request`.
Интерфейс другой ноды пользователя или другой группы — `403 forbidden`;
выключенный явно выбранный интерфейс — `409 conflict`. `group_id` устройства
всегда равен группе выбранного интерфейса.

Устройство создаётся с одним пиром (`DevicePeer`) на каждый выбранный
интерфейс. `Device.interface_id` и `DeviceView.interface_id` — первый
(primary) интерфейс списка; `DeviceView.peers[]` содержит все пиры.
Лимиты тарифа (`max_devices`, суммарная полоса группы) считаются один раз на
устройство, а не на пир. IP выделяется каждому пиру отдельно из enabled-пулов
группы его интерфейса; адреса уникальны между всеми пирами всех устройств.

`PATCH /devices/{id}` интерфейсы не меняет. `GET /devices/{id}/profiles`
возвращает по профилю на каждый пир устройства, отсортированные по
`interface_name`, затем по `label`, затем по `peer_id`. Профиль содержит
`peer_id`, `label`, `interface_id`, `interface_name`.
`GET /devices/{id}/profiles/{interface_id}` возвращает профиль primary-пира
интерфейса (первый по `label`, затем по `peer_id`) для совместимости;
`GET /devices/{id}/profiles/by-peer/{peer_id}` — профиль конкретного пира.
Неизвестный интерфейс или пир другого устройства — `404`.

Дополнительные туннели на уже подключённом интерфейсе:

- `POST /devices/{id}/tunnels` `{"interface_id":"uuid","label":"laptop"}` →
  `DeviceView`. Создаёт ещё один пир на интерфейсе: проверяются владелец
  устройства, активность устройства (revoked → `409`), включённость
  интерфейса (`409`) и принадлежность интерфейса группе и ноде устройства
  (`403`). `label` необязателен; по умолчанию — имя интерфейса; пустой или
  длиннее 64 символов — `400`. Лимит `max_devices` и суммарная полоса группы
  не пересчитываются: пир использует лимиты устройства. Новому пиру
  выделяются свободные IP из пулов группы. Внешнему устройству (импорт из
  серверного конфига) добавить пир нельзя — `409`.
- `PATCH /devices/{id}/tunnels/{peer_id}` `{"label":"new"}` → `DeviceView`;
  пир должен принадлежать этому устройству (`404`), `label` — 1..64 символа.
- `DELETE /devices/{id}/tunnels/{peer_id}` → `204`; удаление последнего пира
  устройства запрещено (`409`), иначе пир удаляется и группа публикуется на
  ноды.

## Серверная пагинация

Большие списки отдаются постранично. Контракт одинаков для всех ручек:
`{items: T[], total: number, limit: number, offset: number}`, где `total` —
число записей, подходящих под фильтры (не размер страницы), а `items`
содержит только запрошенное окно. Старые ручки (`GET /devices`, `GET /users`)
не меняются и по-прежнему возвращают полный список.

Общие правила:

- `limit` — 1..200, по умолчанию 50 (`/app/devices/page` — 20); `0`,
  отрицательное или больше 200 → `400 bad_request`.
- `offset` — ≥ 0, по умолчанию 0; смещение за пределами выборки возвращает
  пустой `items` и корректный `total`.
- `q` — подстрока без учёта регистра. Для устройств ищется по имени
  устройства и email владельца; для пользователей — по email и логину.
  Пустой `q` игнорируется.
- Порядок детерминирован: при равенстве ключа сортировки используется
  `id` записи, поэтому страницы не пересекаются и не теряют элементы.

### `GET /devices/page`

Параметры:

- `status` — `all` (по умолчанию), `active` (`revoked=false`), `revoked`.
- `interface_id` — UUID интерфейса; фильтр по primary-интерфейсу устройства.
- `user_id` — только для администратора: ограничивает выборку владельцем.
  Не-администратор видит только свои устройства; `user_id` другого
  пользователя → `403 forbidden`, свой `user_id` допускается. Без параметра
  администратор видит все устройства.
- `sort` — `name` (по умолчанию, регистронезависимо) или `created`.
- `order` — `asc` (по умолчанию) или `desc`.

Неизвестные значения `status`, `sort`, `order` → `400 bad_request`.
`DeviceView` собирается только для элементов страницы; `total` считается по
индексу с учётом всех фильтров.

### `GET /users/page`

Только администратор (иначе `403 forbidden`). Параметры:

- `role` — `all` (по умолчанию), `admin`, `user`.
- `status` — `all` (по умолчанию), `active` (`disabled=false`), `disabled`.
- `tab` — `active` (по умолчанию; все, кроме ожидающих одобрения) или
  `pending` (только `status=pending_approval`).
- `q` — подстрока в email или логине без учёта регистра.

Сортировка — по email (или логину, если email пуст) без учёта регистра, затем
по `id`. Страница читается из индекса `user_page_index`; таблица `users`
декодируется только для `limit` записей.

При `q` из трёх и более символов используется триграммный индекс
`user_search_index`: пересечение постеров 3-грамм, контрольная проверка
подстроки по email/login и те же фильтры/сортировка. `total` при этом
считается по совпадениям без полного обхода `user_page_index`. `q` из одного
или двух символов (а также `q` с символами вне `[a-z0-9@.-]`) идёт прежним
обходом `user_page_index`. Семантика `q` не меняется.

### `GET /app/devices/page`

Всегда возвращает только устройства текущего пользователя: `user_id` не
принимается (переданное значение игнорируется). Параметры `q` и `status`
работают так же, как у `/devices/page`; `limit` по умолчанию 20, максимум 200.
Предназначен для мобильного клиента, которому не нужен полный список из
`/app/bootstrap`.

## Мобильное приложение (Android)

Ручки `/api/v1/app/*` требуют `Authorization: Bearer …` и работают только с
данными текущего пользователя (`self/admin`), админских возможностей не
добавляют.

- `GET /app/bootstrap` → `{user: UserView, tariff: null|{id,name,description,max_devices,device_down_kbps,device_up_kbps,traffic_quota_bytes}, quota: QuotaView, subscription: null|AppSubscriptionView, access: AppAccessView, devices: DeviceView[], devices_total: number, interfaces: AppInterfaceView[]}`.
  `devices` по-прежнему содержит все устройства пользователя (нужны для
  синхронизации конфигов), а `devices_total` — их количество, чтобы клиент
  мог показать счётчик без отдельного запроса. Для постраничного списка
  используйте `GET /app/devices/page`.
  `tariff` — `null`, если тариф не назначен; `quota` считается по месяцу, как
  `GET /quota`. `interfaces` — доступные пользователю включённые интерфейсы
  `{id,name,node_id,node_name}`, отсортированные по `(name,id)`: если тариф
  пинит интерфейс — только он; иначе интерфейсы ноды пользователя, иначе
  интерфейсы его группы; если не задано ни то, ни другое — пустой массив.
- `POST /app/devices` `{"name":"Phone","interface_ids":["uuid","uuid"]}` →
  `{device: DeviceView, config: AppConfigView, configs: AppConfigView[]}`.
  Имя обязательно, 1..64 символа после `trim`, иначе `400 bad_request`.
  Без тарифа у пользователя — `409 tariff_required` (`tariff is required`).
  `interface_ids` необязателен; правила выбора те же, что у `POST /devices`
  (тариф → список интерфейсов → автоопределение). `configs` содержит конфиг
  на каждый пир (отсортировано по `interface_name`, `label`, `peer_id`),
  `config` — primary-пир primary-интерфейса (`device.interface_id`).
  Устройство с несколькими интерфейсами создаёт по пиру на каждый из них, но
  занимает одну позицию в лимите `max_devices`. Проверки «интерфейс другой
  ноды/группы/выключен» и лимит устройств тарифа сохраняются (`403`/`409`).
  Forwarding по умолчанию — как у `POST /devices`.
- `GET /app/devices/{id}/config` → `AppConfigView` для primary-пира
  primary-интерфейса.
  Доступ не блокируется ни квотой, ни статусом подписки: конфиг уже выдан,
  ограничение трафика применяется на ноде (см. «Троттлинг доступа»).
- `GET /app/devices/{id}/configs` → `AppConfigView[]` для всех пиров
  устройства (поля: `peer_id`, `label`, `interface_id`, `interface_name`,
  `node_id`, `endpoint`, `addresses`, `conf`, `revision`), отсортировано по
  `interface_name`, `label`, `peer_id`. Чужое устройство — `403 forbidden`.
- `POST /app/devices/{id}/tunnels` `{"interface_id":"uuid","label":"second"}`
  → `{device, config, configs}`; правила те же, что у админской ручки
  `POST /devices/{id}/tunnels`, доступ — только к своим устройствам
  (чужое — `403`). Без тарифа — `409 tariff_required`.
- `PATCH /app/devices/{id}/tunnels/{peer_id}` `{"label":"new"}` →
  `{device, config, configs}` (как у `POST /app/devices/{id}/tunnels`).
  Пир должен принадлежать этому устройству, иначе `404`; чужое устройство —
  `403`; `label` — 1..64 символа после `trim`, иначе `400`; revoked-устройство
  — `409`. После переименования группа публикуется на ноды, а `config` и
  `configs` содержат обновлённый `label`. `Idempotency-Key` не требуется:
  повтор с тем же `label` возвращает `200`.
- `DELETE /app/devices/{id}/tunnels/{peer_id}` → `204`; чужое устройство —
  `403`, последний пир — `409`.
- `PATCH /app/devices/{id}` `{"name":"New"}` → `DeviceView`; пустое имя или
  длиннее 64 символов — `400 bad_request`.
- `DELETE /app/devices/{id}` → `204`, устройство удаляется вместе со всеми
  пирами, группа публикуется на ноды.

### Идемпотентность создания устройства

`POST /app/devices` принимает необязательный заголовок `Idempotency-Key`
(имя заголовка регистронезависимо). Допустимый ключ — 8..128 символов из
`A-Z`, `a-z`, `0-9`, `-`, `_`, `.`; иначе `400 invalid_idempotency_key` и
устройство не создаётся. Ключ уникален в пределах пользователя и не
пересекается с общим механизмом из раздела «Идемпотентность» (общий
middleware этот маршрут не обрабатывает).

- Повтор с тем же ключом в течение 24 часов возвращает `200` и тело первого
  успешного ответа (`AppDeviceView`); новое устройство не создаётся. Другое
  тело запроса игнорируется — возвращается первый результат.
- Параллельный повтор, пока первый запрос ещё выполняется, получает `409
  idempotency_in_progress`; с другим телом — `409 idempotency_key_mismatch`.
  Это не даёт создать второе устройство при обрыве ответа.
- Ответы с ошибкой (`4xx`/`5xx`) не запоминаются: после исправления запроса
  тот же ключ создаёт устройство.
- Без заголовка поведение прежнее: каждый запрос создаёт новое устройство.
- Записи лежат в redb-таблице `idempotency` 24 часа и зашифрованы
  мастер-ключом (`Sealer`): тело ответа не читается из БД в открытом виде.
  Просроченная запись удаляется при чтении. На `PATCH`/`DELETE` заголовок не
  влияет.

`AppSubscriptionView` (`subscription` в bootstrap):

```json
{
  "id": "uuid",
  "plan_name": "Pro",
  "status": "active",
  "current_period_end": "2026-12-17T12:00:00Z",
  "auto_renew": true,
  "cancel_at_period_end": false,
  "grants_access": true
}
```

- `status` — `incomplete`, `trialing`, `active`, `past_due`, `suspended`,
  `canceled`; `grants_access` — `true` только для `trialing` и `active`.
- `plan_name` — имя плана текущей подписки (`""`, если план удалён).
- `subscription: null`, если биллинг выключен
  (`AWG_BILLING_ENABLED=false`) или у пользователя нет текущей подписки
  (текущая — последняя неаннулированная, как у `GET /billing/subscription`).
  Аннулированная (`canceled`) подписка текущей не считается и в
  `subscription` не попадает, но троттлинг по ней применяется — это видно в
  `access.reasons` (`subscription_inactive`).

`AppAccessView` (`access` в bootstrap):

```json
{
  "blocked": false,
  "throttled": true,
  "reasons": ["subscription_inactive"]
}
```

- `blocked` — `true`, когда у пользователя нет тарифа; создание устройств
  недоступно, существующие продолжают работать.
- `throttled` — `true`, когда исчерпана месячная квота или последняя
  подписка не даёт доступа (`grants_access=false`).
- `reasons` — подмножество `quota_exceeded`, `subscription_inactive`,
  `tariff_missing` в этом порядке; пустой массив при нормальном доступе.
  `quota_exceeded` — `quota.exceeded`, `subscription_inactive` — у
  пользователя есть подписка (последняя, включая `canceled`) и она не даёт
  доступа, `tariff_missing` — тариф не назначен.

`AppConfigView`:

```json
{
  "interface_id": "uuid",
  "interface_name": "awg0",
  "node_id": "uuid",
  "endpoint": "vpn.example.com:51820",
  "addresses": ["10.1.0.2/24"],
  "conf": "[Interface]...",
  "revision": "9f2c1d7ab03e4f56"
}
```

`revision` — первые 16 hex-символов SHA-256 от `conf`; одинаковый `conf` даёт
одинаковый `revision`, изменение endpoint/обфускации меняет его.

## Массовые действия

`POST /api/v1/{users|devices|interfaces|nodes|groups|tariffs}/bulk` выполняет
одно действие над списком объектов одним запросом вместо N последовательных
вызовов. Тело запроса одинаково для всех ресурсов:

```json
{ "action": "disable", "ids": ["11111111-1111-1111-1111-111111111111"] }
```

Ответ всегда `200`, даже если часть объектов не обработана:

```json
{
  "done": 1,
  "failed": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "error": "user not found"
    }
  ]
}
```

`done` — число успешно обработанных объектов, `failed` — ошибки по каждому
`id`. Обработка последовательная: ошибка одного объекта не прерывает
остальные, а `error` содержит текст ошибки одиночного запроса. Каждый `id`
обрабатывается тем же контроллером, что и одиночный запрос, поэтому права,
публикация в worker и проверки (например, запрет удаления самого себя)
сохраняются.

`400 Bad Request` возвращается, если `ids` пуст, содержит больше 500
элементов или `action` неизвестен для ресурса. Дубликаты в `ids`
схлопываются, порядок первого вхождения сохраняется.

| Ресурс | Actions | Права |
|---|---|---|
| `users` | `disable`, `enable`, `delete` | admin |
| `devices` | `revoke_shares`, `delete` | self/admin по каждому устройству |
| `interfaces` | `enable`, `disable`, `delete` | admin |
| `nodes` | `delete` | admin |
| `groups` | `delete` | admin |
| `tariffs` | `delete` | admin |

Пример: выключить двух пользователей.

```bash
curl -X POST https://panel.example.com/api/v1/users/bulk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"disable","ids":["11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222"]}'
```

```json
{"done":2,"failed":[]}
```

## Импорт конфигураций

Батч-импорт AmneziaWG-конфигураций доступен только роли `admin` и состоит из
двух шагов с одинаковым телом запроса:

- `POST /api/v1/import/preview` — проверяет и строит план, ничего не записывая в
  БД. Можно вызывать многократно.
- `POST /api/v1/import/apply` — заново строит план (ответу preview не доверяет) и
  создаёт группу, пулы, интерфейсы и устройства.

Устаревший `POST /api/v1/import` (`ImportRequest` с одним серверным конфигом)
продолжает работать и возвращает
`{group_id, interface_id, imported_devices, failed_devices}`.

`BatchImportRequest`:

```json
{
  "node_id": "…",
  "group_name": "Офис",
  "group_description": "Импорт из awg0",
  "base_cidr": "10.8.0.0/24",
  "owner_user_id": null,
  "interfaces": [
    {
      "server_config": "[Interface]\nPrivateKey = …\n…",
      "name": "awg0",
      "label": "Основной",
      "endpoint_host": "vpn.example.com",
      "endpoint_port": 51820,
      "listen_port": 51820,
      "mtu": 1420,
      "pools": [
        {"name": "default", "cidr": "10.8.0.0/24", "mode": "auto", "gateway": "10.8.0.1"}
      ],
      "clients": [{"name": "phone", "config": "[Interface]\nPrivateKey = …\n…"}]
    }
  ]
}
```

`owner_user_id` по умолчанию — текущий администратор; несуществующий
пользователь или узел дают `404 not_found`.

### Preview

```json
{
  "group": {"name": "Офис", "base_cidr": "10.8.0.0/24"},
  "interfaces": [
    {
      "index": 0,
      "name": "awg0",
      "public_key": "…",
      "clients": [
        {"name": "phone", "status": "create", "address": "10.8.0.2", "reason": null, "device_id": null, "changes": []},
        {"name": "phone", "status": "duplicate", "address": null, "reason": "client public key already imported in interface awg0", "device_id": null, "changes": []},
        {"name": "laptop", "status": "error", "address": null, "reason": "client config points at a different server public key", "device_id": null, "changes": []}
      ],
      "counts": {"create": 1, "unchanged": 0, "update": 0, "duplicate": 1, "error": 1},
      "server_peers": [
        {"public_key": "…", "status": "create", "address": "10.8.0.10", "reason": null},
        {"public_key": "…", "status": "duplicate", "address": null, "reason": "peer public key already exists"},
        {"public_key": "…", "status": "error", "address": null, "reason": "peer has no AllowedIPs"}
      ],
      "server_peer_counts": {"create": 1, "duplicate": 1, "error": 1}
    }
  ],
  "summary": {
    "create": 1, "unchanged": 0, "update": 0, "duplicate": 1, "error": 1,
    "interfaces": 1,
    "external": {"create": 1, "duplicate": 1, "error": 1}
  },
  "warnings": ["client phone in interface awg0 renamed to phone-2"]
}
```

Поля `counts`/`summary` описывают клиентские конфиги (`create`, `unchanged`,
`update`, `duplicate`, `error`). `unchanged` и `update` в батч-импорте всегда
`0`: там создаются только новые устройства. Для обратной совместимости старые
поля `create`, `duplicate`, `error`, `interfaces` сохранены, новые добавлены
рядом.

Статусы клиента:

- `create` — клиент будет создан; `address` — адрес из его конфига.
- `duplicate` — public key уже встречался в этом батче или в БД; повторная
  вставка не выполняется (`reason` указывает, где он найден).
- `error` — конфиг не разобран, `[Peer] PublicKey` не совпадает с public key
  серверного конфига интерфейса, нет `Address` в пулах интерфейса, адрес уже
  занят, имя пустое или длиннее 64 символов. Такие клиенты не прерывают
  preview/apply — они попадают в отчёт.
- `changes` — всегда массив; в батч-импорте пустой.
- `device_id` — всегда присутствует; в батч-импорте всегда `null`. В импорте
  клиентов заполнен для `unchanged`/`update` и после apply содержит id
  созданного или обновлённого устройства.

Правила валидации:

- серверный `PrivateKey` парсится, public key интерфейса выводится из него;
- в рамках батча имена интерфейсов уникальны и проходят
  `validate_interface_name` (1..15 символов `[A-Za-z0-9_-]`);
- имена пулов уникальны в рамках батча, каждый пул лежит внутри `base_cidr`,
  пулы не пересекаются между собой (в том числе между интерфейсами);
- порты не нулевые, `endpoint_host` непустой;
- дубли имён клиентов нормализуются суффиксом (`phone`, `phone-2`, …) с
  предупреждением в `warnings`; имена сравниваются без учёта регистра;
- интерфейс с именем, уже существующим на узле, даёт предупреждение в preview;
  apply в этом случае завершится ошибкой с откатом.

### Внешние пиры (external peers)

`[Peer]`-блоки серверного конфига (`server_config` каждого интерфейса)
разбираются в `PublicKey`, `PresharedKey` (опционально) и `AllowedIPs`. Пиры,
для которых в том же интерфейсе не передан клиентский конфиг с тем же public
key, попадают в массив `server_peers`:

```json
{
  "public_key": "…",
  "status": "create",
  "address": "10.8.0.10",
  "reason": null
}
```

Статусы внешнего пира:

- `create` — будет создано внешнее устройство; `address` — первый IPv4 из
  `AllowedIPs`, попадающий в пул интерфейса.
- `duplicate` — public key уже есть среди пиров БД или повторяется в этом
  батче/среди клиентских конфигов; ничего не создаётся.
- `error` — пустой `AllowedIPs`, ни один IPv4-адрес не попадает в пул
  интерфейса или адрес уже занят другим пиром/клиентом. Ошибка не фатальна.

`server_peer_counts` в интерфейсе и `summary.external` считают внешние пиры
отдельно от клиентов (поля `create`, `duplicate`, `error`).

При apply для `create` создаётся устройство с `external: true`:

- имя `external-<8 первых символов public key>`;
- `public_key` и `PresharedKey` берутся из серверного конфига, приватного ключа
  нет (`private_key_sealed` хранится пустой строкой);
- адрес — первый IPv4 из `AllowedIPs`, попавший в пул группы; в `ips` пира
  сохраняется соответствующая пара «пул → адрес»;
- профиль и share-ссылки для такого устройства недоступны: генерация профиля
  возвращает `409 conflict` с сообщением
  `external peer has no client profile: it was imported from the server configuration`;
- владелец — `owner_user_id` (по умолчанию текущий администратор);
- в дедупликации участвуют все пиры БД: `duplicate` и `error` ничего не
  создают.

В ответе apply для каждого интерфейса `created.device_ids` содержит все
созданные устройства, а `created.external_device_ids` — только внешние пиры.

### Apply

Ответ — тот же `ImportPreviewView` плюс блок `created`:

```json
{
  "group": {"name": "Офис", "base_cidr": "10.8.0.0/24"},
  "interfaces": [ … ],
  "summary": {
    "create": 1, "unchanged": 0, "update": 0, "duplicate": 1, "error": 1,
    "interfaces": 1,
    "external": {"create": 1, "duplicate": 0, "error": 0}
  },
  "warnings": [],
  "created": {
    "group_id": "…",
    "interfaces": [
      {
        "id": "…",
        "name": "awg0",
        "device_ids": ["…", "…"],
        "external_device_ids": ["…"]
      }
    ]
  }
}
```

- План пересчитывается заново: изменившиеся с момента preview данные
  учитываются, статусы в ответе отражают фактический результат.
- Ошибки отдельных клиентов не фатальны: устройство не создаётся, клиент
  получает `status: "error"` и причину, остальные создаются.
- Фатальны ошибки уровня группы, пула, интерфейса и ошибки хранилища: все
  созданные в этом запросе сущности удаляются в обратном порядке (устройства и
  их пиры, интерфейсы, затем группа вместе с пулами), ответ — `409 conflict` с
  сообщением `import failed: …; all created entities were rolled back`. Если
  откат частично не удался, это перечисляется в сообщении.
- Ошибки валидации запроса возвращаются до записи как `400 bad_request`;
  нехватка прав — `403 forbidden`; отсутствующий узел/владелец — `404`.
- После успешного apply desired state узла публикуется воркеру.

## Импорт клиентов в существующий интерфейс

Дополнительный импорт клиентских AmneziaWG-конфигов в уже существующие группы и
интерфейсы. Батч-импорт новых групп (`/import/preview|apply`) продолжает
работать как описано выше; внешние пиры серверных конфигов импортируются только
им. Доступен только роли `admin`.

- `POST /api/v1/import/clients/preview` — строит план и ничего не записывает.
- `POST /api/v1/import/clients/apply` — заново строит план и создаёт устройства.

`ClientsImportRequest`:

```json
{
  "interface_id": null,
  "owner_user_id": null,
  "clients": [
    {"name": "phone", "config": "[Interface]\nPrivateKey = …\n…"}
  ]
}
```

- `interface_id` — целевой интерфейс. `null` включает автоопределение по
  public key сервера из клиентского конфига.
- `owner_user_id` — владелец создаваемых устройств; по умолчанию текущий
  администратор. Несуществующий пользователь даёт `404 not_found`.
- `clients` — список клиентских конфигов; пустой список — `400 bad_request`.

### Автоопределение интерфейса

Для каждого клиента берётся `[Peer] PublicKey` (публичный ключ сервера) и
сравнивается с `public_key` всех интерфейсов:

- ровно одно совпадение — клиент относится к этому интерфейсу;
- нет совпадений — клиент получает `status: "error"` и причину
  `no interface with this public key was found`;
- несколько совпадений (аномалия данных) — клиент получает `status: "error"` и
  причину `ambiguous public key`.

Если задан `interface_id`, автоопределение не выполняется: все клиенты
проверяются против этого интерфейса, а несовпадение серверного ключа даёт
`error` с причиной `client config points at a different server public key`.
Отсутствующий `interface_id` (несуществующий UUID) — `404 not_found`, устройства
не создаются.

Клиенты без найденного интерфейса (нет совпадений или неоднозначный ключ)
попадают в конец `interfaces` отдельной записью с `id`, `group_id`, `node_id`
равными нулевому UUID, пустыми `name`/`group_name` и public key из конфига
клиента в `public_key`. Это позволяет показать причину по каждому клиенту в
общем формате ответа.

### Preview

```json
{
  "interfaces": [
    {
      "id": "…",
      "name": "awg0",
      "group_id": "…",
      "group_name": "Офис",
      "node_id": "…",
      "public_key": "…",
      "clients": [
        {"name": "phone", "status": "create", "address": "10.8.0.2", "reason": null, "device_id": null, "changes": []},
        {
          "name": "laptop",
          "status": "unchanged",
          "address": "10.8.0.3",
          "reason": null,
          "device_id": "…",
          "changes": []
        },
        {
          "name": "tablet",
          "status": "update",
          "address": "10.8.0.7",
          "reason": null,
          "device_id": "…",
          "changes": [
            {"field": "address", "from": "10.8.0.5", "to": "10.8.0.7"},
            {"field": "preshared_key", "from": "old", "to": "new"},
            {"field": "name", "from": "tablet-old", "to": "tablet"}
          ]
        },
        {"name": "watch", "status": "duplicate", "address": null, "reason": "address 10.8.0.9 is already in use", "device_id": null, "changes": []},
        {"name": "tv", "status": "error", "address": null, "reason": "client public key is attached to another interface: awg1", "device_id": null, "changes": []}
      ],
      "counts": {"create": 1, "unchanged": 1, "update": 1, "duplicate": 1, "error": 1}
    }
  ],
  "summary": {
    "create": 1, "unchanged": 1, "update": 1, "duplicate": 1, "error": 1,
    "interfaces": 1,
    "external": {"create": 0, "duplicate": 0, "error": 0}
  },
  "warnings": []
}
```

Для обратной совместимости сохранены прежние поля `name`, `status`,
`address`, `reason`, `counts.create`, `counts.duplicate`, `counts.error`,
`summary.interfaces`; новые поля добавлены рядом. В импорте клиентов
`summary.external` нулевой: внешние пиры импортируются только батч-импортом
серверных конфигов.

Статусы клиента:

- `create` — устройство будет создано; `address` — первый адрес из конфига,
  попавший в пул группы интерфейса.
- `unchanged` — public key уже есть у пира этого интерфейса и адрес, psk и имя
  совпадают; ничего не меняется, `changes` пуст, `device_id` содержит id
  существующего устройства.
- `update` — public key уже есть у пира этого интерфейса, но отличаются адрес,
  psk или имя. `changes` содержит список изменений
  `{field: "address"|"preshared_key"|"name", from, to}`; `from`/`to` — строки
  (не `null`), адреса при нескольких пулах перечислены через запятую;
  `device_id` содержит id обновляемого устройства.
- `duplicate` — изменить нельзя: новый адрес занят другим пиром/клиентом,
  несколько пиров делят этот public key, public key повторяется в этом запросе.
  `reason` уточняет причину.
- `error` — конфиг не разобран, серверный ключ не совпадает с интерфейсом,
  интерфейс не найден или неоднозначен, нет `Address` в пулах группы, имя пустое
  или длиннее 64 символов, public key уже привязан к другому интерфейсу
  (`reason` содержит имя этого интерфейса).

Правила валидации:

- public key сервера выводится из `PrivateKey` интерфейса; клиент должен
  содержать тот же `[Peer] PublicKey`;
- `Address` должен лежать в одном из включённых пулов группы интерфейса и не
  пересекаться с адресами существующих пиров и клиентов этого же запроса; для
  `update` собственные текущие адреса пира конфликтом не считаются;
- дубли имён клиентов нормализуются суффиксом (`phone`, `phone-2`, …) и
  попадают в `warnings`; имена сравниваются без учёта регистра; изменение имени
  существующего пира выполняется только через `update`;
- preview не пишет в БД и не меняет интерфейсы, пулы и устройства.

### Apply

Ответ — тот же `ClientsImportPreviewView` плюс блок `created`:

```json
{
  "interfaces": [ … ],
  "summary": {"create": 1, "unchanged": 0, "update": 1, "duplicate": 0, "error": 0, "interfaces": 1, "external": {"create": 0, "duplicate": 0, "error": 0}},
  "warnings": [],
  "created": {
    "interfaces": [
      {"id": "…", "device_ids": ["…"], "updated_device_ids": ["…"]}
    ]
  }
}
```

- План пересчитывается заново; статусы отражают фактический результат.
- `create` создаёт устройство тем же путём, что и в батч-импорте
  (`devices.import_device`): `group_id` интерфейса, `interface_id`, указанный
  или текущий администратор в качестве владельца.
- `update` применяет изменения к существующему устройству и пиру: адрес
  (`ips` пира), psk, имя. Владелец и лимиты устройства не меняются; id
  устройства попадает в `created.interfaces[].updated_device_ids`.
- `unchanged`, `duplicate`, `error` ничего не меняют.
- Если ранее импортированное внешнее устройство (`external: true`) совпало с
  клиентским конфигом, оно получает статус `update` (даже при пустом
  `changes`), приватный ключ из конфига и перестаёт быть внешним.
- Ошибки отдельных клиентов не фатальны: остальные устройства создаются или
  обновляются, клиент получает `status: "error"` и причину.
- Фатальны ошибки хранилища и исчезнувшие во время применения группа/интерфейс.
  В этом случае созданные в этом запросе устройства удаляются (best-effort
  rollback, включая устройства без сохранённого пира), ответ — `4xx/5xx`.
  Уже применённые обновления существующих устройств не откатываются.
  Если откат частично не удался, это перечисляется в сообщении.
- После успешного apply desired state затронутых узлов публикуется воркерам.

## Аутентификация

Схема — `Authorization: Bearer <access JWT>` для всех закрытых маршрутов.
Access- и refresh-токены подписаны HS256 и содержат `sub`, `role`, `iss`,
`aud`, `exp`, `nbf`, `iat`, `jti`, `kind` (`access`/`refresh`). При проверке
контролируются подпись, `exp`, `nbf`, `iss`, `aud` и `kind`; допуск на
расхождение часов — 30 секунд. Значения `iss`/`aud` задаются
`AWG_JWT_ISSUER`/`AWG_JWT_AUDIENCE` (по умолчанию `awg-admin`).

`AuthView`:

```json
{
  "token": "<access>",
  "refresh_token": "<refresh>",
  "expires_in": 900,
  "user": {"id": "…", "email": "admin@local", "login": "admin", "role": "admin", "…": "…"}
}
```

- `POST /auth/login` — `{"login":"…","password":"…"}`; в поле `login`
  передаётся email (UI отправляет email); для обратной совместимости поиск
  идёт сначала по email, затем по legacy-логину. Неверные данные и
  заблокированный пользователь дают `403 forbidden`.
- `POST /auth/refresh` — `{"refresh_token":"…"}`. Refresh одноразовый: успешный
  вызов помечает старую запись использованной и выдаёт новую пару в той же
  family. Повторное предъявление использованного или отозванного refresh —
  признак компрометации: вся family отзывается, ответ `403 forbidden` с
  сообщением `refresh token reuse detected; the session family was revoked`.
  Последующий refresh из этой family также вернёт `403`.
- `POST /auth/logout` — отзывает один refresh; access остаётся валидным до
  истечения TTL.
- `POST /auth/logout-all` — отзывает все refresh-сессии пользователя,
  возвращает `{"ok":true,"revoked":N}`.
- `POST /auth/password` требует `current_password` (`{current_password,
  new_password, totp_code?}`); при включённом TOTP вместо пароля можно передать
  действующий `totp_code`. `DELETE /users/{id}` дополнительно удаляет устройства,
  пиры и share-ссылки пользователя.
- `POST /auth/password`, `POST /auth/reset-password`, `PATCH /users/{id}` с
  `disabled=true`, `POST /users/{id}/password` и `DELETE /users/{id}` отзывают
  все refresh-сессии затронутого пользователя.

`GET /auth/sessions` возвращает неистёкшие refresh-сессии текущего
пользователя (без самих токенов, новые сверху):

```json
[
  {
    "jti": "…",
    "family_id": "…",
    "created_at": "2026-01-02T03:04:05Z",
    "expires_at": "2026-02-01T03:04:05Z",
    "revoked": false,
    "used": false,
    "user_agent": "Mozilla/5.0 …",
    "ip": "203.0.113.7"
  }
]
```

`DELETE /auth/sessions/{jti}` отзывает свою сессию; чужая или несуществующая
сессия даёт `404 not_found` (без раскрытия существования). Access-токены
stateless: после logout/logout-all ранее выданный access действует до `exp`
(не дольше `AWG_ACCESS_TTL_SECS`, по умолчанию 900 секунд). Каждый запрос
дополнительно проверяет, что пользователь существует и не заблокирован, поэтому
блокировка и удаление действуют немедленно.

Ошибки аутентификации: `401 unauthorized` — нет/некорректный Bearer-заголовок;
`403 forbidden` — неверная подпись, `exp`/`nbf`/`iss`/`aud`/`kind`, отозванный
refresh, повтор refresh, заблокированный или удалённый пользователь.

## Регистрация, подтверждение email и TOTP

Самостоятельная регистрация создаёт пользователя в статусе `pending_email` с
ролью `user`. Письмо со ссылкой
`{AWG_PUBLIC_URL}/verify-email?token=…` отправляется через `Mailer`
(`AWG_MAIL_MODE=log|smtp`); в письмо также добавляется deep link приложения
`{AWG_APP_VERIFY_URL}?token=…` (по умолчанию `umbravpn://verify?token=…`).
Токен живёт 24 часа и одноразовый. После перехода по
ссылке статус становится `pending_approval`, затем администратор подтверждает
аккаунт и назначает тариф:

1. `POST /auth/register` `{"email":"user@example.com","login":"optional","password":"…"}`
   → `202 {"status":"pending_email"}`. Email нормализуется (trim + нижний
   регистр), уникален без учёта регистра. `login` по умолчанию — local-part
   email, при коллизии добавляется суффикс (`user-2`). Явно заданный занятый
   `login` или существующий email дают `409 conflict`.
2. `POST /auth/verify-email` `{"token":"…"}` →
   `{"status":"pending_approval"}`. Повторный вызов — `400 bad_request`.
3. `GET /users/pending` (admin) → `UserView[]` со статусом `pending_approval`.
4. `POST /users/{id}/approve` `{"tariff_id":"…","node_id":"…"}` (admin) →
   `UserView` со статусом `active`; `group_id` в запросе устарел, но
   принимается для совместимости.
5. `POST /users/{id}/reject` (admin) → `UserView` со статусом `rejected`.

`POST /auth/resend-verification` `{"email":"…"}` всегда отвечает
`202 {"status":"sent"}` и не раскрывает существование аккаунта. `register` и
`resend-verification` ограничены по IP (`AWG_REGISTER_RATE_LIMIT`,
`AWG_RESEND_RATE_LIMIT`).

Вход `POST /auth/login` принимает в поле `login` email или логин (email
проверяется первым). Незавершённые статусы дают `403` с кодом
`email_not_verified`, `pending_approval` или `rejected`; отключённый
администратором аккаунт (`disabled`) — `403 account_disabled`
(`account is disabled`). Пользователи, созданные администратором, сразу
`active`.

`UserView` дополнен полями `email`, `status` (`pending_email`,
`pending_approval`, `active`, `rejected`), `totp_enabled` и `node_id` (нода
пользователя; `group_id` — устаревшее поле). `email` — строка, всегда
заполнена.

### Seed-администратор и миграция email

Seed-администратор создаётся при первом запуске с email из `AWG_ADMIN_EMAIL`
(по умолчанию `admin@local`) и legacy-логином из `AWG_ADMIN_LOGIN`. Если email
администратора в базе отличается от `AWG_ADMIN_EMAIL`, при старте он
обновляется. `AWG_ADMIN_LOGIN` остаётся только для поиска существующей учётной
записи и обратной совместимости; вход выполняется по email (fallback — логин).

Миграция схемы `5 → 6`: пользователям без email проставляется `<login>@local`
(логин приводится к нижнему регистру, недопустимые символы заменяются на `-`);
при коллизии добавляется `+id` (`admin+<uuid>@local`). Существующие email не
меняются. После миграции email можно менять через `PATCH /users/{id}`.

TOTP (RFC 6238, SHA-1, 6 цифр, шаг 30 секунд, допуск ±1):

- `POST /auth/totp/setup` → `{secret, otpauth_url, recovery_codes}`. Секрет
  хранится только в зашифрованном виде (`Sealer`), возвращаются 8 одноразовых
  recovery-кодов (в хранилище — Argon2-хэши), `totp_enabled` пока `false`.
  Если TOTP уже включён, запрос обязан содержать `password` и действующий
  `code`; новый секрет сохраняется как pending, старый продолжает работать,
  пока его не подтвердят через `/auth/totp/enable` — повторная привязка не
  отключает 2FA.
- `POST /auth/totp/enable` `{"code":"123456"}` → `{"enabled":true}`;
  подтверждает первый или pending-секрет.
- `POST /auth/totp/disable` `{"password":"…","code":"…"}` →
  `{"enabled":false}`, секрет, pending-секрет и recovery-коды удаляются. Один и
  тот же TOTP-шаг нельзя использовать повторно (replay отклоняется как
  `totp_invalid`).

При включённом TOTP вход без кода возвращает `401 totp_required`, с неверным
кодом — `401 totp_invalid`. В поле `totp_code` принимается код приложения или
одноразовый recovery-код. Ошибки статусов и коды TOTP отдаются в формате
`{"error":{"code":"…","message":"…"}}`.

## Сброс пароля

Восстановление пароля использует те же одноразовые токены, что и подтверждение
email (таблица `email_verifications`, ключ — SHA-256 от токена), с полем
`kind` = `reset_password`; записи без `kind` считаются токенами подтверждения
email.

1. `POST /auth/forgot-password` `{"email":"user@example.com"}` всегда отвечает
   `202 {"status":"sent"}` и не раскрывает, существует ли аккаунт. Для активного
   пользователя с таким email создаётся токен на **1 час** и отправляется письмо
   со ссылкой `{AWG_PUBLIC_URL}/reset-password?token=…`; для неизвестного,
   неподтверждённого, отклонённого или заблокированного пользователя письмо не
   отправляется. Запрос ограничен по паре IP + email (`AWG_FORGOT_RATE_LIMIT`,
   по умолчанию 5, и `AWG_FORGOT_RATE_WINDOW_SECS`, по умолчанию 300); при
   превышении — `429 too_many_requests` с `Retry-After`.
2. `POST /auth/reset-password` `{"token":"…","password":"…"}` → `200
   {"status":"reset"}`. Пароль проверяется по общим правилам (8–256 символов).
   Неизвестный, уже использованный, просроченный токен или токен другого типа
   дают `400 invalid_token`; слабый пароль — `400 bad_request` с текстом
   валидации. Успешный сброс меняет хэш пароля, помечает токен использованным и
   отзывает **все** refresh-сессии пользователя; ранее выданные access-токены
   действуют до `exp` (не дольше `AWG_ACCESS_TTL_SECS`).

Токены подтверждения email нельзя использовать для сброса пароля, а токены
сброса — для подтверждения email.

## Квота трафика

Квота месячная. Учитывается сумма `rx + tx` пользователя за текущий
календарный месяц UTC: `period_start` — первое число месяца `00:00:00`,
`period_end` — последняя секунда месяца (`23:59:59`), `reset_at` — момент
сброса квоты, `period_end + 1 секунда`, то есть `00:00:00` первого числа
следующего месяца. Все значения — ISO8601/RFC3339 в UTC.

`GET /api/v1/quota` доступен ролям `user` и `admin` и всегда возвращает квоту
текущего пользователя; параметры с чужим идентификатором не принимаются.
Ответ `QuotaView`:

```json
{
  "used_bytes": 52428800,
  "quota_bytes": 107374182400,
  "exceeded": false,
  "remaining_bytes": 107321753600,
  "percent": 4.9,
  "period_start": "2026-11-01T00:00:00Z",
  "period_end": "2026-11-30T23:59:59Z",
  "reset_at": "2026-12-01T00:00:00Z"
}
```

- `used_bytes` — сумма `rx + tx` за текущий период.
- `quota_bytes` — лимит тарифа (`traffic_quota_bytes`); `null`, если у
  пользователя нет тарифа или в тарифе квота не задана либо равна `0`.
- `percent` — `used_bytes / quota_bytes * 100` с округлением до 0.1. Может
  превышать `100` при перерасходе; `null` без квоты.
- `remaining_bytes` — `max(quota_bytes - used_bytes, 0)`; `null` без квоты.
- `exceeded` — `used_bytes >= quota_bytes`; без квоты всегда `false`. При
  превышении snapshot ограничивает группу и устройства пользователя
  скоростью 1 kbps (см. «Троттлинг доступа»).

`GET /api/v1/quota/users` доступен только роли `admin` (иначе
`403 forbidden`) и возвращает массив по пользователям, у которых задан
тариф. Ответ `QuotaUserView[]`:

```json
[
  {
    "user_id": "…",
    "login": "alice",
    "used_bytes": 52428800,
    "quota_bytes": 107374182400,
    "exceeded": false,
    "percent": 4.9
  }
]
```

Пользователь с тарифом без квоты попадает в список с `quota_bytes:null` и
`percent:null`. Пользователи без тарифа не возвращаются.

### Троттлинг доступа

`SnapshotBuilder` ограничивает скорость пользователя в желаемом состоянии
ноды (`DesiredState`) в двух случаях:

- исчерпана месячная квота тарифа (`used_bytes >= traffic_quota_bytes`);
- у пользователя есть подписка (биллинг включён) и её текущий статус не даёт
  доступа (`incomplete`, `past_due`, `suspended`, `canceled`).

В обоих случаях групповые лимиты пользователя (`user_limits`) и скорости его
пиров (down/up) становятся `1 kbps`; при активной подписке и неисчерпанной
квоте применяются обычные лимиты тарифа и устройства. Без подписки и без
биллинга поведение прежнее — ограничивает только квота. Подписки читаются
одним запросом на build и кэшируются по `user_id`, поэтому число обращений к
репозиторию не зависит от количества пиров.

## Агрегация статистики

`GET /api/v1/stats/aggregate` отдаёт трафик, сгруппированный по суткам или
месяцам UTC. Доступны роли `user` и `admin`; scope проверяется так же, как у
`/stats/series`: admin может запросить любой scope, user — только
`scope=user&id=<свой id>` и `scope=device&id=<своё устройство>`.

Query-параметры:

| Параметр | Тип | Семантика |
|---|---|---|
| `scope` | строка | `global`, `user`, `group`, `interface`, `device` |
| `id` | UUID | обязателен для всех scope, кроме `global` |
| `bucket` | строка | `day` (по умолчанию) или `month` |
| `from` | целое | Unix-секунды, начало окна включительно; по умолчанию `to - 30 дней` для `day` и `to - 365 дней` для `month` |
| `to` | целое | Unix-секунды, конец окна включительно; по умолчанию текущий момент |

Валидация: `from <= to`, `bucket` только `day`/`month`, окно не больше
366 дней для `day` и 3660 дней (10 лет) для `month`. Нарушение — `400
bad_request`; неизвестный scope — `400 bad_request`, недоступный scope —
`403 forbidden`.

Ответ:

```json
{
  "bucket": "day",
  "points": [
    {"at": "2026-03-01T00:00:00Z", "rx": 1024, "tx": 2048},
    {"at": "2026-03-02T00:00:00Z", "rx": 512, "tx": 256}
  ]
}
```

`GET /api/v1/stats/overview` дополнительно отдаёт `rx_bps`/`tx_bps` — текущую
скорость по последним снимкам воркера; при отсутствии данных `0.0`.
`GET /api/v1/stats/series` возвращает точки
`{at, rx, tx, rx_bps, tx_bps}`, где `*_bps` — средняя скорость за часовой бакет
(дельта между соседними бакетами на фактическую разницу секунд).

- `points` отсортированы по возрастанию `at`; пустые интервалы не возвращаются.

- `at` — начало суток (`00:00:00Z`) для `bucket=day` или первое число месяца
  (`00:00:00Z`) для `bucket=month`.
- Агрегация считается на лету из часовых бакетов, поэтому в сумму попадают
  часы, пересекающиеся с окном, целиком. Материализованных дневных и месячных
  таблиц нет; глубина данных ограничена `stats_retention_days`.

## Настройки

`GET /api/v1/settings` и `PUT /api/v1/settings` доступны только роли `admin`.
`UpdateSettingsRequest` принимает необязательные поля `obfuscation`,
`share_default_ttl_secs`, `stats_retention_days`. Ответ:

```json
{
  "obfuscation": {"…": "…"},
  "share_default_ttl_secs": 86400,
  "stats_retention_days": 90
}
```

- `share_default_ttl_secs` приводится к `60..2592000`.
- `stats_retention_days` — срок хранения часовых бакетов статистики в днях,
  по умолчанию `90`, приводится к `7..3650`. Значение применяется фоновой
  очисткой раз в час без перезапуска admin.

## WebSocket `/api/v1/ws/stats`

Подключение: `GET /api/v1/ws/stats?token=...&scope=...&id=...`.

- `token` — JWT access token.
- `scope`: `global` (по умолчанию), `user`, `group`, `interface`, `device`.
- `id` — UUID для user/group/interface/device.

Сообщения сервер→клиент:
```json
{"type":"hello","scope":"...","today":{"rx":0,"tx":0},"month":{"rx":0,"tx":0}}
```
```json
{"type":"traffic","at":"...","items":[{"device_id":"...","user_id":"...","group_id":"...","interface_id":"...","rx":0,"tx":0}]}
```
```json
{"type":"ping","at":"..."}
```

## Share-ссылки

- `POST /devices/{id}/shares` создаёт токен с TTL. Тело:
  `{interface_id, format: "conf"|"vpn", ttl_secs?, max_uses?, one_time?}`.
  `one_time=true` эквивалентно `max_uses=1`; `one_time` и `max_uses` вместе —
  `400`. `max_uses` — `1..=1000`, без лимита — не передавать.
- `GET /api/v1/share/{token}` отдаёт конфиг без JWT. Проверки: TTL, отзыв,
  остаток использований. Каждое успешное скачивание атомарно увеличивает
  `uses`; исчерпанная или отозванная ссылка — `403`.
- `GET /devices/{id}/shares` возвращает все ссылки устройства с полями
  `max_uses`, `uses`, `remaining_uses`, `revoked_at` и `state`
  (`active`|`expired`|`exhausted`|`revoked`), новые сначала.
- `DELETE /devices/{id}/shares` отзывает все активные ссылки устройства
  (`revoked_at`), возвращает `{revoked:N}`.
- `DELETE /api/v1/shares/{token}` отзывает одну ссылку: доступно владельцу
  устройства, создателю ссылки или admin; неизвестный токен — `404`, чужая
  ссылка — `403`. Запись не удаляется, выставляется `revoked_at` (история), а
  `GET /share/{token}` после отзыва отвечает `403`. Истёкшие и отозванные старше
  30 дней ссылки удаляются фоновой очисткой.

## Метрики нод

`GET /api/v1/nodes` и `POST /api/v1/nodes/{id}/rotate` (admin) отдают
`NodeView` с полями метрик воркера: `cpu_load`, `mem_used_bytes`,
`mem_total_bytes`, `kernel_version`, `worker_version`, `uptime_secs`,
`metrics_at`, а также `token_issued_at`. Метрики приходят в gRPC heartbeat и
обновляются раз в 20 секунд; старые воркеры их не присылают, поля остаются
`null`.

`POST /api/v1/nodes/{id}/rotate` выпускает новый токен, старый перестаёт
работать сразу. Ответ `{"node": NodeView, "token": "…"}` — токен показывается
один раз.

## Аудит

`GET /api/v1/audit` доступен только роли `admin`. Записи возвращаются в обратном
хронологическом порядке (сначала новые). Ответ: `{"items":[...],"next_cursor":"..."}`.

Query-параметры (все необязательные, комбинируются через AND):

| Параметр | Тип | Семантика |
|---|---|---|
| `limit` | целое | размер страницы, приводится к `1..500`; `0` или отсутствие — `100` |
| `before` | строка | курсор `next_cursor` предыдущей страницы в формате `<микросекунды>:<uuid>`; отдаются записи строго старше него |
| `action` | строка | точное совпадение, например `POST`, `PATCH`, `PUT`, `DELETE` |
| `entity` | строка | точное совпадение, например `devices`, `auth/login` |
| `actor` | строка | регистронезависимое вхождение в `actor_login` |
| `status` | целое | точный HTTP-код, например `200` |
| `from` | целое | Unix-секунды, `at >= from` (включительно) |
| `to` | целое | Unix-секунды, `at <= to` (включительно) |

`from > to` — `400 invalid_filter`. Пустые значения строковых фильтров
игнорируются. `status`, `from`, `to` должны быть целыми, иначе `400 bad_request`.

`next_cursor` — курсор последней отданной записи; `null`, если в выборке
(с учётом фильтров) больше нет записей. Курсор и фильтры можно менять между
страницами, пагинация идёт по ключам в сторону старых записей.

Примеры:

```
GET /api/v1/audit?limit=50
GET /api/v1/audit?action=DELETE&entity=devices
GET /api/v1/audit?actor=adm&status=200&from=1767225600&to=1767312000
GET /api/v1/audit?entity=users&limit=20&before=00010767000645000000:4f1f4f7a-1f0a-4c1a-9c4d-8b2a0d5b1c11
```

```json
{"error":{"code":"invalid_filter","message":"audit filter: from must not exceed to"}}
```

`limit` приводится к диапазону 1..500, `before` валидируется (неверный формат —
`400 bad_request`). Retention: записи старше
`AWG_AUDIT_RETENTION_DAYS` (по умолчанию 90; 0 — не чистить) удаляются
фоновой задачей раз в сутки.

`DELETE /api/v1/audit` принимает те же фильтры, что и `GET`, и удаляет
совпадающие записи в одной транзакции. Ответ — `{"deleted": N}`. Пустой фильтр
удаляет весь журнал, поэтому UI требует хотя бы один активный фильтр. Сам
запрос очистки фиксируется middleware как обычный `DELETE` после ответа.

```bash
DELETE /api/v1/audit?entity=devices&status=404
DELETE /api/v1/audit?actor=admin&from=1767225600&to=1767312000
```

Автоматически фиксируются успешные (2xx) mutating-запросы `POST`, `PATCH`,
`PUT`, `DELETE` под `/api/v1`: actor определяется по Bearer-токену (без токена —
`anonymous`), `entity` — путь без идентификатора, `entity_id` — первый UUID или
share-токен из пути, `ip` — клиентский адрес: при доверенном peer (`AWG_TRUSTED_PROXIES`) первый справа недоверенный хоп `X-Forwarded-For`/`X-Real-IP`, иначе адрес peer.

```json
{
  "id": "…",
  "at": "2026-01-02T03:04:05Z",
  "actor_id": "…",
  "actor_login": "admin",
  "action": "PATCH",
  "entity": "devices",
  "entity_id": "…",
  "status": 200,
  "ip": "203.0.113.7",
  "details": "PATCH /api/v1/devices/…"
}
```

Вход в систему пишется отдельно: успешный и неуспешный `POST /auth/login`
(включая `429`), с логином из тела запроса.

## Rate limiting

Скользящее окно в памяти процесса, без внешних зависимостей:

- `POST /auth/login` — ключ `IP + login` (логин нормализуется), по умолчанию
  10 попыток за 300 секунд;
- `POST /auth/refresh` — ключ `IP`, по умолчанию 60 попыток за 300 секунд.

Настройки: `AWG_LOGIN_RATE_LIMIT`, `AWG_LOGIN_RATE_WINDOW_SECS`,
`AWG_REFRESH_RATE_LIMIT`, `AWG_REFRESH_RATE_WINDOW_SECS`. `0` в лимите
отключает ограничение. Успешный логин сбрасывает счётчик для пары IP+login.
При превышении — `429 too_many_requests` и `Retry-After`.

## Биллинг (этап 2: checkout и webhook)

Архитектура: `docs/PAYMENTS.md` и `docs/adr/0001-payments-architecture.md`.
Доступны каталог планов, чтение подписок/счетов, checkout и идемпотентный
webhook. Автосписания, dunning и UI биллинга — не реализованы.

Главный флаг — `AWG_BILLING_ENABLED` (по умолчанию `false`). При выключенном
биллинге все маршруты `/billing/*` отвечают `404` с кодом
`billing_disabled`.

### Планы

`GET /api/v1/billing/plans` — все планы, включая неактивные (`admin`).
`POST /api/v1/billing/plans` и `PATCH /api/v1/billing/plans/{id}` — создание и
редактирование (`admin`).

`CreatePlanRequest`:

```json
{
  "name": "Pro",
  "description": "Профессиональный тариф",
  "price_cents": 99000,
  "currency": "RUB",
  "period": "month",
  "tariff_id": "…",
  "active": true
}
```

`UpdatePlanRequest` — те же поля, все необязательные. `period` — `month` или
`year`. Валидация: `name` не пустой и не длиннее 120 символов,
`price_cents >= 0`, `currency` — три латинские буквы и совпадает с
`AWG_BILLING_CURRENCY`, `tariff_id` существует. Ошибки — `400 bad_request`.

### Подписка и счета

`GET /api/v1/billing/subscription` — текущая (не `canceled`) подписка
пользователя или `null`. Поле `status`: `trialing`, `active`, `past_due`,
`suspended`, `canceled`.

`GET /api/v1/billing/invoices` — счета пользователя, новые сначала (по
`period_start`, затем `id`). Параметр `limit` — от 1 до 200, по умолчанию 50.
`admin` без `user_id` видит все счета, с `user_id` — счета выбранного
пользователя. Пользователь с чужим `user_id` получает `403 forbidden`.

`GET /api/v1/billing/admin/subscriptions` — список подписок (`admin`) с
фильтром `status` и пагинацией `page` (с 1) и `per_page` (1..200, по умолчанию
50). Ответ:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "per_page": 50
}
```

Статусы подписок дополнительно включают `incomplete` (checkout создан, но не
оплачен; доступа не даёт). Статусы счетов: `draft`, `open`, `paid`, `void`,
`uncollectible`.

### Checkout

`POST /api/v1/billing/checkout` с телом `{"plan_id": "…"}`.

- Создаёт подписку `incomplete` (если её ещё нет) и ровно один открытый счёт на
  период. Повторный вызов возвращает тот же счёт и тот же `checkout_url`, пока
  счёт открыт и период не истёк.
- Ответ: `{"invoice": Invoice, "checkout_url": "…"}`.
- `409 conflict`: план неактивен, у пользователя уже есть подписка на другой
  план или действующая подписка.
- Успешный checkout строит `success_url`/`cancel_url` из `AWG_PUBLIC_URL`.

### Webhook

`POST /api/v1/billing/webhook/{provider}` — публичный маршрут без JWT.
Провайдер должен совпадать с `AWG_PAYMENT_PROVIDER` (`404` иначе).

- Подпись проверяется шлюзом; неверная подпись или timestamp вне окна — `400`.
- Дедупликация по `event_id`: повторный webhook возвращает
  `{"status":"duplicate"}` и не меняет состояние.
- `payment.succeeded` проверяет `invoice_id`, сумму и валюту, помечает счёт
  `paid` и активирует подписку; `payment.failed` увеличивает `attempts`.
- Ответы: `{"status":"processed"|"duplicate"|"ignored","event_id":"…"}`.

### Mock-шлюз (только вне production)

`AWG_PAYMENT_PROVIDER=mock` + `AWG_PAYMENT_SECRET` (>= 32 символов).
Checkout возвращает `AWG_PUBLIC_URL/pay/mock/{invoice_id}` (страница оплаты не
реализована — оплата эмулируется webhook'ом). Подпись:
`hex(HMAC-SHA256(secret, "{timestamp}.{body}"))` в заголовках
`X-Mock-Timestamp` и `X-Mock-Signature`, окно 300 секунд.

```bash
BODY='{"event_id":"evt-1","kind":"payment.succeeded","invoice_id":"…","amount_cents":99000,"currency":"RUB"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$AWG_PAYMENT_SECRET" -binary | od -An -tx1 | tr -d ' \n')
curl -X POST "$BASE/billing/webhook/mock" -H "X-Mock-Timestamp: $TS" \
  -H "X-Mock-Signature: $SIG" -H 'content-type: application/json' -d "$BODY"
```

### Способ оплаты

`GET /api/v1/billing/payment-methods` — сохранённые шлюзом методы пользователя:
`{id, gateway, brand, last4, masked, is_default, created_at}`. Данные карт не
хранятся, только ссылка шлюза и маска.
