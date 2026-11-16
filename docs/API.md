# HTTP API

Базовый путь: `/api/v1`. Формат ошибок:

```json
{"error":{"code":"not_found","message":"..."}}
```

Коды: `bad_request`, `invalid_filter`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_many_requests`, `internal`. Пагинации нет. Права: `public`, `user`, `admin`; `user (self)` — только владелец объекта или admin. Ответ `429` дополнительно содержит заголовок `Retry-After` (секунды).

## Маршруты

| Метод | Путь | Права | Запрос | Ответ |
|---|---|---|---|---|
| GET | `/health` | public | — | `{status,service,version}` |
| POST | `/auth/login` | public | `LoginRequest` | `AuthView` |
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
| GET | `/settings` | admin | — | `ObfuscationView` + share TTL |
| PUT | `/settings` | admin | `UpdateSettingsRequest` | то же |
| GET | `/audit` | admin | query `limit`, `before`, `action`, `entity`, `actor`, `status`, `from`, `to` (см. «Аудит») | `{items, next_cursor}` |
| POST | `/import` | admin | `ImportRequest` | `{ok:true}` |
| GET | `/ws/stats` | user | query `token,scope,id` | WebSocket |
| GET | `/share/{token}` | public | — | файл конфигурации (`download`) |

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
