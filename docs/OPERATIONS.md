# Эксплуатация awg-admin

## 1. Запуск и остановка

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
```

С профилем worker:

```bash
docker compose --profile worker up -d --build
```

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
cargo run -p awg-admin
cd frontend && pnpm install && pnpm dev
```

Frontend доступен на `http://localhost:5173`, admin на `http://localhost:8080`, gRPC на `localhost:9090`.

## 2. Секреты

- `AWG_MASTER_KEY` — 32 байта в base64 (`openssl rand -base64 32`), используется `Sealer` (ChaCha20-Poly1305) для шифрования приватных ключей устройств и интерфейсов в redb. В `production` старт завершается ошибкой, если ключ не задан, не base64 или длина не 32 байта. Потеря ключа делает сохранённые секреты нечитаемыми; менять ключ на данных production нельзя.
- `AWG_JWT_SECRET` — не короче 32 байт в `production` (`openssl rand -base64 48`). Влияет на все JWT; смена секрета инвалидирует выданные токены.
- `AWG_ADMIN_PASSWORD` — в `production` не пустой и не равен `admin12345`; seed-администратор создаётся при первом запуске из `AWG_ADMIN_EMAIL`/`AWG_ADMIN_PASSWORD`, `AWG_ADMIN_LOGIN` (legacy) используется для поиска существующей записи.
- `AWG_JWT_ISSUER` и `AWG_JWT_AUDIENCE` по умолчанию `awg-admin`; пустые значения заменяются значением по умолчанию.
- SMTP: `AWG_MAIL_MODE=log|smtp`, `AWG_SMTP_URL=smtp://user:pass@host:port`, `AWG_SMTP_FROM`, `AWG_PUBLIC_URL` для ссылки подтверждения email.
- Без `.env` admin генерирует эфемерные `AWG_MASTER_KEY`/`AWG_JWT_SECRET` с предупреждением; после рестарта секреты устройств становятся нечитаемыми. Проверка:

```bash
docker compose logs admin | grep -i "ephemeral" && echo "ключ не задан"
```

## 3. Backup и restore redb

БД — один файл `/data/awg-admin.redb` (`AWG_DB_PATH`), том `awg-data`. Текущая версия схемы — `CURRENT_SCHEMA_VERSION = 6` (таблица `meta`, ключ `schema_version`). Проверка версии открытой базы: `Store::schema_version()`.

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
после старта. В Docker смонтируйте каталог backup отдельным томом, иначе файлы
будут лежать в контейнере:

```yaml
volumes:
  - ./backups:/backups
# environment:
#   AWG_BACKUP_DIR: /backups
```

Снимок проверяется на целостность (как `Store::backup_to`) и пригоден для
`awg-backup restore`. Планировщик не заменяет внешнюю ротацию: копируйте каталог
на отдельный носитель.

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

`restore` всегда сверяет `meta.schema_version` backup с `CURRENT_SCHEMA_VERSION` и при несовместимости или отсутствии версии завершается с кодом `1`, не меняя БД. Режимы: по умолчанию `Store::restore_from` (одна транзакция; файл backup должен быть доступен на запись), `--offline` — `Store::replace_file_from` (полная замена файла без открытия текущей БД; помогает, если файл БД повреждён или не открывается этим бинарником). Оба режима требуют остановленного admin и backup с текущей версией схемы.

Коды выхода: `0` — успех, `1` — ошибка операции (файл занят, файла нет, несовместимая схема, backup существует без `--force`), `2` — ошибка аргументов. `awg-backup --help` — справка.

Проверка после restore:

```bash
awg-backup info --db /data/awg-admin.redb        # версия схемы и таблицы
docker compose start admin
curl -fsS http://127.0.0.1:8080/api/v1/health
docker compose logs --tail=50 admin              # нет ошибок миграции и целостности
```

Затем войти в панель и проверить пользователей, ноды, тарифы и последние аудит-события.

Проверка версии: если backup создан другой версией admin, `restore` отклонит его; сначала обновите admin до версии, создавшей backup, или выполните миграции. Для отката на предыдущую версию используйте `awg-backup`, собранный из того же тега, что и возвращаемый admin. Схема новее поддерживаемой даёт `StorageError::SchemaTooNew` (`store schema version N is newer than supported version M`) и admin не стартует. Миграции: реестр `MIGRATIONS`, шаги `1 → 2` (`v2_billing`, таблицы биллинга) и `2 → 3` (`v3_rate_limits`, таблица `rate_limits`) не меняют существующие данные; все шаги и запись версии выполняются в одной write-транзакции, ошибка откатывает данные и версию.

## 4. Метрики

`GET /metrics` отдаёт реестр Prometheus text-формата `0.0.4`. С токеном:

```bash
curl -fsS -H "Authorization: Bearer $AWG_METRICS_TOKEN" \
  http://127.0.0.1:8080/metrics
```

`AWG_METRICS_TOKEN` включает `Authorization: Bearer <token>`; без токена эндпоинт открыт, поэтому порт `8080` не публикуйте наружу. В `production` при пустом токене в лог пишется предупреждение на старте. Сравнение токена constant-time, без токена — `401`.

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

