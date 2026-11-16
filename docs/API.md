# HTTP API

Базовый путь: `/api/v1`. Формат ошибок:

```json
{"error":{"code":"not_found","message":"..."}}
```

Коды: `bad_request`, `invalid_filter`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_many_requests`, `internal`, `totp_required`, `totp_invalid`, `email_not_verified`, `pending_approval`, `rejected`. Пагинации нет. Права: `public`, `user`, `admin`; `user (self)` — только владелец объекта или admin. Ответ `429` дополнительно содержит заголовок `Retry-After` (секунды).

## Маршруты

| Метод | Путь | Права | Запрос | Ответ |
|---|---|---|---|---|
| GET | `/health` | public | — | `{status,service,version}` |
| POST | `/auth/login` | public | `LoginRequest` | `AuthView` |
| POST | `/auth/register` | public | `{email,login?,password}` | `202 {status:"pending_email"}` |
| POST | `/auth/verify-email` | public | `{token}` | `{status:"pending_approval"}` |
| POST | `/auth/resend-verification` | public | `{email}` | `202 {status:"sent"}` |
| POST | `/auth/totp/setup` | user | — | `{secret,otpauth_url,recovery_codes}` |
| POST | `/auth/totp/enable` | user | `{code}` | `{enabled:true}` |
| POST | `/auth/totp/disable` | user | `{password,code}` | `{enabled:false}` |
| POST | `/auth/refresh` | public | `RefreshRequest` | `AuthView` |
| POST | `/auth/logout` | user | `LogoutRequest` | `{ok:true}` |
| POST | `/auth/logout-all` | user | — | `{ok:true,revoked}` |
| GET | `/auth/me` | user | — | `UserView` |
| POST | `/auth/password` | user | `ChangePasswordRequest` | `{ok:true}` |
| GET | `/auth/sessions` | user | — | `SessionView[]` |
| DELETE | `/auth/sessions/{jti}` | user | — | `{ok:true}` |
| POST | `/auth/logout-all` | user | — | `{ok:true,revoked}` |
| GET | `/auth/sessions` | user | — | `SessionView[]` |
| DELETE | `/auth/sessions/{jti}` | user | — | `{ok:true}` |
| GET | `/users` | admin | — | `UserView[]` |
| GET | `/users/pending` | admin | — | `UserView[]` (pending approval) |
| POST | `/users/{id}/approve` | admin | `{tariff_id,group_id?}` | `UserView` |
| POST | `/users/{id}/reject` | admin | — | `UserView` |
| POST | `/users` | admin | `CreateUserRequest` | `UserView` |
| GET | `/users/{id}` | admin | — | `UserView` |
| PATCH | `/users/{id}` | admin | `UpdateUserRequest` | `UserView` |
| DELETE | `/users/{id}` | admin | — | `{ok:true}` |
| POST | `/users/{id}/password` | admin | `{new_password}` (по контроллеру) | `{ok:true}` |
| GET | `/tariffs` | admin | — | `TariffView[]` |
| POST | `/tariffs` | admin | `CreateTariffRequest` | `TariffView` |
| PATCH | `/tariffs/{id}` | admin | `UpdateTariffRequest` | `TariffView` |
| DELETE | `/tariffs/{id}` | admin | — | `{ok:true}` |
| GET | `/groups` | user | — | `GroupView[]` (interfaces, devices) |
| POST | `/groups` | admin | `CreateGroupRequest` | `GroupView` |
| PATCH | `/groups/{id}` | admin | `UpdateGroupRequest` | `GroupView` |
| DELETE | `/groups/{id}` | admin | — | `{ok:true}` |
| GET | `/groups/{id}/pools` | user | — | `PoolView[]` |
| POST | `/groups/{id}/pools` | admin | `CreatePoolRequest` | `PoolView` |
| PATCH | `/pools/{id}` | admin | `UpdatePoolRequest` | `PoolView` |
| DELETE | `/pools/{id}` | admin | — | `{ok:true}` |
| GET | `/nodes` | user | — | `NodeView[]` |
| POST | `/nodes` | admin | `CreateNodeRequest` | `NodeView` |
| DELETE | `/nodes/{id}` | admin | — | `{ok:true}` |
| GET | `/interfaces` | user | — | `InterfaceView[]` |
| POST | `/interfaces` | admin | `CreateInterfaceRequest` | `InterfaceView` |
| PATCH | `/interfaces/{id}` | admin | `UpdateInterfaceRequest` | `InterfaceView` |
| DELETE | `/interfaces/{id}` | admin | — | `{ok:true}` |
| POST | `/interfaces/{id}/rotate` | admin | — | `{ok:true}` |
| GET | `/devices` | user | — | `DeviceView[]` (admin видит все, user — свои) |
| POST | `/devices` | user | `CreateDeviceRequest` | `DeviceView` |
| GET | `/devices/{id}` | self/admin | — | `DeviceView` |
| PATCH | `/devices/{id}` | self/admin | `UpdateDeviceRequest` | `DeviceView` |
| DELETE | `/devices/{id}` | self/admin | — | `{ok:true}` |
| GET | `/devices/{id}/profiles` | self/admin | — | `ProfileView[]` |
| GET | `/devices/{id}/profiles/{interface_id}` | self/admin | — | `ProfileView` |
| GET | `/devices/{id}/shares` | self/admin | — | `ShareLinkView[]` |
| POST | `/devices/{id}/shares` | self/admin | `CreateShareRequest` | `ShareLinkView` |
| GET | `/devices/{id}/stats` | self/admin | — | `DeviceTrafficView` (через stats) |
| DELETE | `/shares/{token}` | user | — | `{ok:true}` |
| GET | `/stats/overview` | user/admin | — | `OverviewView` |
| GET | `/stats/series` | user/admin | query `scope,id,from,to` | `StatsPoint[]` |
| GET | `/stats/aggregate` | user/admin | query `scope,id,bucket,from,to` (см. «Агрегация статистики») | `{bucket,points}` |
| GET | `/quota` | user/admin | — | `QuotaView` (только своя квота) |
| GET | `/quota/users` | admin | — | `QuotaUserView[]` |
| GET | `/settings` | admin | — | `SettingsView` (obfuscation, share TTL, stats retention) |
| PUT | `/settings` | admin | `UpdateSettingsRequest` | `SettingsView` |
| GET | `/audit` | admin | query `limit`, `before`, `action`, `entity`, `actor`, `status`, `from`, `to` (см. «Аудит») | `{items, next_cursor}` |
| POST | `/import` | admin | `ImportRequest` (устаревший) | `{group_id,interface_id,imported_devices,failed_devices}` |
| POST | `/import/preview` | admin | `BatchImportRequest` | `ImportPreviewView` (без записи в БД) |
| POST | `/import/apply` | admin | `BatchImportRequest` | `ImportApplyView` |
| POST | `/import/clients/preview` | admin | `ClientsImportRequest` | `ClientsImportPreviewView` (без записи в БД) |
| POST | `/import/clients/apply` | admin | `ClientsImportRequest` | `ClientsImportApplyView` |
| GET | `/ws/stats` | user | query `token,scope,id` | WebSocket |
| GET | `/share/{token}` | public | — | файл конфигурации (`download`) |

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
        {"name": "phone", "status": "create", "address": "10.8.0.2", "reason": null},
        {"name": "phone", "status": "duplicate", "address": null, "reason": "client public key already imported in interface awg0"},
        {"name": "laptop", "status": "error", "address": null, "reason": "client config points at a different server public key"}
      ],
      "counts": {"create": 1, "duplicate": 1, "error": 1}
    }
  ],
  "summary": {"create": 1, "duplicate": 1, "error": 1, "interfaces": 1},
  "warnings": ["client phone in interface awg0 renamed to phone-2"]
}
```

