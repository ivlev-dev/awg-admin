# Архитектура awg-admin

## Общая схема

```
Traefik (TLS/HTTP3) -> admin (h2c, порт 8080)
worker -> admin (gRPC, порт 9090, внутри сети)
admin -> redb (файл /data/awg-admin.redb)
```

- `admin` принимает HTTP/1.1 и h2c; TLS терминируется в Traefik.
- `worker` подключается к `admin` по gRPC `WorkerGateway.Session` и получает желаемое состояние, применяет его и шлёт статистику.
- Хранилище — единственный `redb` файл, монтируемый в контейнер.

## Bounded contexts

Backend (`backend/crates/*`) разбит на доменные модули. Зависимости направлены внутрь: presentation зависит от application/domain, infrastructure реализует порты.

- `shared` — shared kernel: `obf`, `conf`, `vpn`, `cidr`, `crypto`.
- `storage` — репозиторий `Store`.
- `identity` — пользователи, роли, Argon2, JWT.
- `tariffs` — тарифы и лимиты.
- `network` — группы, ноды, интерфейсы, пулы CIDR, obfuscation-настройки.
- `clients` — устройства, пирь, профили, share-ссылки.
- `statistics` — агрегация трафика, scope.
- `audit` — журнал действий: `AuditEntry`, `AuditRepository`, `RedbAuditRepository`, `AuditService`.
- `orchestration` — worker registry, desired state, снапшот, приём статистики.
- `proto` — protobuf-контракты gRPC.
- `admin` — composition root, presentation (controllers/models/views), маршруты.
- `worker` — применение состояния на хосте.

## Слои

Каждый контекст держит слои `domain/application/infrastructure` (worker явно, остальные по аналогии). Presentation (`admin`) использует MVC:

- контроллеры (`controllers/*`) — handlers;
- модели (`models.rs`) — DTO запросов;
- представления (`views.rs`) — сериализация ответов;
- `main.rs` — composition root, собирает сервисы и AppState.

Frontend (`frontend/src`) использует MVVM на silent-framework и делится на четыре слоя:

```
domain <- application <- infrastructure
              ^               ^
              |               |
             app -------------+
```

- `domain` — DTO (`domain/types.ts`), форматирование, валидация и интерфейсы репозиториев по контекстам: `domain/<context>/repository.ts`, входные DTO — `domain/<context>/types.ts`. Domain не знает про HTTP, fetch, localStorage и silent-framework.
- `application` — сервисы/use cases (`application/<context>/service.ts`). Принимают репозитории через конструктор, выполняют проверки и нормализацию, отдают ошибки `ValidationError` для UI. Не знают про транспорт и хранилище.
- `infrastructure` — реализации репозиториев и транспорта: `infrastructure/http/transport.ts` (`HttpTransport` — чистый fetch: base URL, JSON/текст/204, timeout, `ApiError`, без авторизации), `infrastructure/http/client.ts` (`HttpClient` — цепочка интерсепторов), `infrastructure/http/<context>.repository.ts`, `storage.ts` (`TokenStore`/`LocalTokenStore`), WebSocket-статистика.
- `app` — composition root и MVVM-обвязка: router, session, theme, toast, `di.ts`, `container.ts`. `features/*` содержат View (`*.tsx`) и ViewModel (`*.vm.ts`).

Правила зависимостей:

- domain не импортирует application/infrastructure/app.
- application импортирует только domain.
- infrastructure импортирует domain и application (порт `AuthSessionState`, совместимый фасад `AdminApi`).
- app собирает всё вместе и единственный знает о конкретных классах.
- Контексты: `auth`, `users`, `tariffs`, `groups` (включая CIDR-пулы), `nodes`, `interfaces`, `devices` (устройства, профили, share-ссылки, статистика устройства), `stats`, `settings`, `import`.

### Как добавить контекст

