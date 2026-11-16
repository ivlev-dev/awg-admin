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
- `storage` — репозиторий `Store`: единственный redb-файл, версия схемы, миграции, backup/restore.
- `identity` — пользователи, роли, Argon2, JWT, регистрация с подтверждением email, TOTP 2FA.
- `tariffs` — тарифы и лимиты.
- `billing` — планы, подписки, счета и порт `PaymentGateway`; по умолчанию выключен.
- `network` — группы, ноды, интерфейсы, пулы CIDR, obfuscation-настройки.
- `clients` — устройства, пирь, профили, share-ссылки.
- `statistics` — агрегация трафика, scope: часовые бакеты, дневные/месячные ряды на лету, retention.
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

Правила зависимостей (проверяются командой `pnpm arch:check`, конфигурация — `frontend/.dependency-cruiser.cjs`):

- `domain` не импортирует `application`, `infrastructure`, `features`, `app`, `components`.
- `application` импортирует только `domain` (и соседние модули `application`); `infrastructure`, `features`, `app`, `components` запрещены.
- `infrastructure` импортирует `domain` и `application` (порт `AuthSessionState`); `features`, `app`, `components` запрещены.
- `features/*` импортируют `domain`, `application`, `app` и общие `components`; value-импорты из `infrastructure` и импорты других `features/*` запрещены. `import type` из `infrastructure` допустим — зависимость стирается при компиляции и не тянет рантайм; тестовые файлы (`*.test.ts(x)`) могут собирать адаптеры (`LiveStats`, `TokenStore`) напрямую.
- `app` — composition root и единственный, кто знает о конкретных классах; может импортировать любой слой.
- Циклические зависимости запрещены на всех слоях (правило `no-circular`); проверка orphan-модулей намеренно не включена.
- Алиас `@/` → `src` резолвится конфигом `.dependency-cruiser.webpack.cjs` (`resolve.alias`). Парсер — `@swc/core`: `dependency-cruiser` не поддерживает TypeScript 7, на котором работает `tsc --noEmit`.
- Контексты: `auth`, `users`, `tariffs`, `groups` (включая CIDR-пулы), `nodes`, `interfaces`, `devices` (устройства, профили, share-ссылки, статистика устройства), `stats`, `settings`, `import`.


### Проверка границ

```bash
cd frontend && pnpm arch:check
```

`dependency-cruiser` строит граф зависимостей `frontend/src` и падает при нарушении
правил выше. Проверка не входит в `pnpm test` — запускается отдельно, вместе с
`pnpm typecheck`, `pnpm test` и `pnpm build`. Правила в конфиге: `domain-isolated`,
`application-uses-domain-only`, `infrastructure-implements-ports`,
`features-no-infrastructure`, `features-no-cross-feature-imports`, `no-circular`.

### Как добавить контекст

1. `domain/<context>/types.ts` — входные DTO, `domain/<context>/repository.ts` — интерфейс репозитория с доменными типами из `domain/types.ts`.
2. `infrastructure/http/<context>.repository.ts` — реализация поверх `HttpClient` без бизнес-логики.
3. `application/<context>/service.ts` — use case: проверки, нормализация, вызовы репозитория.
4. Добавить репозиторий и сервис в `app/di.ts` (`ApiRepositories`, `AppServices`, `createAppServices`, `resolveAppServices`).
5. Добавить интерфейс сервиса (`interface XService`) и реализацию `DefaultXService`; VM зависят только от интерфейса.
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

### Итоговое состояние фронтенда

- Переходный слой удалён: `application/api.ts` (`AdminApi`) и `infrastructure/http.ts` (`HttpApi`) больше не существуют.
- Все сервисы — интерфейс + `Default*`-реализация; VM получают их через конструктор (`import type`).
- `app/container.ts` содержит только `bindAppServices(container)`; глобальных экспортов нет.
- `AppVM`, страницы и `Session` используют конструкторную инъекцию; `mount` получает корневой контейнер из `main.tsx`.
- Страницы подключены через `lazy` + `Suspense`, каждая в своём чанке.
- DI-индекс не разрешает alias `@/` для type-импортов интерфейсов — в конструкторах используйте относительные пути.
- `lazy` + `Suspense` внутри `Show` требует обёртки с единственным корнем (`PageSlot`), иначе при смене маршрута остаётся осиротевший DOM.

## Тесты

Уровни проверки:

- backend — `cargo test --workspace` (юнит- и интеграционные тесты крейтов);
- frontend — `cd frontend && pnpm typecheck && pnpm test` (Vitest + happy-dom);
- границы слоёв — `cd frontend && pnpm arch:check` (dependency-cruiser);
- e2e — `cd frontend && pnpm e2e` (Playwright, спеки в `frontend/e2e`).

