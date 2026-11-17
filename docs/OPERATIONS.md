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
- `AWG_ADMIN_PASSWORD` — в `production` не пустой и не равен `admin12345`; seed-администратор создаётся при первом запуске из `AWG_ADMIN_LOGIN`/`AWG_ADMIN_PASSWORD`.
- `AWG_JWT_ISSUER` и `AWG_JWT_AUDIENCE` по умолчанию `awg-admin`; пустые значения заменяются значением по умолчанию.
- SMTP: `AWG_MAIL_MODE=log|smtp`, `AWG_SMTP_URL=smtp://user:pass@host:port`, `AWG_SMTP_FROM`, `AWG_PUBLIC_URL` для ссылки подтверждения email.
- Без `.env` admin генерирует эфемерные `AWG_MASTER_KEY`/`AWG_JWT_SECRET` с предупреждением; после рестарта секреты устройств становятся нечитаемыми. Проверка:

```bash
docker compose logs admin | grep -i "ephemeral" && echo "ключ не задан"
```

## 3. Backup и restore redb

БД — один файл `/data/awg-admin.redb` (`AWG_DB_PATH`), том `awg-data`. Текущая версия схемы — `CURRENT_SCHEMA_VERSION = 2` (таблица `meta`, ключ `schema_version`). Проверка версии открытой базы: `Store::schema_version()`.

Методы `Store`:

- `Store::backup_to(path)` — горячий логический снапшот без остановки admin: одна read-транзакция даёт консистентный снимок, все таблицы и `schema_version` пишутся в новый файл. Порядок: временный файл `<path>.tmp-<pid>-<n>` → запись → повторное открытие с проверкой целостности и версии → `fsync` → атомарный `rename`. При ошибке временный файл удаляется, прежний backup не трогается. Нельзя указать путь самой открытой БД (`BackupPathConflict`).
- `Store::restore_from(path)` — восстановление в работающую базу: backup открывается с проверкой целостности, версия должна строго совпадать с текущей (`IncompatibleBackup`/`UnversionedBackup` иначе, база не меняется). Все таблицы удаляются и заново наполняются в одной write-транзакции вместе с версией; записи после backup исчезают. Файл backup должен быть доступен на запись (redb проверяет целостность только при read-write open).
- `Store::replace_file_from(backup, target)` — офлайн-замена файла: копия backup во временный файл рядом с `target`, проверка целостности и версии, `fsync`, `rename`. Требует остановленного admin: файл БД открыт эксклюзивно.

Операционный backup (admin остановлен, копия файла):

```bash
docker compose stop admin
docker run --rm -v awg-data:/data -v "$PWD/backups:/backup" alpine \
  cp /data/awg-admin.redb /backup/awg-admin-$(date +%F).redb
docker compose start admin
```

Полное восстановление офлайн:

```bash
docker compose stop admin
docker run --rm -v awg-data:/data -v "$PWD/backups:/backup" alpine \
  cp /backup/awg-admin-YYYY-MM-DD.redb /data/awg-admin.redb
docker compose start admin
```

Проверка версии: если backup создан другой версией admin, `restore_from` отклонит его; сначала обновите admin до нужной версии или выполните миграции. Схема новее поддерживаемой даёт `StorageError::SchemaTooNew` (`store schema version N is newer than supported version M`) и admin не стартует. Миграции: реестр `MIGRATIONS`, шаг `1 → 2` (`v2_billing`) создаёт таблицы биллинга и не меняет существующие данные; все шаги и запись версии выполняются в одной write-транзакции, ошибка откатывает данные и версию.

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
./scripts/verify-tls.sh --static
./scripts/verify-tls.sh --local --no-hsts-check --no-static
```

Типовые ошибки:

- `failed to read counters ... Operation not supported (os error 95)` — netlink `WG_CMD_GET_DEVICE` отправляется без `NLM_F_DUMP`, в live-режиме статистика не собирается.
- повторный `tc qdisc replace ... root ... htb` возвращает `Change operation not supported by specified qdisc` — после первого reconcile изменения tc не применяются.
- `tc filter add` не идемпотентен, правила накапливаются.
- без тарифа у пользователя `user_limits` пуст и tc не применяется; пул без `gateway` даёт интерфейс без адреса.
- worker не чистит интерфейс, удалённый из desired state, если worker был остановлен в момент удаления.

## 9. Инциденты

- Admin недоступен: проверить `docker compose ps`, `docker compose logs admin`, healthcheck `curl -fsS http://127.0.0.1:8080/api/v1/health`. Частые причины: неверные секреты в `production` (старт завершается ошибкой), схема БД новее поддерживаемой, заполненный диск, отсутствие тома `awg-data`.
- Worker offline: `docker compose ps`, `docker compose logs worker`, `GET /api/v1/nodes` (`online`). Проверить `AWG_NODE_ID`/`AWG_NODE_TOKEN`, `AWG_GRPC_URL`, доступность порта `9090` (не публиковать наружу).
- Схема новее: сообщение `store schema version N is newer than supported version M`; откатить admin к версии, создавшей БД, или выполнить миграции.
- Диск: проверить `docker system df`, место под `/data` и `/var/lib/awg-worker`; backup перед очисткой.
- Сертификат: `verify-tls.sh`, проверить `TRAEFIK_ACME_EMAIL`, том `traefik-letsencrypt`, правила `Host(...)` в compose (сейчас роутеры на `PathPrefix`, ACME не выпустит сертификат без домена).
- Rate limit: `awg_rate_limited_total`, параметры `AWG_LOGIN_RATE_LIMIT`, `AWG_REFRESH_RATE_LIMIT` и окна; 0 отключает лимит.

## 10. Обновление

1. Backup БД (раздел 3) и `.env`.
2. Обновить образы: `docker compose build --pull` или `docker compose up -d --build`.
3. Запустить admin, применятся миграции redb (одна write-транзакция, при ошибке откат).
4. Проверить health, логи, версию схемы.
5. Запустить worker: `docker compose --profile worker up -d --build`.

Откат: остановить admin, восстановить БД из backup через `replace_file_from` или офлайн-копию, вернуть прежний образ/`.env`, запустить. Не менять `AWG_MASTER_KEY` при откате.

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
```