1. `domain/<context>/types.ts` — входные DTO, `domain/<context>/repository.ts` — интерфейс репозитория с доменными типами из `domain/types.ts`.
2. `infrastructure/http/<context>.repository.ts` — реализация поверх `HttpClient` без бизнес-логики.
3. `application/<context>/service.ts` — use case: проверки, нормализация, вызовы репозитория.
4. Добавить репозиторий и сервис в `app/di.ts` (`ApiRepositories`, `AppServices`, `createAppServices`, `resolveAppServices`).
5. Пробросить методы в `infrastructure/http.ts` (`HttpApi`), если они входят в `AdminApi`.
6. Добавить тесты: сервис с фейковым репозиторием, DI-резолв в `app/di.test.ts`.

### HTTP-слой: транспорт, клиент, интерсепторы

```
repository -> HttpClient -> RequestInterceptor[] -> HttpTransport -> fetch
                  ^                 |
                  |                 v
            InterceptorRegistry  ResponseInterceptor[]
                                      |
                              AuthRepository -> HttpTransport
```

- `HttpTransport` не знает про токены и интерсепторы. Принимает `ApiConfig` (`baseUrl`, `timeoutMs`), сериализует JSON, обрабатывает 204/пустой ответ, бросает `ApiError` (`status`, `code`, `message`).
- `HttpClient` строит `RequestContext`, прогоняет его через request-цепочку, отправляет через транспорт, затем прогоняет `ResponseContext` через response-цепочку. Публичные методы: `get/delete<T>(path, options?)` и `post/patch/put<T>(path, body?, options?)`, где `options: { auth?: boolean; source?: "auth" | "api" }`; по умолчанию `auth: true`, `source: "api"`.
- `InterceptorRegistry` принимает конкретные интерсепторы (`AuthRequestInterceptor`, `AuthResponseInterceptor`) через конструктор и отдаёт упорядоченные `request`/`response` списки. Массив в конструкторе не используется — silent-di не автовайрит массивы.
- `AuthRequestInterceptor` добавляет `Authorization: Bearer <access>` из `TokenStore` только при `auth === true`.
- `AuthResponseInterceptor` обрабатывает `401`:
  - `source === "auth"` или путь `/auth/refresh` — очищает сессию (`AuthSessionState.clear()`), рефреш не выполняется;
  - `source === "api"` — single-flight рефреш через `AuthRepository.refresh()` и один повтор исходного запроса с новым access-токеном; при неудаче сессия очищается, ошибка пробрасывается;
  - повторный `401` после ретрая (`attempt > 0`) второй рефреш не запускает.
- `AuthRepository` использует `HttpTransport` напрямую (login/refresh/logout/me/changePassword), поэтому цепочка `HttpClient -> interceptors -> AuthRepository -> HttpTransport` не содержит обратного ребра на `HttpClient`. `AuthSessionState` реализует `Session`; `HttpClient` резолвится контейнером без `CircularDependencyError`.
- Все методы `AuthRepository` помечают запросы `source: "auth"`; репозитории остальных контекстов используют `HttpClient` с `source: "api"`.

### DI и автопоиск

Контейнер — `@ivlev-dev/silent-di` (реэкспорт из `@ivlev-dev/silent-core`). `app/di.ts`:

- `createAppServices()` — синхронная ручная сборка для существующих VM и `app/container.ts`;
- `createAppContainer()` — контейнер silent-di с опциональными override для `TokenStore` и `ApiConfig`;
- `resolveAppServices()` — резолв сервисов и репозиториев через контейнер;
- `bootstrapApp()` — контейнер + сервисы.

Что важно для автопоиска (проверено тестами `app/di.test.ts`, `app/di.view.test.tsx`):