E2E работают против поднятого стека: nginx раздаёт SPA на `:8081` и проксирует
`/api` в admin. `baseURL` задаётся `E2E_BASE_URL` (по умолчанию
`http://127.0.0.1:8081`), учётные данные администратора —
`E2E_ADMIN_LOGIN`/`E2E_ADMIN_PASSWORD` (по умолчанию `admin`/`admin12345`).
Проекты — Chromium и Firefox. В CI включены `retries: 1`, trace и screenshot
только при падении; HTML-отчёт складывается в `frontend/playwright-report`,
сырые артефакты — в `frontend/test-results`.

Покрытие:

- `auth.spec.ts` — вход, неверный пароль, выход, скрытие и запрет
  adminOnly-разделов (`/audit`, `/users`) для роли `user`;
- `navigation.spec.ts` — все разделы через sidebar, заголовки, отсутствие
  ошибок загрузки lazy-чанков и JS-исключений;
- `forwarding.spec.ts` — устройства A/B/C одного пользователя, включение пар
  A↔B и B↔C, сохранение A↔C запрещённой после перезагрузки;
- `quota.spec.ts` — квота тарифа в профиле пользователя и колонка «Квота»
  в списке пользователей;
- `audit.spec.ts` — фильтр по актору, пустая выдача и сброс фильтров.

Фикстуры создаются через API в `beforeAll` с уникальным timestamp-суффиксом:
группа, пул, нода, интерфейс, тариф, пользователь и устройства. Спеки не
зависят от данных, созданных другими прогонами; в CI БД эфемерная и удаляется
через `docker compose down -v`.

```bash
cd frontend
pnpm exec playwright install --with-deps chromium firefox  # один раз
pnpm e2e                       # оба проекта
pnpm e2e --project=chromium    # только Chromium
pnpm e2e:headed                # с видимым браузером
```

## Хранилище (redb)

`Store` — единственное подключение к redb-файлу (`AWG_DB_PATH`, по умолчанию
`/data/awg-admin.redb`). Все доменные таблицы (`users`, `devices`, `audit` и
т.д.) — обычные `TableDefinition<&str, &[u8]>` с JSON-значениями.

### Версия схемы

Служебная таблица `meta` хранит ключ `schema_version` (JSON `u32`), рядом с
доменными таблицами; `Store::open`/`open_in_memory` создают её, если её нет.
Текущая версия — `CURRENT_SCHEMA_VERSION` (сейчас `2`). `Store::schema_version()`
возвращает версию открытой базы.

При открытии (`schema::initialize`):

- версии нет — создать таблицы и записать `CURRENT_SCHEMA_VERSION` (так
  помечаются и legacy-базы до версионирования: их схема считается текущей);
- версия равна текущей — ничего не делать;
- версия меньше текущей — применить зарегистрированные шаги;
- версия больше текущей — `StorageError::SchemaTooNew` с сообщением
  `store schema version N is newer than supported version M`; admin не стартует.

### Миграции

Реестр — `MIGRATIONS: &[MigrationStep]`, шаг `MigrationStep { from, to, apply }`
с `apply: fn(&WriteTransaction) -> Result<()>`. Функция `migrate(from, to)`
строит цепочку шагов от `from` до `to` (требует `step.from == cursor` и
`step.to <= to`), при дыре возвращает `MissingMigration`, при `to < from` —
`InvalidMigration`. Все шаги и запись новой версии выполняются в одной
write-транзакции: ошибка любого шага откатывает и данные, и версию
(`failed_migration_rolls_back_and_keeps_version`). Для тестов доступна
`migrate_with(..., steps)` с произвольным реестром; в `MIGRATIONS` есть шаг
`1 → 2` (`v2_billing`), который создаёт таблицы биллинга и не меняет
существующие данные.

Добавление миграции: поднять `CURRENT_SCHEMA_VERSION`, добавить
`MigrationStep { from: old, to: new, apply }` в `MIGRATIONS`. Шаг работает
только через `WriteTransaction` и обязан быть идемпотентным относительно
консистентного состояния `from`.

### Backup

`Database::compact()` в redb не даёт hot-backup, а копирование файла на живой
базе небезопасно. Поэтому `Store::backup_to(path)` делает логический снапшот:
одна read-транзакция на источнике (консистентный снимок на момент открытия
транзакции) + запись всех таблиц и `schema_version` в новый redb-файл.
Процесс admin останавливать не нужно, конкурентные записи в снапшот не
попадают.

Порядок: временный файл `<path>.tmp-<pid>-<n>` → запись снапшота → повторное
открытие с `set_check_integrity_on_open(true)` и проверкой версии → `fsync` и
атомарный `rename` на `path`. При ошибке временный файл удаляется, прежний
backup не трогается. Нельзя указать путь самого открытого файла БД —
`BackupPathConflict`.

