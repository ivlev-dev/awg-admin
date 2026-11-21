# Эксплуатация awg-admin

## 1. Запуск и остановка

```bash
cp .env.example .env
$EDITOR .env                    # обязательно: AWG_ENV, домен, секреты
docker compose config >/dev/null   # проверка интерполяции без запуска
docker compose up -d --build   # admin/frontend; traefik: --profile tls
```

`docker-compose.yml` подставляет `AWG_ENV=production`, если переменная не
задана (fail-closed). В `production` admin не стартует без `AWG_MASTER_KEY`,
`AWG_JWT_SECRET` и сменённого `AWG_ADMIN_PASSWORD`; для локального запуска
поставьте `AWG_ENV=development` или используйте `docker-compose.dev.yml`.

С профилем `tls` поднимается Traefik вместе с `docker-socket-proxy`:

```bash
docker compose --profile tls up -d --build
```

Traefik не монтирует `/var/run/docker.sock`: провайдер ходит на
`tcp://docker-socket-proxy:2375`, у прокси разрешены только read-эндпоинты
(`CONTAINERS`, `NETWORKS`, `SERVICES`, `TASKS`, `EVENTS`, `PING`, `VERSION`).
Порт 80 публикуется для redirect на HTTPS (`AWG_TRAEFIK_HTTP_BIND`, по
умолчанию `0.0.0.0`); ACME работает через TLS-ALPN на 443.

Диагностика socket-proxy:

```bash
docker compose --profile tls logs --tail=50 docker-socket-proxy
docker compose --profile tls logs --tail=50 traefik | grep -i "docker provider\|error"
```

Если Traefik не видит контейнеры, а в логах прокси `403` — нужный эндпоинт не
входит в allowlist. Если контейнер не стартует на хосте с SELinux, смонтируйте
сокет с меткой (`/var/run/docker.sock:/var/run/docker.sock:ro,z`) — это
безопаснее, чем выдавать прокси `privileged`.

Сеть `web` зафиксирована подсетью `172.30.0.0/24` — на неё опирается
`AWG_TRUSTED_PROXIES`. Если сеть уже была создана compose с другой подсетью,
после обновления `docker compose up` ругнётся на несовпадение: остановите стек
(`docker compose down`) и удалите сеть (`docker network rm <project>_web`,
имя видно в `docker network ls`), затем поднимите снова. Данные в томе
`awg-data` при этом не затрагиваются.

С профилем worker:

```bash
docker compose --profile worker up -d --build
```

Worker не получает `.env`: в compose ему переданы только `AWG_NODE_ID`,
`AWG_NODE_TOKEN`, `AWG_GRPC_URL`, `AWG_GRPC_TLS_*`, `AWG_DRY_RUN`,
`AWG_COUNTERS_PATH`, `AWG_STATS_INTERVAL_SECS`. Значения этих переменных
подставляются из `.env` при интерполяции compose, но остальные секреты admin
(`AWG_MASTER_KEY`, `AWG_JWT_SECRET`, SMTP, платёжные ключи) в контейнер worker
не попадают.

Проверки:

```bash
curl --http2-prior-knowledge http://127.0.0.1:8080/api/v1/health
curl -fsS http://127.0.0.1:8081/ | head -n 5
docker compose ps
docker compose logs --tail=100 admin
docker compose logs --tail=100 worker
```

Остановка и очистка:

```bash
docker compose down
docker compose down -v --remove-orphans
```

`make clean` эквивалентен `docker compose down -v --remove-orphans` и удаляет том `awg-data` с БД. Локальная разработка:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Dev-файл поднимает admin из цели `dev` (toolchain + cargo-watch) и Vite; порты
привязаны к `127.0.0.1` (8080, 9090, 5173), `AWG_ENV=development` по умолчанию
(значение из `.env` имеет приоритет), `AWG_TRUSTED_PROXIES=127.0.0.1/32`.
В контейнер монтируются только `backend/`, `Cargo.toml`, `Cargo.lock` и
`.cargo/`. Первый старт admin дольше обычного: образ цели `dev` собирает
`cargo-watch`, а `frontend` ждёт healthcheck admin. Без Docker:

```bash
cargo run -p awg-admin
cd frontend && corepack enable && pnpm install && pnpm dev
```

Версия pnpm берётся из `packageManager` в `frontend/package.json`
(`corepack enable` один раз на машину).

Frontend доступен на `http://localhost:5173`, admin на `http://localhost:8080`, gRPC на `localhost:9090`.

## 2. Секреты

