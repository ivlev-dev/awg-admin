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


### Доступность модальных окон

`components/Modal` — контролируемый диалог: при открытии фокус переходит на первый
интерактивный элемент (или на контейнер с `tabindex="-1"`), `Tab`/`Shift+Tab`
циклически остаются внутри, `Escape` и клик по backdrop закрывают окно при
`closable !== false`, а при закрытии фокус возвращается на элемент-инициатор.
Корень размечен `role="dialog"`, `aria-modal="true"` и `aria-labelledby`
(или `aria-label` для пустого заголовка). Вложенные модалки образуют стек:
обработчики клавиатуры срабатывают только у верхней.

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
- `InterceptorRegistry` принимает конкретные интерсепторы (`AuthRequestInterceptor`, `AuthResponseInterceptor`) через конструктор и отдаёт упорядоченные `request`/`response` списки. Массив в конструкторе не используется — silent-di не автовайрит массивы. Дополнительные response-интерсепторы подключаются через `addResponse`, чтобы не менять DI-конструктор.
- `AuthRequestInterceptor` добавляет `Authorization: Bearer <access>` из `TokenStore` только при `auth === true`.
- `AuthResponseInterceptor` обрабатывает `401`:
  - `source === "auth"` или путь `/auth/refresh` — очищает сессию (`AuthSessionState.clear()`), рефреш не выполняется;
  - `source === "api"` — single-flight рефреш через `AuthRepository.refresh()` и один повтор исходного запроса с новым access-токеном; при неудаче сессия очищается, ошибка пробрасывается;
  - повторный `401` после ретрая (`attempt > 0`) второй рефреш не запускает.
- `AuthRepository` использует `HttpTransport` напрямую (login/refresh/logout/me/changePassword), поэтому цепочка `HttpClient -> interceptors -> AuthRepository -> HttpTransport` не содержит обратного ребра на `HttpClient`. `AuthSessionState` реализует `Session`; `HttpClient` резолвится контейнером без `CircularDependencyError`.
- Все методы `AuthRepository` помечают запросы `source: "auth"`; репозитории остальных контекстов используют `HttpClient` с `source: "api"`.

### Отказоустойчивость интерфейса

- `main.tsx` регистрирует `setErrorHandler` из silent-core: ошибки VM, рендера и эффектов вне `ErrorBoundary` логируются в консоль и показываются тостом «Произошла ошибка интерфейса».
- Shell обёрнут в `ErrorBoundary` (`components/ErrorBoundary.tsx`) с fallback «Что-то пошло не так», кнопками «Обновить страницу» и «На главную». Ошибки загрузки lazy-страниц по-прежнему обрабатывает `onError` у `lazy`.
- `ConnectionMonitor` (`app/connection.ts`) слушает `online`/`offline`. `ConnectionBanner` показывает sticky-баннер «Нет соединения» без блокировки UI и «Соединение восстановлено» на 3 секунды.
- `NetworkErrorInterceptor` реагирует только на `code === "network_error"` и показывает тост «Нет связи с сервером» с троттлингом 5 секунд. Поведение `401` и `AuthResponseInterceptor` не меняется.
- Неизвестный маршрут разрешается в `not-found`: для гостя страница «Раздел не найден» рендерится standalone, для авторизованного пользователя — внутри shell, со ссылкой на обзор.

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

### Production-сборка и кеширование

Карты исходников управляются `VITE_SOURCEMAP` (`frontend/vite.config.ts`):

- `false` (по умолчанию) — `.map` не генерируются;
- `hidden` — карты генерируются, но `sourceMappingURL` в JS нет; режим для
  локальной отладки;
- `true` — карты со ссылкой из JS. Не использовать в production.

Docker-образ собирается с `VITE_SOURCEMAP=false` (`ARG` в
`docker/Dockerfile.frontend`), а при `false` сборка падает, если в `dist` попал
`.map`. Дополнительно nginx отвечает `404` на любой `*.map`, поэтому карты не
отдаются даже при ошибочной сборке.

Раздача (`docker/nginx.conf`):

- `index.html` и любой `*.html` — `Cache-Control: no-cache`, `ETag` и `Expires`
  в прошлом: браузер ревалидирует документ и после деплоя получает новый хеш
  бандла;