### Restore

- `Store::restore_from(path)` — восстановление в работающую базу: backup
  открывается с проверкой целостности, версия должна строго совпадать с
  `CURRENT_SCHEMA_VERSION` (иначе `IncompatibleBackup`/`UnversionedBackup`,
  база не меняется). Все таблицы удаляются и заново наполняются из backup в
  одной write-транзакции вместе с версией — восстановление атомарно; записи,
  сделанные после backup, исчезают.
- `Store::replace_file_from(backup, target)` — офлайн-замена файла: копия
  backup во временный файл рядом с `target`, проверка целостности и версии,
  `fsync`, `rename`. Требует остановленного admin: файл БД открыт эксклюзивно,
  подмена файла у работающего процесса не поддерживается.

Для проверки целостности backup открывается на запись (redb выполняет проверку
только при read-write open), поэтому файл backup должен быть доступен на
запись. Backup переносим между инсталляциями только при совпадении версии
схемы; при расхождении сначала обновите admin до версии, создавшей backup, или
наоборот выполните миграции на восстановленной копии.

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

`statistics` хранит только часовые бакеты `TrafficBuckets` (`scope`, `hour`,
`rx`, `tx`); счётчики устройств лежат в `PeerCounters`. Дневные и месячные
ряды для `GET /api/v1/stats/aggregate` строятся на лету из часовых бакетов
(`StatsService::daily`/`monthly`) с группировкой по UTC-суткам и календарным
месяцам; материализованных дневных/месячных таблиц нет. Окно запроса
ограничено 366 днями для `day` и 3660 днями для `month`.

Срок хранения часовых бакетов задаётся настройкой `stats_retention_days`
(`PUT /api/v1/settings`, clamp `7..3650`, по умолчанию `90`). Фоновая задача в
`admin` раз в час перечитывает `SettingsStore` и вызывает
`StatsService::cleanup(keep_days)`, поэтому новое значение применяется без
перезапуска; количество удалённых бакетов пишется в лог.

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

### Регистрация, email и TOTP

`User` расширен полями `email`, `status`, `totp_secret_sealed`, `totp_enabled`
и `recovery_codes`; все имеют `serde(default)`, поэтому записи старого формата
читаются как `active` без 2FA. Статусы: `pending_email` → `pending_approval` →
`active` либо `rejected`. `ensure_active` требует `status=active` и
`disabled=false`; `login` ищет сначала по email, затем по login.

Одноразовые токены подтверждения email лежат в redb-таблице
`email_verifications`: ключ — `sha256(token)` в hex, значение — `user_id`,
`email`, `expires_at`, `used`; TTL 24 часа. Письмо отправляет `Mailer`
(`LogMailer` или `SmtpMailer` на `lettre`), ссылка строится от
`AWG_PUBLIC_URL`. Регистрация создаёт `pending_email`, подтверждение переводит
в `pending_approval`, администратор назначает тариф и группу (`approve`) или
отклоняет (`reject`).

TOTP реализован на `totp-rs` (SHA-1, 6 цифр, шаг 30 секунд, допуск ±1).
Base32-секрет шифруется `awg_shared::crypto::Sealer` перед сохранением, в
`recovery_codes` хранятся Argon2-хэши 8 одноразовых кодов. Вход при
включённом TOTP требует `totp_code`: проверяется текущий код или recovery-код
(после использования удаляется). `disable` требует пароль и действующий код.

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

## Observability

### Метрики

`GET /metrics` отдаёт реестр Prometheus в text-формате версии `0.0.4`
(`Content-Type: text/plain; version=0.0.4`). Модуль — `admin::metrics`
(crate `prometheus`), реестр один на процесс.

| Метрика | Тип | Метки |
| --- | --- | --- |
| `awg_http_requests_total` | counter | `method`, `status` |
| `awg_http_request_duration_seconds` | histogram | `method` |
| `awg_auth_logins_total` | counter | `result` = `success`/`failure`/`rate_limited` |
| `awg_rate_limited_total` | counter | `scope` = `login`/`refresh` |
| `awg_audit_events_total` | counter | `action`, `status` |
| `awg_worker_online` | gauge | — |

Гистограмма latency использует бакеты `0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
0.5, 1, 2` секунды. `metrics::middleware` оборачивает весь роутер: после ответа
инкрементирует счётчик и наблюдает длительность для всех путей под `/api/v1`
(сам `/metrics` не учитывается). Слои аудита, CORS и rate limiting остаются
внутри, порядок не менялся.