- `AWG_MASTER_KEY` — 32 байта в base64 (`openssl rand -base64 32`), используется `Sealer` (ChaCha20-Poly1305) для шифрования приватных ключей устройств и интерфейсов в redb. В `production` старт завершается ошибкой, если ключ не задан, не base64 или длина не 32 байта. Потеря ключа делает сохранённые секреты нечитаемыми; менять ключ на данных production нельзя.
- `AWG_JWT_SECRET` — не короче 32 байт в `production` (`openssl rand -base64 48`). Влияет на все JWT; смена секрета инвалидирует выданные токены.
- `AWG_ADMIN_PASSWORD` — в `production` не пустой и не равен `admin12345`; если переменная не задана, применяется дефолт `admin12345`, и старт завершается ошибкой (`AWG_ADMIN_PASSWORD must be changed…`). Seed-администратор создаётся при первом запуске из `AWG_ADMIN_EMAIL`/`AWG_ADMIN_PASSWORD`; переменная `AWG_ADMIN_LOGIN` удалена, вход только по email.
- `AWG_TRUSTED_PROXIES` — список IP/CIDR через запятую. `X-Forwarded-For` и `X-Real-IP` принимаются только от перечисленных адресов; клиентский IP для rate limit/аудита — первый справа хоп XFF, не входящий в trusted-сети. `docker-compose.yml` фиксирует подсеть сети `web` (`172.30.0.0/24`) и по умолчанию подставляет её же в `AWG_TRUSTED_PROXIES`; при смене подсети обновите переменную. Локально достаточно `127.0.0.1/32` (это же значение в `docker-compose.dev.yml`).
- `AWG_DEV_MAIL_TOKEN` — токен для `GET/DELETE /api/v1/dev/mail` вне production. Без него маршрут требует обычный access token администратора. В `production` маршрут всегда отвечает `404`, а dev-mailbox и токены в письмах не логируются.
- `AWG_JWT_ISSUER` и `AWG_JWT_AUDIENCE` по умолчанию `awg-admin`; пустые значения заменяются значением по умолчанию.
- SMTP: `AWG_MAIL_MODE=log|smtp`, `AWG_SMTP_URL=smtp://user:pass@host:port` (обязательный STARTTLS, порт 587) или `smtps://…` (implicit TLS, порт 465), `AWG_SMTP_FROM`, `AWG_PUBLIC_URL` для ссылки подтверждения email. Открытый SMTP без TLS не поддерживается.
- `AWG_APP_VERIFY_URL` — deep link мобильного приложения для подтверждения email (`umbravpn://verify` по умолчанию); в письме добавляется `{AWG_APP_VERIFY_URL}?token=…`.
- `AWG_ENV` — `production` или `development`. Код по умолчанию считает окружение `development`, но `docker-compose.yml` подставляет `production` (fail-closed). В production обязательны `AWG_MASTER_KEY`, `AWG_JWT_SECRET` и `AWG_ADMIN_PASSWORD`, отличный от `admin12345`.
- `AWG_REGISTRATION_ENABLED` (по умолчанию `true`) — самостоятельная регистрация; `false` даёт `403 registration_disabled`.
- `AWG_ALLOW_WS_TOKEN` (по умолчанию `false`) — совместимость со старым WebSocket-флоу `?token=`. Включайте только на время миграции клиентов: токен в query попадает в логи и историю.
- `AWG_LOGIN_ACCOUNT_RATE_LIMIT` (20) и `AWG_LOGIN_IP_RATE_LIMIT` (30) — дополнительные лимиты логина по email и по IP; `AWG_WEBHOOK_RATE_LIMIT` (120) и `AWG_WEBHOOK_WINDOW_SECS` (60) — лимит webhook по IP.
- Без `.env` compose в production **не** стартует: admin завершится с ошибкой о недостающих секретах. Эфемерные `AWG_MASTER_KEY`/`AWG_JWT_SECRET` генерируются только при `AWG_ENV=development` (или при прямом запуске без compose). После рестарта с эфемерным ключом секреты устройств становятся нечитаемыми. Проверка:

```bash
# только для development: предупреждение об эфемерном ключе
docker compose logs admin | grep -i "ephemeral"
```

## 3. Backup и restore redb

БД — один файл `/data/awg-admin.redb` (`AWG_DB_PATH`), том `awg-data`. Текущая версия схемы — `CURRENT_SCHEMA_VERSION = 15` (таблица `meta`, ключ `schema_version`). Проверка версии открытой базы: `Store::schema_version()`.

Методы `Store`:

- `Store::backup_to(path)` — горячий логический снапшот без остановки admin: одна read-транзакция даёт консистентный снимок, все таблицы и `schema_version` пишутся в новый файл. Порядок: временный файл `<path>.tmp-<pid>-<n>` → запись → повторное открытие с проверкой целостности и версии → `fsync` → атомарный `rename`. При ошибке временный файл удаляется, прежний backup не трогается. Нельзя указать путь самой открытой БД (`BackupPathConflict`).
- `Store::restore_from(path)` — восстановление в работающую базу: backup открывается с проверкой целостности, версия должна строго совпадать с текущей (`IncompatibleBackup`/`UnversionedBackup` иначе, база не меняется). Все таблицы удаляются и заново наполняются в одной write-транзакции вместе с версией; записи после backup исчезают. Файл backup должен быть доступен на запись (redb проверяет целостность только при read-write open).
- `Store::replace_file_from(backup, target)` — офлайн-замена файла: копия backup во временный файл рядом с `target`, проверка целостности и версии, `fsync`, `rename`. Требует остановленного admin: файл БД открыт эксклюзивно.