## 5. Логи

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

## 6. Аудит

`GET /api/v1/audit` доступен только роли `admin`; записи в обратном хронологическом порядке, ответ `{"items":[...],"next_cursor":"..."}`. Фильтры (AND): `limit` (1..500, по умолчанию 100), `before` (курсор `<микросекунды>:<uuid>`), `action` (например `POST`, `DELETE`), `entity` (например `devices`), `actor` (регистронезависимое вхождение), `status` (HTTP-код), `from`/`to` (Unix-секунды, включительно). `from > to` — `400 invalid_filter`.

Retention: `AWG_AUDIT_RETENTION_DAYS` (по умолчанию 90; 0 — не чистить) — записи старше удаляются фоновой задачей раз в сутки. UI раздел `/audit` (admin only). Автоматически фиксируются успешные (2xx) mutating-запросы `POST`/`PATCH`/`PUT`/`DELETE` под `/api/v1`; вход фиксируется контроллером. `entity` — путь без идентификатора, `entity_id` — первый UUID или share-токен из пути, `ip` — первый адрес `X-Forwarded-For` либо адрес peer.

## 7. Квоты

```bash
TOKEN=$(curl -fsS -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"admin","password":"<пароль>"}' | jq -r .access_token)
curl -fsS -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/quota
curl -fsS -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/quota/users
```

`GET /api/v1/quota` возвращает `QuotaView` текущего пользователя: `used_bytes`, `quota_bytes`, `exceeded`, `remaining_bytes`, `percent`, `period_start`, `period_end`, `reset_at`. `GET /api/v1/quota/users` (admin) — массив `QuotaUserView`. При превышении (`used_bytes >= quota_bytes`) snapshot ограничивает группу и устройства пользователя скоростью 1 kbps. Проверка на worker:

```bash
tc -s class show dev <ifname> | grep -i '1kbit\|1kibit'
```

Без квоты (`quota_bytes=null`) ограничение не применяется.

## 8. Worker и dataplane

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

## 9. Инциденты

- Admin недоступен: проверить `docker compose ps`, `docker compose logs admin`, healthcheck `curl -fsS http://127.0.0.1:8080/api/v1/health`. Частые причины: неверные секреты в `production` (старт завершается ошибкой), схема БД новее поддерживаемой, заполненный диск, отсутствие тома `awg-data`.
- Worker offline: `docker compose ps`, `docker compose logs worker`, `GET /api/v1/nodes` (`online`). Проверить `AWG_NODE_ID`/`AWG_NODE_TOKEN`, `AWG_GRPC_URL`, доступность порта `9090` (не публиковать наружу).
- Схема новее: сообщение `store schema version N is newer than supported version M`; откатить admin к версии, создавшей БД, или выполнить миграции.
- Диск: проверить `docker system df`, место под `/data` и `/var/lib/awg-worker`; backup перед очисткой.
- Сертификат: `verify-tls.sh`, проверить `TRAEFIK_ACME_EMAIL`, том `traefik-letsencrypt`, домен задаётся `AWG_DOMAIN` (`Host(...)` в compose есть, HSTS настроен); ACME на реальном домене проверяется на стенде.
- Rate limit: `awg_rate_limited_total`, параметры `AWG_LOGIN_RATE_LIMIT`, `AWG_REFRESH_RATE_LIMIT` и окна; 0 отключает лимит. Режим хранилища — `AWG_RATE_LIMIT_STORE`: `memory` (по умолчанию, счётчики у каждой реплики свои) или `redb` (общая таблица `rate_limits` в БД, файл открывается в redb `MultiWriter` для нескольких процессов). При нескольких репликах включайте `redb` на всех и давайте им общий `AWG_DB_PATH`; записи старше окна удаляются раз в час и при shutdown.

## 10. Обновление

1. Backup БД (раздел 3) и `.env`.
2. Обновить образы: `docker compose build --pull` или `docker compose up -d --build`.
3. Запустить admin, применятся миграции redb (одна write-транзакция, при ошибке откат).
4. Проверить health, логи, версию схемы.
5. Запустить worker: `docker compose --profile worker up -d --build`.

Откат: остановить admin, вернуть прежний образ/`.env`, восстановить БД из backup командой `awg-backup restore --offline` той же версии, что и возвращаемый admin (раздел 3), запустить. Не менять `AWG_MASTER_KEY` при откате.

## 11. Полезные команды

```bash
make build
make ps
make logs
make health
docker compose config --quiet
docker compose exec admin sh -c 'id'
docker run --rm --entrypoint sh awg-admin:latest -c 'id'
docker run --rm --entrypoint sh awg-worker:latest -c 'ip -V; tc -V; nft --version; modprobe --version'
cargo test --workspace
cd frontend && pnpm typecheck && pnpm test && pnpm arch:check && pnpm build
# нагрузочный тест REST (нужен запущенный admin и wrk)
AWG_LOADTEST_PASSWORD=... ./scripts/loadtest-rest.sh
```