- интерфейс репозитория импортируется в конструктор через `import type` и **относительным путём**; алиас `@/` сканер индекса не разрешает и подставляет имя интерфейса вместо реализации — сборка падает с `MISSING_EXPORT`;
- у интерфейса ровно одна реализация с `implements Interface`;
- в конструкторе участвуют только интерфейсы и классы. Примитивы, optional-параметры и параметры со значениями по умолчанию отключают генерацию `DI_CREATE`; конфигурация передаётся отдельным интерфейсом (`ApiConfig`);
- VM резолвится контейнером при монтировании (`mount`/`createComponent` с `{ container }`), зависимости конструктора VM разрешаются тем же автопоиском.
- `HttpClient` резолвится контейнером вместе с `InterceptorRegistry` и обоими интерсепторами; цикл `HttpClient → InterceptorRegistry → AuthResponseInterceptor → AuthRepository → HttpTransport` не замыкается на `HttpClient`.

### Совместимость и что осталось мигрировать

- `application/api.ts` (`AdminApi`) и `infrastructure/http.ts` (`HttpApi`) сохранены: `HttpApi` — фасад над новыми репозиториями, сигнатуры не менялись.
- `app/container.ts` собирается из новых классов и экспортирует как старые синглтоны (`api`, `router`, `session`, `theme`, `toasts`, `liveStats`, `tokens`), так и новые сервисы (`authService` … `importService`).
- `Session` переведён на конструкторную инъекцию `AuthRepository` + `TokenStore`; публичные методы не изменились.
- 14 VM в `features/*` пока импортируют синглтоны из `@/app/container`. Следующая волна: заменить их на конструкторную инъекцию сервисов и резолв через `app/di.ts`; после этого `HttpApi`/`AdminApi` можно удалить.
- `AppVM` и `App.tsx` пока используют модульные синглтоны; DI для VM проверен отдельным тестом (`app/di-view.test.tsx`).

## Worker

Модули:
- `domain`: `DesiredState`, `CounterBook`;
- `application`: `ReconcileService`;
- `infrastructure`: `netlink`, `tc`, `nft`, `grpc`, `counters`.

Архитектура application строится на trait-портах: `AwgControl`, `TrafficShaper`, `ForwardingControl`, `CounterRepository`.

## Потоки

### Создание пира

`DeviceService` создаёт устройство и пирь → `SnapshotBuilder` строит desired state с публичными ключами/IP → gRPC отправляет `DesiredState` → worker применяет netlink/tc/nft.

### Статистика

worker читает счётчики интерфейсов → `CounterBook` нормализует переполнения/перезагрузки → `StatsSnapshot` по gRPC → admin агрегирует в `statistics` → раздаёт по WebSocket `/api/v1/ws/stats`.

### Аутентификация и сессии

`identity` выпускает HS256 JWT двух видов: короткоживущий access и refresh.
Claims: `sub`, `role`, `iss`, `aud`, `exp`, `nbf`, `iat`, `jti`, `kind`.
Проверка включает подпись, `exp`, `nbf`, `iss`, `aud` и `kind` с допуском
30 секунд. `iss`/`aud` задаются `AWG_JWT_ISSUER`/`AWG_JWT_AUDIENCE`
(по умолчанию `awg-admin`).

Refresh-записи лежат в redb-таблице `refresh_tokens` по ключу `jti`:
`user_id`, `family_id`, `created_at`, `expires_at`, `revoked`, `used`,
`user_agent`, `ip`. При `POST /auth/refresh` запись атомарно (в пределах
процесса) помечается `used`, а новая пара токенов выдаётся в той же
`family_id`. Предъявление уже использованного или отозванного refresh
трактуется как компрометация: вся family отзывается, клиент получает `403`.
Старые записи без новых полей читаются через `serde(default)`:
`family_id` генерируется, `created_at` берётся как время чтения.

Сессии текущего пользователя доступны через `GET /auth/sessions`,
отзыв одной — `DELETE /auth/sessions/{jti}`, всех — `POST /auth/logout-all`.
Смена/сброс пароля, блокировка (`disabled=true`) и удаление пользователя
отзывают все его refresh-записи. Истёкшие записи удаляет `prune_expired()`
фоновым таском `main` раз в час; на каждом запросе таблица не сканируется,
кроме точечного чтения по `jti`.