### Плановая ротация backup

Admin умеет делать горячий снапшот по расписанию через `Store::backup_to` — без
остановки и без блокировки записи:

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `AWG_BACKUP_DIR` | пусто | каталог backup; пусто — планировщик выключен |
| `AWG_BACKUP_INTERVAL_SECS` | `86400` | интервал, секунды; `0` — выключить |
| `AWG_BACKUP_KEEP` | `7` | сколько последних файлов хранить (минимум 1) |

Файлы называются `awg-admin-YYYYMMDDTHHMMSSZ.redb`; после каждого снимка старые
удаляются, остаётся `AWG_BACKUP_KEEP` самых новых. Первый снимок делается сразу
после старта. Временные файлы `*.tmp-*` (остатки прерванной записи) удаляются при
старте планировщика и после каждого успешного backup, если им больше часа. В Docker смонтируйте каталог backup отдельным томом, иначе файлы
будут лежать в контейнере:

```yaml
volumes:
  - ./backups:/backups
# environment:
#   AWG_BACKUP_DIR: /backups
```

Права на каталог и файлы: backup содержит приватные ключи устройств, поэтому
каталог создаётся/используется с `0700`, а файлы — `0600` (владелец —
пользователь, под которым работает admin, в образе это uid 10001). Это делает
сам планировщик на Unix; при копировании на другой носитель права нужно
сохранить:

```bash
install -d -m 700 -o 10001 -g 65534 ./backups
chmod 600 ./backups/*.redb
```

Если каталог смонтирован с другой ФС без поддержки Unix-прав (например, некоторые
сетевые тома), полагайтесь на права точки монтирования и шифруйте внешние
копии.

Снимок проверяется на целостность (как `Store::backup_to`) и пригоден для
`awg-backup restore`, в том числе для старых версий схемы (они обновляются
миграциями, см. раздел «CLI `awg-backup`»). Планировщик не заменяет внешнюю
ротацию: копируйте каталог на отдельный носитель.

### CLI `awg-backup`

Бинарник собирается вместе с admin:

```bash
cargo build --release -p awg-admin --bin awg-backup
# запускать из ./target/release/awg-backup или установить в PATH
```

`docker/Dockerfile.admin` копирует в образ оба бинарника (`awg-admin` и `awg-backup`), поэтому команды можно выполнять через `docker compose exec admin awg-backup ...` (при остановленном admin).

CLI работает с файлом БД без запуска admin, но redb открывает файл эксклюзивно, поэтому **перед backup и restore остановите admin**. На занятом файле команда завершится с кодом `1` и сообщением «файл ... занят».

```bash
docker compose stop admin
export AWG_DB_PATH=/data/awg-admin.redb   # или указывайте --db в каждой команде
```

Путь к БД берётся из `--db`, иначе из `AWG_DB_PATH`.

```bash
# копия БД с проверкой целостности; существующий файл не перезаписывается без --force
awg-backup backup --db /data/awg-admin.redb --out /backup/awg-$(date +%Y%m%d).redb

# версия схемы, размер и таблицы (включая meta)
awg-backup info --db /data/awg-admin.redb

# восстановление одной write-транзакцией: записи после backup исчезают, файл БД остаётся прежним
awg-backup restore --db /data/awg-admin.redb --from /backup/awg-20260101.redb

# офлайн-замена файла целиком: временный файл рядом с БД → проверка → fsync → атомарный rename
awg-backup restore --db /data/awg-admin.redb --from /backup/awg-20260101.redb --offline

docker compose start admin
```

`backup` удерживает эксклюзивную блокировку БД, копирует файл во временный `<out>.tmp-<pid>-<n>`, проверяет копию открытием redb с `check_integrity_on_open`, синхронизирует и заменяет `--out` атомарным `rename`. Существующий backup без `--force` не трогается, путь `--out`, совпадающий с БД, запрещён. `info` открывает БД read-only и не меняет её, но также требует остановленного admin.

`restore` сверяет `meta.schema_version` backup с `CURRENT_SCHEMA_VERSION`. Backup с **текущей** версией восстанавливается как есть. Backup со **старой** версией (`1 … CURRENT-1`) сначала обновляется миграциями из `MIGRATIONS` до `CURRENT_SCHEMA_VERSION`, после чего данные переносятся в БД. Backup с **новой** версией (`> CURRENT`) и backup без версии отклоняются с кодом `1`, БД не меняется.

Режимы: по умолчанию `Store::restore_from_with_sealer` (одна транзакция в текущей БД), `--offline` — `Store::replace_file_from_with_sealer` (полная замена файла без открытия текущей БД; помогает, если файл БД повреждён или не открывается этим бинарником). Оба режима требуют остановленного admin.