- `/assets/` — `Cache-Control: public, max-age=31536000, immutable` (имена
  хешированы); на `404` заголовок не ставится, чтобы не кешировать промах;
- `Vary: Accept-Encoding` — `add_header` для всех ответов, `gzip on` для
  js/css/json/xml/svg через `gzip_types`, `gzip_vary off` во избежание
  дублирования `Vary`. Brotli в `nginx:1.27-alpine` отсутствует, поэтому не
  включён;
- security-заголовки вынесены в `docker/nginx-headers.conf`, потому что
  `add_header` в location отменяет наследование; snippet подключается на уровне
  `server` и в каждом location с собственными `add_header`.

Vite сам вставляет `modulepreload` для статических зависимостей входного
чанка, отдельный preload в `index.html` не нужен. Внешних шрифтов и CDN нет:
шрифты только системные (`system-ui`, `ui-monospace`).

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

При `AWG_ENV=development` и `AWG_MAIL_MODE=log` письма с подтверждением email
дополнительно складываются в in-memory dev-ящик (последние 50 писем). Спеки
читают его через `GET /api/v1/dev/mail` и очищают через `DELETE /api/v1/dev/mail`.
В production оба маршрута отвечают 404, письма не сохраняются, а ссылка
подтверждения не попадает в логи. Rate limit регистрации в CI и локальном
`.env` поднят, потому что e2e создают несколько уникальных аккаунтов за прогон.

Покрытие:

- `auth.spec.ts` — вход, неверный пароль, выход, скрытие и запрет
  adminOnly-разделов (`/audit`, `/users`) для роли `user`;
- `auth-registration.spec.ts` — регистрация уникального email, письмо из
  dev-ящика, подтверждение почты по токену, отказ во входе до подтверждения и
  до одобрения, одобрение заявки администратором с тарифом, вход по email;
- `totp.spec.ts` — включение TOTP из профиля (секрет из UI, код на Node
  crypto), шаг кода при входе, неверный код и успешный вход по TOTP;
- `import.spec.ts` — импорт группы с интерфейсом и клиентом, проверка
  preview/apply и группы через UI и API, импорт клиентов в существующий
  интерфейс с автоопределением по public key;
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
Текущая версия — `CURRENT_SCHEMA_VERSION` (сейчас `6`). `Store::schema_version()`
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
`migrate_with(..., steps)` с произвольным реестром; в `MIGRATIONS` есть шаги
`1 → 2` (`v2_billing`, создаёт таблицы биллинга) и `2 → 3`
(`v3_rate_limits`, создаёт таблицу `rate_limits`); существующие данные они не
меняют.

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

`DeviceService` создаёт устройство и по пиру на каждый выбранный интерфейс → `SnapshotBuilder` раскладывает пиров по интерфейсам desired state с публичными ключами/IP → gRPC отправляет `DesiredState` → worker применяет netlink/tc/nft.

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
(`LogMailer` или `SmtpMailer` на `lettre`), веб-ссылка строится от
`AWG_PUBLIC_URL`, deep link приложения — от `AWG_APP_VERIFY_URL`. Регистрация
создаёт `pending_email`, подтверждение переводит
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

Лимитеры login/refresh/register/resend работают через трейт `RateLimiter`
(`check(key, limit, window)`, `reset(key)`, `cleanup()`). Ключ в хранилище —
`scope:sha256(key)`: scope задаёт контроллер (`login`, `refresh`, `register`,
`resend`), хэш не даёт писать в БД сырые IP и логины. `RateLimitScope`
связывает общий backend с лимитом и окном конкретного сценария, поэтому
контроллеры по-прежнему вызывают `check(&key)`/`reset(&key)`.

Две реализации:

- `MemoryRateLimiter` — дефолт (`AWG_RATE_LIMIT_STORE=memory`): точное
  sliding window в памяти процесса, `VecDeque<Instant>` на ключ. Лимиты не
  общие между репликами.