Access-токены остаются stateless: после logout или logout-all ранее выданный
access валиден до `exp` (не больше `AWG_ACCESS_TTL_SECS`, по умолчанию 900
секунд). Denylist не используется; вместо него `authenticate` на каждом
запросе проверяет, что пользователь существует и не заблокирован, поэтому
блокировка и удаление применяются немедленно.

### Аудит

`admin` содержит middleware (`audit::middleware`), которое после успешного (2xx)
`POST`/`PATCH`/`PUT`/`DELETE` под `/api/v1` пишет `AuditEntry` в redb-таблицу
`audit`. Ключ — `время в микросекундах + id`, поэтому итерация по ключам
хронологическая, а `GET /api/v1/audit` отдаёт сначала новые записи. Actor
определяется по Bearer-токену; для входа в систему запись создаёт контроллер,
т.к. middleware не читает тело запроса. IP берётся из `X-Forwarded-For`
(первый адрес, Traefik) или из `ConnectInfo<SocketAddr>`.

### Rate limiting

`admin` держит два `SlidingWindowLimiter` в памяти: логин (ключ `IP + login`) и
refresh (ключ `IP`). Окно очищается лениво при обращении и фоновым таском.
Настройки — в `Config` (`AWG_LOGIN_RATE_LIMIT`, `AWG_LOGIN_RATE_WINDOW_SECS`,
`AWG_REFRESH_RATE_LIMIT`, `AWG_REFRESH_RATE_WINDOW_SECS`).

## Конфигурация и секреты

`AWG_ENV=development|production` (по умолчанию `development`).

В `production` старт завершается ошибкой, если:

- `AWG_MASTER_KEY` не задан, не base64 или длина не 32 байта;
- `AWG_JWT_SECRET` не задан или короче 32 байт;
- `AWG_ADMIN_PASSWORD` пустой или равен `admin12345`.

`AWG_JWT_ISSUER` и `AWG_JWT_AUDIENCE` задают `iss`/`aud` новых токенов,
по умолчанию `awg-admin`. Пустые значения заменяются значением по умолчанию.

В `development` отсутствующие `AWG_MASTER_KEY`/`AWG_JWT_SECRET` генерируются
эфемерно с предупреждением: после рестарта сохранённые секреты устройств
становятся нечитаемыми. Валидация вынесена в чистую функцию
`Config::from_input(ConfigInput)`, не зависящую от процесса.

## Обфускация AWG 3.1

- `H1-H4`: диапазоны в зонах `100000`, `1000000`, `2000000`, `3000000`, ширина не более `HEADER_ZONE_WIDTH` (20 000). Для `RandomTrailers` зоны узкие (см. `header_ranges_stay_in_zone_and_narrow`).
- `S1-S4`: floor `S_FLOOR_WITH_HPK = 12`; генерация без коллизий суммарных размеров (`sizes_never_collide`).
- `Jc`, `Jmin`, `Jmax` для junk-пакетов; `I1-I5` — HTTP/3 mimicry (QUIC/TLS), браузерные размеры с выравниванием до 128 для Chrome/Edge/Safari.
- Кодек `vpn://`: сжатие конфига и AWG-параметров в base64-url.

## CIDR и forwarding

- Группа имеет `base_cidr`; пулы (`CidrPool`) выделяют поддиапазоны устройствам и интерфейсам.
- Forwarding между устройствами пользователя выражается `ForwardingRule` и применяется nftables-правилами.

## Тарифы

- Тариф задаёт лимиты на устройство (`device_down/up_kbps`) и группу (`group_down/up_kbps`), `max_devices`, `traffic_quota_bytes`.
- При превышении квоты device-скорость ограничивается до `1 kbps`; групповые лимиты применяются через HTB/tc.