Миграция старых backup выполняется на временной копии (`<имя>.restore-<pid>-<n>` рядом с БД или в `/tmp`): исходный файл backup не открывается на запись и не изменяется. Временная копия удаляется после успеха или ошибки. `restore` идемпотентен: один и тот же старый backup можно восстанавливать повторно.

Если для миграции нужен master key (шаг `10 → 11` шифрует старые plaintext-токены `share_links`), задайте `AWG_MASTER_KEY` — тот же ключ, что у admin:

```bash
# online: миграция копии backup выполняется в процессе restore
AWG_MASTER_KEY='<base64 32 байта>' awg-backup restore --db /data/awg-admin.redb --from /backup/old.redb

# offline: ключ берётся только из окружения и не попадает в argv/history
AWG_MASTER_KEY='<base64 32 байта>' awg-backup restore --db /data/awg-admin.redb --from /backup/old.redb --offline
```

Без `AWG_MASTER_KEY` такой backup завершится ошибкой `StorageError::Secret` и подсказкой задать ключ; БД и backup остаются нетронутыми. Если старые share-ссылки уже были зашифрованы (например, backup снят после миграции `10 → 11`), ключ не требуется.

Коды выхода: `0` — успех, `1` — ошибка операции (файл занят, файла нет, backup новее поддерживаемой схемы, нет версии схемы, не задан `AWG_MASTER_KEY` для старых share-ссылок, backup существует без `--force`), `2` — ошибка аргументов. `awg-backup --help` — справка.

Проверка после restore:

```bash
awg-backup info --db /data/awg-admin.redb        # версия схемы и таблицы
docker compose start admin
curl -fsS http://127.0.0.1:8080/api/v1/health
docker compose logs --tail=50 admin              # нет ошибок миграции и целостности
```

Затем войти в панель и проверить пользователей, ноды, тарифы и последние аудит-события.

Проверка версии: `restore` обновляет старые backup автоматически, если для всех шагов хватает данных и (при необходимости) `AWG_MASTER_KEY`; иначе он отклоняется, а БД остаётся прежней. Backup новее `CURRENT_SCHEMA_VERSION` не восстанавливается — используйте `awg-backup` из той же версии admin, что создала backup. Для отката на предыдущую версию admin берите `awg-backup` из того же тега, что и возвращаемый admin. Схема новее поддерживаемой даёт `StorageError::SchemaTooNew` (`store schema version N is newer than supported version M`) и admin не стартует. Миграции: реестр `MIGRATIONS`; шаги `1 → 2` (`v2_billing`), `2 → 3` (`v3_rate_limits`), `3 → 4` (`v4_device_interfaces`), `4 → 5` (`v5_user_nodes`), `5 → 6` (`v6_user_emails`), `6 → 7` (`v7_idempotency`), `7 → 8` (`v8_peer_ids`), `8 → 9` (`v9_device_page_index`), `9 → 10` (`v10_user_page_index`), `10 → 11` (`v11_share_token_hash`, шифрует legacy-токены и требует master key), `11 → 12` (`v12_user_search_index`), `12 → 13` (`v13_user_identity`: удаляет `login`, заполняет пропущенные email из старого логина, нормализует email, добавляет `full_name: null`, перестраивает `user_page_index` и `user_search_index`), `13 → 14` (`v14_lookup_indexes`: заполняет индекс поиска пользователей по email), `14 → 15` (`v15_access_epochs`: создаёт `user_access_epochs`) не удаляют пользовательские записи; все шаги и запись версии выполняются в одной write-транзакции, ошибка откатывает данные и версию.

## 4. Очистка устаревших данных

Фоновая задача admin раз в час (и сразу при старте) удаляет устаревшие записи:

- `idempotency` — старше 24 часов (`expires_at`);
- `email_verifications` — истёкшие токены подтверждения и сброса пароля;
- `share_links` — истёкшие и отозванные (`revoked_at`) старше 30 дней; отзыв
  хранится как история, `revoked_at` не даёт скачать конфиг.

Очистка выполняется в `spawn_blocking`, чтобы не блокировать runtime. Audit
чистится отдельно по `AWG_AUDIT_RETENTION_DAYS` (раздел 7), трафик — по
настройке stats retention.

## 5. Метрики

`GET /metrics` отдаёт реестр Prometheus text-формата `0.0.4`. С токеном:

```bash
curl -fsS -H "Authorization: Bearer $AWG_METRICS_TOKEN" \
  http://127.0.0.1:8080/metrics
```

`AWG_METRICS_TOKEN` включает обязательный `Authorization: Bearer <token>`;
без корректного токена — `401` (сравнение constant-time). В `production` при
пустом токене `/metrics` отвечает `404` (эндпоинт скрыт), в `development` —
открыт. Порт `8080` не публикуйте наружу.

Пример scrape-конфига Prometheus:

```yaml
scrape_configs:
  - job_name: awg-admin
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets: ["127.0.0.1:8080"]
    authorization:
      type: Bearer
      credentials: "<AWG_METRICS_TOKEN>"
```