- `StoreRateLimiter` (`AWG_RATE_LIMIT_STORE=redb`) — общее хранилище в
  redb-таблице `rate_limits`. Значение — `{ hits: Vec<u64> (unix secs),
  window_secs, updated_at }`: точное sliding window по секундам, в `hits`
  хранятся только принятые попадания (не больше `limit`), поэтому запись
  ограничена по размеру. Проверка и обновление выполняются в одной
  write-транзакции `Store::update`, а redb сериализует писателей: два
  одновременных запроса (в том числе из разных реплик) не могут оба увидеть
  один и тот же счётчик и потерять обновление. Write-транзакция короткая:
  чтение и запись одного ключа. При ошибке хранилища лимитер
  fail-closed: запрос получает `429` с `Retry-After` на окно.

`Retry-After` считается от самого старого попадания в окне, поведение
`429`/`Retry-After` и переменные `AWG_LOGIN_RATE_LIMIT/WINDOW_SECS`,
`AWG_REFRESH_*` (а также `AWG_REGISTER_*`, `AWG_RESEND_*`) не изменились;
`0` отключает лимит. Фоновый таск раз в час вызывает `cleanup()` (для redb —
удаление записей, у которых последнее попадание старше их окна; для memory —
очистка пустых ключей), дополнительный `cleanup()` выполняется при shutdown.
В production при нескольких репликах нужен `AWG_RATE_LIMIT_STORE=redb`
(при `memory` пишется предупреждение).

В режиме `redb` admin открывает БД через `Store::open_multi_writer`
(`redb::ConcurrencyMode::MultiWriter`): несколько процессов могут работать с
одним файлом, write-транзакции сериализуются, поэтому общий счётчик лимитера
не теряет обновления. Все реплики должны смотреть на один `AWG_DB_PATH`
(общий том) и использовать `redb`; смешивать `memory` и `redb` на одном файле
нельзя — `ExclusiveWriter` (режим `memory` и `awg-backup`) несовместим с
`MultiWriter`. CLI backup/restore по-прежнему требует остановленного admin.

## Производительность списков

Списки в `admin` не делают запросов на каждый элемент: связанные данные
загружаются bulk-методами и раскладываются в мапы.

- `GET /api/v1/devices`: `devices.list[_for_user]`, один
  `peers.by_devices(ids)` (порт `DevicePeerRepository`, дефолтная реализация
  фильтрует `list()`), один `interfaces.list()` и один `pools.list()`.
  `pool_net` вычисляется один раз на пул и кэшируется в
  `HashMap<pool_id, Ipv4Net>` на запрос; пулы индексируются по `group_id`,
  поэтому адреса считаются только из пулов группы устройства. Порядок
  устройств и JSON `DeviceView` не менялись.
- `GET /api/v1/interfaces`: `interfaces.list()`, `groups.list()`,
  `nodes.list()` и один `peers.list()`; число пиров на интерфейс — по
  `HashMap<interface_id, usize>`. Фильтр по группе применяется после загрузки.
- `GET /api/v1/groups`: `groups.list()`, `interfaces.list()` и
  `devices.list()`; счётчики интерфейсов и устройств — по мапам.

Обращений к репозиториям на запрос: devices — 4 (было `1 + 3N`), interfaces —
4 (было `3 + N`), groups — 3 (было `2 + G`), где `N` — число устройств,
`G` — групп. Это фиксируют тесты на фейковых репозиториях
(`bulk_views_use_constant_repository_calls`,
`interface_list_counts_peers_in_bulk`, `group_list_counts_in_bulk`).

`SnapshotBuilder` (desired state для worker) тоже собран без N+1:

- один `devices.list_all()` на весь build, устройства разложены по
  `group_id`; для каждого интерфейса берутся только устройства, у которых
  есть пир `(device_id, interface.id)`; `Device.interface_id` — лишь
  primary-интерфейс и больше не определяет попадание в desired state;
- один `peers.list()` (порт `DevicePeerRepository`), индекс
  `(device_id, interface_id) -> peer`; `peers_for` больше не вызывается;
  у устройства может быть несколько пиров (по одному на интерфейс),
  forwarding и лимиты считаются только по устройствам этого интерфейса;
- один `pools.list()` вместо `list_pools(group)` на интерфейс, пулы
  индексируются по `group_id`, а `parse_net` считается один раз на пул и
  переиспользуется для gateway и адресов пиров;
- `stats.used_bytes(User)` — один вызов на пользователя, результат кэшируется
  на build и используется и для `user_limits`, и для блокировки устройств;
