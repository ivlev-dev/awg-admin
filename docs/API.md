# HTTP API

Базовый путь: `/api/v1`. Формат ошибок:

```json
{"error":{"code":"not_found","message":"..."}}
```

Коды: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `internal`. Пагинации нет. Права: `public`, `user`, `admin`; `user (self)` — только владелец объекта или admin.

## Маршруты

| Метод | Путь | Права | Запрос | Ответ |
|---|---|---|---|---|
| GET | `/health` | public | — | `{status,service,version}` |
| POST | `/auth/login` | public | `LoginRequest` | `AuthView` |
| POST | `/auth/refresh` | public | `RefreshRequest` | `AuthView` |
| POST | `/auth/logout` | user | `LogoutRequest` | `{ok:true}` |
| GET | `/auth/me` | user | — | `UserView` |
| POST | `/auth/password` | user | `ChangePasswordRequest` | `{ok:true}` |
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
| POST | `/import` | admin | `ImportRequest` | `{ok:true}` |
| GET | `/ws/stats` | user | query `token,scope,id` | WebSocket |
| GET | `/share/{token}` | public | — | файл конфигурации (`download`) |

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
```

Now SECURITY.md.<|end|><|start|>advisor to=write_file<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
awg-admin/docs/SECURITY.md