Ключевые метрики:

| Метрика | Тип | Метки |
| --- | --- | --- |
| `awg_http_requests_total` | counter | `method`, `status` |
| `awg_http_request_duration_seconds` | histogram | `method` |
| `awg_auth_logins_total` | counter | `result=success/failure/rate_limited` |
| `awg_rate_limited_total` | counter | `scope=login/refresh` |
| `awg_audit_events_total` | counter | `action`, `status` |
| `awg_worker_online` | gauge | — |

Алерты: `awg_worker_online == 0` дольше 2 минут; рост `awg_rate_limited_total`; `awg_auth_logins_total{result="failure"}`. `/metrics` сам не учитывается в `awg_http_requests_total`.

## 6. Логи

`AWG_LOG_FORMAT=text|json` (по умолчанию `text`), уровень `RUST_LOG` (по умолчанию `info`, `EnvFilter`). При `json` включается `tracing_subscriber` JSON с полями `timestamp`, `level`, `target`, `fields`. Пример сбора в Loki через Vector (чтение stdout контейнера):

```toml
[sources.docker]
type = "docker_logs"
include_containers = ["awg-admin", "awg-worker"]

[transforms.parse]
type = "remap"
inputs = ["docker"]
source = '''
. = parse_json!(.message)
'''

[sinks.loki]
type = "loki"
inputs = ["parse"]
endpoint = "http://loki:3100"
encoding.codec = "json"
```

В логах не пишутся приватные ключи устройств/интерфейсов, пароли и JWT-секреты; тела mutating-запросов middleware не читает. HTTP-запросы логируются `TraceLayer`.

### OpenTelemetry

Экспорт трейсов по OTLP/gRPC включается переменной
`AWG_OTEL_ENDPOINT` (например `http://127.0.0.1:4317`). Пустое значение —
трейсинг выключен, накладных расходов нет. При включённом экспорте существуют
спаны HTTP-запросов, gRPC и фоновых задач; `TraceLayer` и `tracing` работают как
раньше. Ошибка инициализации экспортёра не останавливает сервис: в stderr
пишется предупреждение, логирование остаётся локальным. Сэмплирование —
`ParentBased(AlwaysOn)`; для продакшена поднимите OTLP-collector (Tempo,
Jaeger, OTel Collector) и при необходимости ограничьте `RUST_LOG`.

## 7. Аудит

`GET /api/v1/audit` доступен только роли `admin`; записи в обратном хронологическом порядке, ответ `{"items":[...],"next_cursor":"..."}`. Фильтры (AND): `limit` (1..500, по умолчанию 100), `before` (курсор `<микросекунды>:<uuid>`), `action` (например `POST`, `DELETE`), `entity` (например `devices`), `actor` (регистронезависимое вхождение), `status` (HTTP-код), `from`/`to` (Unix-секунды, включительно). `from > to` — `400 invalid_filter`.

Retention: `AWG_AUDIT_RETENTION_DAYS` (по умолчанию 90; 0 — не чистить) — записи старше удаляются фоновой задачей раз в сутки. UI раздел `/audit` (admin only). Автоматически фиксируются mutating-запросы `POST`/`PATCH`/`PUT`/`DELETE` под `/api/v1` со статусом `2xx` и `4xx` (401 без учётных данных не пишется); вход фиксируется контроллером. `entity` — путь без идентификатора, `entity_id` — первый UUID из пути; share-токены в пути и `entity_id` заменяются на `sha256:<12 hex>`. `ip` — первый справа недоверенный хоп `X-Forwarded-For`/`X-Real-IP` при доверенном peer, иначе адрес peer.

## 8. Квоты

```bash
TOKEN=$(curl -fsS -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local","password":"<пароль>"}' | jq -r .access_token)
curl -fsS -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/quota
curl -fsS -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/quota/users
```

`GET /api/v1/quota` возвращает `QuotaView` текущего пользователя: `used_bytes`, `quota_bytes`, `exceeded`, `remaining_bytes`, `percent`, `period_start`, `period_end`, `reset_at`. `GET /api/v1/quota/users` для admin — массив `QuotaUserView` по всем пользователям с тарифом, для обычного пользователя — массив из одного элемента со своей квотой. При превышении (`used_bytes >= quota_bytes`) snapshot ограничивает группу и устройства пользователя скоростью 1 kbps. Проверка на worker:

```bash
tc -s class show dev <ifname> | grep -i '1kbit\|1kibit'
```

Без квоты (`quota_bytes=null`) ограничение не применяется.

## 9. Worker и dataplane

Переменные: `AWG_NODE_ID`, `AWG_NODE_TOKEN`, `AWG_DRY_RUN=false`, `AWG_STATS_INTERVAL_SECS=2`, `AWG_GRPC_URL`, `AWG_COUNTERS_PATH=/var/lib/awg-worker/counters.json`. Запуск:

```bash
AWG_DRY_RUN=true docker compose --profile worker up -d --build
AWG_DRY_RUN=false docker compose --profile worker up -d --build
```