- `tariffs.get` — один вызов на уникальный `tariff_id`;
- подписки для троттлинга читаются одним `latest_subscriptions()` на build
  (последняя подписка на каждого пользователя, включая `canceled`) и
  кэшируются по `user_id`; при выключенном биллинге (`AWG_BILLING_ENABLED=false`)
  `SnapshotBuilder.billing = None` и запрос не выполняется;
- расшифровка секретов (`peer_preshared_key`) выполняется только для пиров,
  реально попавших в `DesiredState`.

Для узла с `I` интерфейсами было `I` вызовов `devices.list_all` и
`I` вызовов `list_pools`, по одному `peers_for` на каждую пару
(интерфейс, устройство его группы) и `used_bytes(User)` на каждого
пользователя с устройствами у каждого интерфейса плюс повторно на каждое
устройство. Стало 3 вызова репозиториев (devices, peers, pools), один
`used_bytes` на пользователя с устройствами на узле и один `tariffs.get` на
уникальный тариф. Состав и порядок `DesiredState` не изменились — это
проверяют `snapshot_matches_previous_composition`,
`snapshot_bulk_loads_and_caches_usage` и `previous_n_plus_one_call_counts`
(последний фиксирует прежние счётчики вызовов на тех же seed-данных).

Что осталось: списки по-прежнему читают таблицы целиком, поэтому на больших
установках нужны пагинация и фильтры на уровне репозитория, а не в памяти.

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

## Эксплуатация

### Graceful shutdown

`awg-admin` перехватывает `SIGTERM` (Docker/Compose) и `SIGINT` (`Ctrl+C`).
После сигнала:

1. `/ready` начинает отвечать `503` (`reason=shutting_down`), `/health`
   продолжает отвечать `200`;
2. HTTP-сервер (`axum`) и worker gRPC (`tonic`) перестают принимать новые
   соединения и доигрывают in-flight запросы (`with_graceful_shutdown` /
   `serve_with_shutdown`);
3. фоновые задачи (prune refresh-токенов, аудита и traffic buckets, очистка
   rate limiter) получают сигнал через `watch`-канал, выходят из цикла и не
   мешают дренажу; лимитер перед выходом выполняет финальный `cleanup()`
   (для `redb` удаляет истёкшие записи `rate_limits`);
4. процесс ждёт не дольше `AWG_SHUTDOWN_GRACE_SECS` (по умолчанию 10 с), затем
   пишет warning и завершается с кодом 0.

`docker stop` по умолчанию даёт 10 секунд до `SIGKILL`, поэтому
`stop_grace_period` в compose должен быть не меньше grace (например `15s`).

### Таймауты

Запросы под `/api/v1` ограничены `tower_http::timeout::TimeoutLayer`
(`AWG_HTTP_TIMEOUT_SECS`, по умолчанию 30 с). По истечении клиент получает
`504 Gateway Timeout` с JSON-телом `{"error":"gateway_timeout", ...}`.
Ограничение тела запроса — `DefaultBodyLimit` (16 МиБ), оно одно и не
дублируется другими слоями.

### Пробы

| Путь | Назначение | Ответ |
| --- | --- | --- |
| `GET /api/v1/health` | liveness, не обращается к БД | `200` + `status=ok` |
| `GET /ready`, `GET /api/v1/ready` | readiness | `200` + `status=ready` и `schema_version`; `503` при shutdown, отсутствии или несовпадении версии схемы |

`/ready` открывает чтение метаданных redb и сравнивает версию схемы с
`CURRENT_SCHEMA_VERSION`. Ошибка чтения даёт `503`
(`reason=schema_unavailable`), другая версия — `503`
(`reason=schema_not_migrated`). Миграции выполняются синхронно до старта HTTP,
поэтому во время миграции сервер ещё не принимает трафик.

### Request ID и логи

Middleware `routes::request_id` берёт `X-Request-Id` клиента, если значение
похоже на идентификатор (`[A-Za-z0-9._-]`, до 128 символов), иначе генерирует
UUID v4. Заголовок возвращается в ответе и добавляется в span `http_request`
(`request_id`, `method`, `path`). `TraceLayer` логирует метод, путь, статус и
длительность; заголовки (`Authorization`, `Cookie`) и тела запросов не
логируются, пароли в логи не попадают.

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