Статусы клиента:

- `create` — клиент будет создан; `address` — адрес из его конфига.
- `duplicate` — public key уже встречался в этом батче или в БД; повторная
  вставка не выполняется (`reason` указывает, где он найден).
- `error` — конфиг не разобран, `[Peer] PublicKey` не совпадает с public key
  серверного конфига интерфейса, нет `Address` в пулах интерфейса, адрес уже
  занят, имя пустое или длиннее 64 символов. Такие клиенты не прерывают
  preview/apply — они попадают в отчёт.

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

### Apply

Ответ — тот же `ImportPreviewView` плюс блок `created`:

```json
{
  "group": {"name": "Офис", "base_cidr": "10.8.0.0/24"},
  "interfaces": [ … ],
  "summary": {"create": 1, "duplicate": 1, "error": 1, "interfaces": 1},
  "warnings": [],
  "created": {
    "group_id": "…",
    "interfaces": [{"id": "…", "name": "awg0", "device_ids": ["…"]}]
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

Импорт серверных пиров без клиентских конфигов (external peers) пока не
поддерживается — такие `[Peer]` из серверного конфига игнорируются.

## Импорт клиентов в существующий интерфейс

Дополнительный импорт клиентских AmneziaWG-конфигов в уже существующие группы и
интерфейсы. Батч-импорт новых групп (`/import/preview|apply`) при этом не
меняется и продолжает работать как описано выше. Доступен только роли `admin`.

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
        {"name": "phone", "status": "create", "address": "10.8.0.2", "reason": null},
        {"name": "laptop", "status": "duplicate", "address": null, "reason": "client public key already exists"},
        {"name": "tablet", "status": "error", "address": null, "reason": "client address does not belong to any configured pool: 10.9.0.2/24"}
      ],
      "counts": {"create": 1, "duplicate": 1, "error": 1}
    }
  ],
  "summary": {"create": 1, "duplicate": 1, "error": 1, "interfaces": 1},
  "warnings": []
}
```

Статусы клиента:

- `create` — устройство будет создано; `address` — первый адрес из конфига,
  попавший в пул группы интерфейса.
- `duplicate` — public key уже есть в БД или повторяется в этом запросе.
  Повторная вставка не выполняется; `reason` указывает, где найден ключ.