Проверка применения состояния:

```bash
docker compose logs --tail=100 worker | grep -E "worker applied state|ApplyResult|error"
ip -d link show <ifname>
awg show <ifname>
cat /var/lib/awg-worker/counters.json | jq .
```

Скрипты приёмки (по умолчанию dry-run, разрушающие действия только с `--apply`):

```bash
./scripts/verify-kernel.sh
./scripts/verify-kernel.sh --apply --netns
./scripts/verify-dataplane.sh
./scripts/verify-dataplane.sh --apply
sudo -E PANEL_PASSWORD=... ./scripts/verify-hairpin.sh --apply --group "VPN Pilot"
./scripts/verify-tls.sh --static
./scripts/verify-tls.sh --local --no-hsts-check --no-static
```

Типовые ошибки:

- `failed to read counters ... Operation not supported (os error 95)` — устаревший
  дефект: с 16.11.2026 `WG_CMD_GET_DEVICE` отправляется с `NLM_F_DUMP`. Если
  ошибка вернулась, проверьте флаги запроса в `worker/src/infrastructure/netlink.rs`.
- `tc qdisc replace ... root ... htb` и `Change operation not supported` —
  устаревший дефект: qdisc пересоздаётся через `del` + `add`. Если вернулся,
  проверьте `root_reset_commands`/`ingress_reset_commands` в `tc.rs`.
- трафик пропадает на 10–30 с после PATCH — endpoint'ы сбрасывались
  `REPLACE_PEERS`; с 18.11.2026 пиры применяются дельтой.
- `tc filter add` не идемпотентен, правила накапливаются.
- без тарифа у пользователя `user_limits` пуст и tc не применяется; пул без `gateway` даёт интерфейс без адреса.
- worker не чистит интерфейс, удалённый из desired state, если worker был остановлен в момент удаления.

### 9.1 TLS и mTLS для worker gRPC

Канал admin↔worker поддерживает три режима:

| Режим | Admin | Worker | Когда использовать |
|---|---|---|---|
| plaintext (по умолчанию) | — | — | одна доверенная сеть, порт `9090` не опубликован |
| server-auth TLS | `AWG_GRPC_TLS_CERT`/`KEY` | `AWG_GRPC_TLS_CA`/`DOMAIN`/`SYSTEM_ROOTS` | канал пересекает недоверенную сеть |
| mTLS | + `AWG_GRPC_TLS_CLIENT_CA` | + `AWG_GRPC_TLS_CLIENT_CERT`/`KEY` | нужно отсекать подключения без доверенного клиентского сертификата |

Plaintext остаётся допустимым на loopback. В production admin **не стартует**
с plaintext на не-loopback адресе (`AWG_GRPC_BIND=0.0.0.0:9090` и без TLS —
ошибка); на loopback пишется предупреждение. При включённом TLS без
`AWG_GRPC_TLS_CLIENT_CA` — предупреждение, что клиентский сертификат не
требуется.

Worker по-прежнему не анализирует `AWG_GRPC_URL` и не отказывается от
plaintext к удалённому адресу: fail-closed реализован только на стороне admin.
Поэтому TLS для канала за пределами доверенной сети включается вручную. Это
остаточный риск (см. `docs/SECURITY.md`); проверяйте конфигурацию штатной
командой:

```bash
docker compose exec worker env | grep AWG_GRPC_
# ожидаемо: TLS_CA+DOMAIN (или SYSTEM_ROOTS=true) для канала вне доверенной сети
```

#### Выпуск CA и сертификатов (openssl)

Все команды выполняются в каталоге, который не попадает в git (например
`./certs`, он монтируется в контейнеры только для чтения).

CA (один раз, хранится отдельно от серверных ключей):

```bash
mkdir -p certs && cd certs
openssl genrsa -out grpc-ca.key 4096
openssl req -x509 -new -nodes -key grpc-ca.key -sha256 -days 3650 \
  -subj "/CN=awg-grpc-ca" -out grpc-ca.crt
chmod 600 grpc-ca.key
```

Серверный сертификат admin на внутреннее имя `admin.internal`
(`grpc.ext`):

```ini
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:admin.internal
```

```bash
openssl genrsa -out grpc.key 4096
openssl req -new -key grpc.key -subj "/CN=admin.internal" -out grpc.csr
openssl x509 -req -in grpc.csr -CA grpc-ca.crt -CAkey grpc-ca.key \
  -CAcreateserial -days 825 -sha256 -extfile grpc.ext -out grpc.crt
chmod 600 grpc.key
```

Клиентский сертификат воркера (отдельный на каждую ноду, `CN` —
`worker-<node-id>`; `worker.ext`):

```ini
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
```