`AWG_HTTP_TIMEOUT_SECS` (по умолчанию 30) задаёт таймаут запросов `/api`, а
`AWG_SHUTDOWN_GRACE_SECS` (по умолчанию 10) — окно дренажа при остановке. Оба
значения приводятся к минимуму 1 с.

В `development` отсутствующие `AWG_MASTER_KEY`/`AWG_JWT_SECRET` генерируются
эфемерно с предупреждением: после рестарта сохранённые секреты устройств
становятся нечитаемыми. Валидация вынесена в чистую функцию
`Config::from_input(ConfigInput)`, не зависящую от процесса.

## Безопасность HTTP

Заголовки задаются на периметре, приложение их не формирует: frontend —
nginx (`docker/nginx.conf`), API — middleware Traefik (`docker-compose.yml`).
Полная таблица значений и компромиссов — в [`SECURITY.md`](SECURITY.md).

- `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`) —
  middleware `frontend-hsts` и `admin-api-sec`, только на роутерах
  `websecure`; HTTP-entrypoint отвечает `308` и HSTS не отдаёт.
- `Content-Security-Policy` у frontend: `default-src 'self'`, скрипты только
  внешние из `/assets`, `style-src 'unsafe-inline'` из-за inline `style="..."`
  в компонентах, `connect-src 'self' ws: wss:` для REST и WebSocket статистики.
  У API CSP — `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`.
- `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Cross-Origin-Opener-Policy`, `Permissions-Policy` — на nginx; API получает
  nosniff/frame-deny/referrer из Traefik.
- nginx повторяет заголовки в location с `add_header` через snippet
  `docker/nginx-headers.conf`, потому что `add_header` в location отменяет
  наследование; `Cache-Control: immutable` не вытесняет CSP и остальные
  заголовки.

Проксирование не менялось: Traefik по-прежнему передаёт `/api` на admin по
HTTP/1.1 (backend принимает h2c на `:8080`), healthcheck `admin` идёт на
`http://localhost:8080/api/v1/health` напрямую, HTTP/3 терминируется Traefik
(`alt-svc: h3`). Middleware заголовков не трогают тела ответов и не мешают
WebSocket upgrade.

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
- `Tariff.interface_id` жёстко привязывает тариф к интерфейсу: новые устройства используют только его, а `interface_id`/`interface_ids` запроса игнорируются. Без привязки работают `interface_ids` запроса (по одному пиру на интерфейс), затем автоопределение (единственный включённый интерфейс ноды → группы).
- Устройство хранит `Device.interface_id` как primary (первый из списка) и создаёт по `DevicePeer` на каждый выбранный интерфейс; лимиты `max_devices` и суммарной полосы считаются на устройство, а IP выделяются каждому пиру из пулов группы его интерфейса. Набор интерфейсов не меняется через `PATCH /devices`.
- `GET /devices/{id}/profiles` и `GET /app/devices/{id}/configs` отдают профиль на каждый пир, отсортированный по имени интерфейса; `GET /app/devices/{id}/config` остаётся primary для совместимости.
- При превышении квоты device-скорость ограничивается до `1 kbps`; групповые лимиты применяются через HTB/tc.
- Подписка без доступа (`incomplete`, `past_due`, `suspended`, `canceled`) троттлит пользователя так же, как исчерпанная квота: `user_limits` и скорости пиров становятся `1 kbps`. Активная/пробная подписка и отсутствие подписки лимиты не меняют.
- Межнодовый forwarding (устройства на разных нодах) пока не реализован: forwarding строится только внутри интерфейса.

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

Схема была поднята до версии `2`. Миграция `v2_billing` идемпотентно открывает
таблицы и не трогает `users`, `tariffs`, `devices` и остальные данные.
Текущая версия схемы — `6` (шаг `v3_rate_limits` добавляет `rate_limits`,
`v4_device_interfaces` привязывает устройства к интерфейсу (схема `DevicePeer`
не менялась: уникальность `device_id + interface_id` уже допускает несколько
пиров на устройство),
`v5_user_nodes` привязывает пользователей к ноде по первому интерфейсу их
группы, `v6_user_emails` проставляет email пользователям без email:
`<login>@local`, при коллизии `+id`).
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