- `error` — конфиг не разобран, серверный ключ не совпадает с интерфейсом,
  интерфейс не найден или неоднозначен, нет `Address` в пулах группы, адрес уже
  занят (в БД или другим клиентом батча), имя пустое или длиннее 64 символов.

Правила валидации:

- public key сервера выводится из `PrivateKey` интерфейса; клиент должен
  содержать тот же `[Peer] PublicKey`;
- `Address` должен лежать в одном из включённых пулов группы интерфейса и не
  пересекаться с адресами существующих пиров и клиентов этого же запроса;
- дубли имён клиентов нормализуются суффиксом (`phone`, `phone-2`, …) и
  попадают в `warnings`; имена сравниваются без учёта регистра;
- preview не пишет в БД и не меняет интерфейсы, пулы и устройства.

### Apply

Ответ — тот же `ClientsImportPreviewView` плюс блок `created`:

```json
{
  "interfaces": [ … ],
  "summary": {"create": 1, "duplicate": 0, "error": 0, "interfaces": 1},
  "warnings": [],
  "created": {
    "interfaces": [{"id": "…", "device_ids": ["…"]}]
  }
}
```

- План пересчитывается заново; статусы отражают фактический результат.
- Устройства создаются тем же путём, что и в батч-импорте
  (`devices.import_device`): `group_id` интерфейса, `interface_id`, указанный
  или текущий администратор в качестве владельца.
- Ошибки отдельных клиентов не фатальны: остальные устройства создаются,
  клиент получает `status: "error"` и причину.
- Фатальны ошибки хранилища и исчезнувшие во время применения группа/интерфейс.
  В этом случае созданные в этом запросе устройства удаляются (best-effort
  rollback, включая устройства без сохранённого пира), ответ — `4xx/5xx`.
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
  "user": {"id": "…", "login": "admin", "role": "admin", "…": "…"}
}
```

- `POST /auth/login` — `{"login":"…","password":"…"}`; неверные данные и
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
- `POST /auth/password`, `PATCH /users/{id}` с `disabled=true`,
  `POST /users/{id}/password` и `DELETE /users/{id}` отзывают все refresh-сессии
  затронутого пользователя.

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
(`AWG_MAIL_MODE=log|smtp`); токен живёт 24 часа и одноразовый. После перехода по
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
4. `POST /users/{id}/approve` `{"tariff_id":"…","group_id":"…"}` (admin) →
   `UserView` со статусом `active`.
5. `POST /users/{id}/reject` (admin) → `UserView` со статусом `rejected`.

`POST /auth/resend-verification` `{"email":"…"}` всегда отвечает
`202 {"status":"sent"}` и не раскрывает существование аккаунта. `register` и
`resend-verification` ограничены по IP (`AWG_REGISTER_RATE_LIMIT`,
`AWG_RESEND_RATE_LIMIT`).

Вход `POST /auth/login` принимает в поле `login` email или логин (email
проверяется первым). Незавершённые статусы дают `403` с кодом
`email_not_verified`, `pending_approval` или `rejected`. Пользователи,
созданные администратором, сразу `active`.

`UserView` дополнен полями `email`, `status` (`pending_email`,
`pending_approval`, `active`, `rejected`) и `totp_enabled`.

TOTP (RFC 6238, SHA-1, 6 цифр, шаг 30 секунд, допуск ±1):

- `POST /auth/totp/setup` → `{secret, otpauth_url, recovery_codes}`. Секрет
  хранится только в зашифрованном виде (`Sealer`), возвращаются 8 одноразовых
  recovery-кодов (в хранилище — Argon2-хэши), `totp_enabled` пока `false`.
- `POST /auth/totp/enable` `{"code":"123456"}` → `{"enabled":true}`.
- `POST /auth/totp/disable` `{"password":"…","code":"…"}` →
  `{"enabled":false}`, секрет и recovery-коды удаляются.

При включённом TOTP вход без кода возвращает `401 totp_required`, с неверным
кодом — `401 totp_invalid`. В поле `totp_code` принимается код приложения или
одноразовый recovery-код. Ошибки статусов и коды TOTP отдаются в формате
`{"error":{"code":"…","message":"…"}}`.

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
  скоростью 1 kbps.

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

- `POST /devices/{id}/shares` создаёт токен с TTL; ответ `ShareLinkView` содержит `url = /api/v1/share/{token}`.
- `GET /api/v1/share/{token}` отдаёт конфиг (awg/wg) без JWT (публичный download с истечением TTL).
- `DELETE /api/v1/shares/{token}` отзывает ссылку.

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

Автоматически фиксируются успешные (2xx) mutating-запросы `POST`, `PATCH`,
`PUT`, `DELETE` под `/api/v1`: actor определяется по Bearer-токену (без токена —
`anonymous`), `entity` — путь без идентификатора, `entity_id` — первый UUID или
share-токен из пути, `ip` — первый адрес `X-Forwarded-For` либо адрес peer.

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