Логин инкрементирует `awg_auth_logins_total` во всех ветках (успех, ошибка,
лимит), а `awg_rate_limited_total` — в точках отказа лимитеров логина и refresh.
Аудит инкрементирует `awg_audit_events_total` там же, где пишет `AuditEntry`.
`awg_worker_online` выставляется в момент scrape по
`WorkerRegistry::presence().len()`, поэтому не требует отдельного состояния.

Скрейп с токеном:

```bash
AWG_METRICS_TOKEN=$(openssl rand -hex 24)
curl -fsS -H "Authorization: Bearer $AWG_METRICS_TOKEN" \
  http://127.0.0.1:8080/metrics
```

Безопасность: если `AWG_METRICS_TOKEN` задан, запрос без корректного
`Authorization: Bearer <token>` получает `401` (сравнение constant-time). Если
токен не задан, `/metrics` открыт, и защита ложится на сеть: порт admin
(`8080`) не должен быть доступен из untrusted-сетей, снаружи публикуется
только Traefik. В `production` при пустом `AWG_METRICS_TOKEN` в лог пишется
предупреждение на старте.

### Логи

Формат задаётся `AWG_LOG_FORMAT=text|json` (по умолчанию `text`); уровень —
`RUST_LOG` (по умолчанию `info`, `EnvFilter`). При `json` включается
`tracing_subscriber` JSON-формат с полями `timestamp`, `level`, `target`,
`fields` — удобно для Loki/ELK. Конфигурация вынесена в `admin::logging`.

## Конфигурация и секреты

`AWG_ENV=development|production` (по умолчанию `development`).

В `production` старт завершается ошибкой, если:

- `AWG_MASTER_KEY` не задан, не base64 или длина не 32 байта;
- `AWG_JWT_SECRET` не задан или короче 32 байт;
- `AWG_ADMIN_PASSWORD` пустой или равен `admin12345`.

`AWG_JWT_ISSUER` и `AWG_JWT_AUDIENCE` задают `iss`/`aud` новых токенов,
по умолчанию `awg-admin`. Пустые значения заменяются значением по умолчанию.

`AWG_METRICS_TOKEN` включает Bearer-аутентификацию для `GET /metrics`
(см. раздел Observability). `AWG_LOG_FORMAT=text|json` выбирает формат логов.

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

## Биллинг

Этап 1: модель, схема и read-only API. Платёжный шлюз, checkout, webhook и
автосписания не реализованы. Полная модель — `docs/PAYMENTS.md`, решение —
`docs/adr/0001-payments-architecture.md`.

Крейт `awg-billing` следует DDD-слоям:

- `domain` — `Plan`, `Subscription`, `Invoice`, статусы, порты
  `PlanRepository`, `SubscriptionRepository`, `InvoiceRepository` и
  `PaymentGateway`. `NoopGateway` на любой вызов возвращает
  `GatewayError::Unsupported`; реального шлюза нет.
- `application` — `BillingService`: каталог планов (CRUD), текущая подписка,
  `plan_for_user` (активная подписка → план → `tariff_id`), счета и
  админ-список подписок. Списаний и переходов статусов нет.
- `infrastructure` — Redb-репозитории поверх `awg-storage`.

`Plan` — коммерческий каталог, `Tariff` — технические лимиты. `Plan` ссылается
на `tariff_id`, но `User.tariff_id` на этом этапе не меняется: связь с
пользователем только вычисляется через `plan_for_user` и пока не влияет на
snapshot/worker.

Таблицы redb (JSON-значения, ключ — UUID):

- `billing_plans` — `Plan`;
- `billing_subscriptions` — `Subscription`;
- `billing_invoices` — `Invoice`;
- `billing_payment_methods` — резерв под этап 2;
- `billing_events` — резерв под webhook/журнал.

Схема поднята до версии `2`. Миграция `v2_billing` идемпотентно открывает
таблицы и не трогает `users`, `tariffs`, `devices` и остальные данные.
Backup/restore по-прежнему требует точного совпадения версии.

Конфигурация:

- `AWG_BILLING_ENABLED` — главный флаг, по умолчанию `false`; при `false` все
  `/billing/*` отвечают `404 billing_disabled`;
- `AWG_BILLING_CURRENCY` — валюта установки (по умолчанию `RUB`), цена плана
  обязана совпадать;
- `AWG_BILLING_TRIAL_DAYS` — значение для будущих trial-подписок (этап 1 его
  только хранит);
- `AWG_PAYMENT_PROVIDER` — `noop` (по умолчанию), `stripe`, `yookassa`,
  `cloudpayments`, `telegram_stars`; при включённом биллинге в production
  `noop` запрещён.

API: `GET/POST /billing/plans`, `PATCH /billing/plans/{id}` (admin),
`GET /billing/subscription` (self), `GET /billing/invoices` (self, admin — все
или `?user_id=`), `GET /billing/admin/subscriptions` (admin).