```bash
openssl genrsa -out worker-<node-id>.key 4096
openssl req -new -key worker-<node-id>.key \
  -subj "/CN=worker-<node-id>" -out worker-<node-id>.csr
openssl x509 -req -in worker-<node-id>.csr -CA grpc-ca.crt -CAkey grpc-ca.key \
  -CAcreateserial -days 825 -sha256 -extfile worker.ext \
  -out worker-<node-id>.crt
chmod 600 worker-<node-id>.key
```

Для server-auth TLS без mTLS достаточно `grpc.crt`/`grpc.key`; можно
использовать и самоподписанный сертификат (тогда worker указывает его в
`AWG_GRPC_TLS_CA`).

#### Admin

```bash
AWG_GRPC_TLS_CERT=/etc/awg/tls/grpc.crt
AWG_GRPC_TLS_KEY=/etc/awg/tls/grpc.key
# mTLS: PEM CA, которому доверяем клиентские сертификаты
AWG_GRPC_TLS_CLIENT_CA=/etc/awg/tls/worker-ca.crt
```

Правила и ошибки старта:

- `AWG_GRPC_TLS_CERT` и `AWG_GRPC_TLS_KEY` задаются только вместе, иначе
  `AWG_GRPC_TLS_CERT and AWG_GRPC_TLS_KEY must be set together`.
- `AWG_GRPC_TLS_CLIENT_CA` допустим только вместе с CERT/KEY, иначе
  `AWG_GRPC_TLS_CLIENT_CA requires AWG_GRPC_TLS_CERT and AWG_GRPC_TLS_KEY`.
- Файлы читаются при старте; ошибки чтения и не-PEM содержимое называют
  конкретную переменную (`failed to read AWG_GRPC_TLS_CLIENT_CA ...`,
  `AWG_GRPC_TLS_CLIENT_CA ... does not contain a PEM certificate`).
- При заданном `AWG_GRPC_TLS_CLIENT_CA` сервер требует клиентский
  сертификат и проверяет цепочку до этого CA; подключение без сертификата
  или с сертификатом чужого CA обрывается на TLS-рукопожатии.
- В одном PEM-файле можно перечислить несколько CA (bundle) — это
  используется при ротации. Файл перечитывается только при рестарте admin.

#### Worker

```bash
AWG_GRPC_URL=https://admin.internal:9090
AWG_GRPC_TLS_CA=/etc/awg/tls/grpc-ca.crt
AWG_GRPC_TLS_DOMAIN=admin.internal
AWG_GRPC_TLS_CLIENT_CERT=/etc/awg/tls/worker-<node-id>.crt
AWG_GRPC_TLS_CLIENT_KEY=/etc/awg/tls/worker-<node-id>.key
```

- TLS включается при заданном `AWG_GRPC_TLS_CA`, `AWG_GRPC_TLS_DOMAIN` или
  `AWG_GRPC_TLS_SYSTEM_ROOTS=true`; иначе канал plaintext.
- `AWG_GRPC_TLS_CLIENT_CERT` и `AWG_GRPC_TLS_CLIENT_KEY` задаются только
  вместе и только при включённом TLS. Иначе старт завершается ошибкой
  `... must be set together` / `... requires TLS to be enabled`.
- `AWG_GRPC_TLS_DOMAIN` по умолчанию берётся из host `AWG_GRPC_URL`; для
  IP-адреса задайте DNS-имя из SAN сертификата.
- Без `AWG_GRPC_TLS_CA` используются системные корни
  (`AWG_GRPC_TLS_SYSTEM_ROOTS=true` или `DOMAIN`).

#### Compose

Смонтируйте каталог с сертификатами в оба контейнера только для чтения
(пример `docker-compose.override.yml`):

```yaml
services:
  admin:
    volumes:
      - ./certs:/etc/awg/tls:ro
  worker:
    volumes:
      - ./certs:/etc/awg/tls:ro
```

Переменные передаются через `.env` (файл в `.gitignore`); сами сертификаты
и ключи в git не коммитятся. Compose уже пробрасывает
`AWG_GRPC_TLS_CLIENT_CA` в admin и `AWG_GRPC_TLS_CLIENT_CERT`/`KEY` в worker.

#### Проверка

```bash
# без клиентского сертификата сервер должен отказать
openssl s_client -connect admin.internal:9090 -CAfile certs/grpc-ca.crt \
  -alpn h2 </dev/null

# с клиентским сертификатом рукопожатие проходит
openssl s_client -connect admin.internal:9090 -CAfile certs/grpc-ca.crt \
  -cert certs/worker-<node-id>.crt -key certs/worker-<node-id>.key \
  -alpn h2 </dev/null
```

Ожидаемо: первый вызов завершается ошибкой (`certificate required`), второй
показывает `Verify return code: 0 (ok)`. В логах admin при старте:
`worker gRPC listening tls=true mtls=true`.

#### Ротация

- **Клиентский сертификат воркера.** Выпустите новый, обновите переменные
  ноды и перезапустите worker. Старый сертификат продолжает работать до
  истечения срока: CRL/OCSP не поддерживаются.
- **Отзыв доступа.** Единственный надёжный способ — ротация клиентского CA:
  выпустите новый CA, подпишите им сертификаты всех воркеров, положите в
  `AWG_GRPC_TLS_CLIENT_CA` bundle из старого и нового CA, перезапустите
  admin, обновите воркеры, затем уберите старый CA из bundle и перезапустите
  admin ещё раз.
- **Серверный сертификат admin.** Замените `grpc.crt`/`grpc.key`,
  перезапустите admin. Worker доверяет CA, а не листовому сертификату,
  поэтому его переменные менять не нужно.
- **CA.** Храните ключ CA offline; при компрометации меняйте и серверный, и
  клиентские сертификаты.
- **Токен ноды** (`AWG_NODE_TOKEN`) ротируется независимо от TLS.

#### Ограничения

- mTLS аутентифицирует ноду на транспорте, но авторизация по-прежнему идёт
  по `AWG_NODE_TOKEN` в `Hello`; admin не связывает CN сертификата с
  `node_id` и не ведёт allowlist отпечатков.
- Нет CRL/OCSP и срока жизни сессии: отзыв возможен только ротацией CA.
- Один файл `AWG_GRPC_TLS_CLIENT_CA`, читается при старте; изменения
  требуют рестарта admin.
- Plaintext и server-auth TLS без mTLS остаются допустимыми режимами;
  mTLS не включается автоматически.


## 10. Инциденты

- Admin недоступен: проверить `docker compose ps`, `docker compose logs admin`, healthcheck `curl -fsS http://127.0.0.1:8080/api/v1/health`. Частые причины: неверные секреты в `production` (старт завершается ошибкой), схема БД новее поддерживаемой, заполненный диск, отсутствие тома `awg-data`.
- Worker offline: `docker compose ps`, `docker compose logs worker`, `GET /api/v1/nodes` (`online`). Проверить `AWG_NODE_ID`/`AWG_NODE_TOKEN`, `AWG_GRPC_URL`, доступность порта `9090` (не публиковать наружу).
- Схема новее: сообщение `store schema version N is newer than supported version M`; откатить admin к версии, создавшей БД, или выполнить миграции.
- Диск: проверить `docker system df`, место под `/data` и `/var/lib/awg-worker`; backup перед очисткой.
- Сертификат: `verify-tls.sh`, проверить `TRAEFIK_ACME_EMAIL`, том `traefik-letsencrypt`, домен задаётся `AWG_DOMAIN` (`Host(...)` в compose есть, HSTS настроен); ACME на реальном домене проверяется на стенде.
- Rate limit: `awg_rate_limited_total`, параметры `AWG_LOGIN_RATE_LIMIT`, `AWG_REFRESH_RATE_LIMIT` и окна; 0 отключает лимит. Режим хранилища — `AWG_RATE_LIMIT_STORE`: `memory` (по умолчанию, счётчики у каждой реплики свои) или `redb` (общая таблица `rate_limits` в БД, файл открывается в redb `MultiWriter` для нескольких процессов). При нескольких репликах включайте `redb` на всех и давайте им общий `AWG_DB_PATH`; записи старше окна удаляются раз в час и при shutdown.

## 11. Обновление

1. Backup БД (раздел 3) и `.env`.
2. Обновить образы: `docker compose build --pull` или `docker compose up -d --build   # admin/frontend; traefik: --profile tls`.
   Базовые образы запинены по digest: `--pull` не «подтянет» более новый тег,
   пока digest в `docker/Dockerfile.*` не обновлён (это делает Dependabot).
   Для Traefik digest задан в `docker-compose.yml`; `docker compose pull`
   обновит только тот digest, который указан.
3. Запустить admin, применятся миграции redb (одна write-транзакция, при ошибке откат).
4. Проверить health, логи, версию схемы.
5. Запустить worker: `docker compose --profile worker up -d --build`.
6. Профиль `tls`: проверить, что Traefik поднялся вместе с `docker-socket-proxy`
   (`docker compose --profile tls ps`) и контейнеры видны провайдеру.

Откат: остановить admin, вернуть прежний образ/`.env`, восстановить БД из backup командой `awg-backup restore --offline` (backup не должен быть новее возвращаемого admin; более старый будет обновлён миграциями, раздел 3), запустить. Не менять `AWG_MASTER_KEY` при откате.

## 12. Полезные команды

```bash
make build
make ps
make logs
make health
docker compose config --quiet
docker network inspect awg-admin_web --format '{{(index .IPAM.Config 0).Subnet}}'
docker compose --profile tls ps
docker compose exec admin sh -c 'id'
docker run --rm --entrypoint sh awg-admin:latest -c 'id'
docker run --rm --entrypoint sh awg-worker:latest -c 'ip -V; tc -V; nft --version; modprobe --version'
cargo test --workspace
cd frontend && pnpm typecheck && pnpm test && pnpm arch:check && pnpm build
# нагрузочный тест REST (нужен запущенный admin и wrk)
AWG_LOADTEST_PASSWORD=... ./scripts/loadtest-rest.sh
```