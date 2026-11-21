# awg-admin

Панель управления AmneziaWG 3.1: Rust-бэкенд (admin + worker), SPA на
silent-framework и Traefik с TLS/HTTP/3.

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — DDD-контексты, слои, MVC/MVVM, потоки данных.
- [`docs/API.md`](docs/API.md) — REST API, права, ошибки, WebSocket.
- [`docs/WORKER.md`](docs/WORKER.md) — протокол воркера, netlink/tc/nft, статистика.
- [`docs/SECURITY.md`](docs/SECURITY.md) — роли, секреты, JWT, share-ссылки, HTTP-заголовки безопасности, аудит зависимостей, ограничения.
- [`docs/PRODUCTION-VERIFICATION.md`](docs/PRODUCTION-VERIFICATION.md) — приёмка production-блокеров: ядро, tc, nftables, Docker, TLS/ACME, HTTP/3.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — эксплуатация: запуск/остановка, секреты, backup/restore redb, метрики, логи, аудит, квоты, worker, инциденты, обновление.
- [`docs/TODO.md`](docs/TODO.md) — что проверено, что осталось, с чего продолжить.
- [`docs/FRAMEWORK-NOTES.md`](docs/FRAMEWORK-NOTES.md) — найденные баги silent и обходы.
- [`docs/ANDROID.md`](docs/ANDROID.md) — Android-клиент Umbra VPN: сборка, аккаунт, синхронизация конфигов.
- [`docs/BRAND.md`](docs/BRAND.md) — логотип, палитра Material You и правила использования.
- [`docs/QUALITY.md`](docs/QUALITY.md) — гейты CI, бюджеты размера фронтенда и Android, backend performance smoke.

## Архитектура

- `awg-admin` — HTTP API (h2c) на `:8080`, gRPC на `:9090`, БД redb (`AWG_DB_PATH`).
- `awg-backup` — CLI backup/restore/info для redb при остановленном admin (см. `docs/OPERATIONS.md`).
- `awg-worker` — исходящий gRPC к admin, управляет AmneziaWG (host network, privileged).
- frontend — Vite-сборка, раздаётся nginx; `/api` и WebSocket проксируются Traefik к admin.
- `android/` — Umbra VPN для Android (Kotlin/Compose), вход через API панели и автосинхронизация конфигурации.
- Traefik — TLS termination, HTTP/3, ACME (Let's Encrypt) или self-signed по умолчанию.

## Быстрый старт

```bash
cp .env.example .env
# сгенерируйте секреты и впишите в .env:
# AWG_MASTER_KEY=$(openssl rand -base64 32)
# AWG_JWT_SECRET=$(openssl rand -base64 48)
# AWG_ADMIN_PASSWORD=<уникальный пароль, не admin12345>
$EDITOR .env
docker compose up -d --build
```

`docker-compose.yml` подставляет `AWG_ENV=production` по умолчанию
(fail-closed). В production контейнер **не стартует** без `AWG_MASTER_KEY`,
`AWG_JWT_SECRET` и пароля администратора, отличного от `admin12345`. Для
локального запуска без секретов задайте `AWG_ENV=development` или используйте
`docker-compose.dev.yml`: тогда admin сгенерирует эфемерные
`AWG_MASTER_KEY`/`AWG_JWT_SECRET` (приватные ключи устройств станут
нечитаемыми после рестарта), а логин/пароль будут `admin@local`/`admin12345`.

Traefik с портами 80/443 запускается отдельным профилем `tls` и работает через
`docker-socket-proxy` (Traefik не монтирует `/var/run/docker.sock`):
`docker compose --profile tls up -d`. Без профиля порты 80/443 не занимаются.
Затем откройте `https://panel.localhost` (или `AWG_DOMAIN`). Первый вход:
`AWG_ADMIN_EMAIL` / `AWG_ADMIN_PASSWORD` из `.env` (по умолчанию
`admin@local` / `admin12345`); вход выполняется только по email — **смените
пароль после входа**.

Проверка API: `curl --http2-prior-knowledge http://127.0.0.1:8080/api/v1/health`.

Проверка образов и запуска без Traefik:

```bash
make build                     # docker compose --profile worker build
docker compose up -d --build   # admin (:8080, gRPC :9090) + frontend (:8081)
curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsS http://127.0.0.1:8081/ | head -n 5
docker compose ps              # все сервисы healthy/running
make clean                     # docker compose down -v --remove-orphans
```

Frontend опубликован на `127.0.0.1:8081` для локальной проверки; в production
его раздаёт Traefik по домену.

## Создание ноды и запуск воркера

1. Войдите в панель и создайте ноду в разделе «Ноды».
2. Скопируйте `AWG_NODE_ID` и `AWG_NODE_TOKEN` в `.env` (compose подставит их
   в контейнер worker при интерполяции).
3. Запустите воркер: `docker compose --profile worker up -d --build`.

Worker не получает `.env` целиком: в compose ему переданы только
`AWG_NODE_ID`, `AWG_NODE_TOKEN`, `AWG_GRPC_URL`, `AWG_GRPC_TLS_*`,
`AWG_DRY_RUN`, `AWG_COUNTERS_PATH`, `AWG_STATS_INTERVAL_SECS`. Секреты admin
(`AWG_MASTER_KEY`, `AWG_JWT_SECRET`, SMTP, платёжные ключи) в контейнер worker
не попадают.

Для проверки без ядра: `AWG_DRY_RUN=true`.

## Локальная разработка

```bash
cargo run -p awg-admin
cd frontend && pnpm install && pnpm dev
```

Frontend: `http://localhost:5173` (Vite проксирует `/api` и WS на `:8080`),
admin: `http://localhost:8080`, gRPC: `localhost:9090`.

Либо всё в Docker:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## HTTP/2 (h2c)

Admin слушает `:8080` и принимает и HTTP/1.1, и h2c (prior knowledge).
Traefik проксирует `/api` к admin по HTTP/1.1; HTTP/3 терминирует Traefik.
Клиенты, которым нужен h2c напрямую, используют
`curl --http2-prior-knowledge http://127.0.0.1:8080/api/v1/health`.

## Безопасность HTTP

nginx раздаёт frontend с CSP, nosniff, `Referrer-Policy`, `Permissions-Policy`,
`X-Frame-Options: DENY` и `Cross-Origin-Opener-Policy: same-origin`; Traefik
добавляет HSTS на HTTPS-роутерах и заголовки для API. CSP использует
`style-src 'unsafe-inline'` (inline `style="..."` в компонентах) и
`connect-src 'self'` для REST и WebSocket статистики (WS подключается по
одноразовому тикету на том же origin); inline-скриптов нет.

```bash
curl -sSI http://127.0.0.1:8081/ | grep -Ei 'content-security|x-content|referrer|permissions|x-frame'
curl -sSI -k https://127.0.0.1/ | grep -i strict-transport-security
```

Детали и компромиссы — в [`docs/SECURITY.md`](docs/SECURITY.md).

## Сборка и кеширование frontend

Картами исходников управляет `VITE_SOURCEMAP`: `false` (по умолчанию), `hidden`
(карты без `sourceMappingURL`, для отладки) или `true`. Docker собирает образ с
`VITE_SOURCEMAP=false`, `.map` в него не попадают, nginx отдаёт на `*.map`
`404`.

```bash
cd frontend && pnpm build                # без карт
VITE_SOURCEMAP=hidden pnpm build         # карты только для локальной отладки
curl -sSI http://127.0.0.1:8081/ | grep -Ei 'cache-control|etag|vary'
curl -sSI http://127.0.0.1:8081/assets/<hash>.js | grep -Ei 'cache-control|content-encoding|vary'
```

`index.html` приходит с `Cache-Control: no-cache` и `ETag`, поэтому после
деплоя подхватывается новый хеш бандла. `/assets/*` кешируется на год как
`immutable`; `Vary: Accept-Encoding` и gzip включены для js/css/json/xml/svg.

## Аудит зависимостей

CI job `security` независимо от сборки проверяет Rust (`cargo audit --deny warnings`)
и frontend (`pnpm audit --audit-level high --prod`); job `Dependencies policy`
запускает `cargo deny check` по `deny.toml`. Job `rust` начинается с
`cargo fmt --all -- --check`. Игнорируемые advisory с обоснованием — в
`.cargo/audit.toml`.

```bash
cargo fmt --all -- --check
cargo deny check
cargo audit --deny warnings
cd frontend && pnpm audit --audit-level high --prod
```

Dependabot еженедельно открывает PR на patch/minor-обновления (major — отдельно).
Политика обновлений и реакция на advisory — в
[`docs/SECURITY.md`](docs/SECURITY.md#аудит-зависимостей).

## Метрики и логи

- `GET /metrics` — Prometheus text-формат (`awg_http_requests_total`,
  `awg_http_request_duration_seconds`, `awg_auth_logins_total`,
  `awg_rate_limited_total`, `awg_audit_events_total`, `awg_worker_online`).
- `AWG_METRICS_TOKEN` включает обязательный `Authorization: Bearer <token>`
  для `/metrics`; без корректного токена — `401` (сравнение constant-time).
  В `production` при пустом `AWG_METRICS_TOKEN` `/metrics` отвечает `404`;
  в `development` без токена эндпоинт открыт. Порт `8080` в любом случае не
  публикуйте наружу.
- `AWG_LOG_FORMAT=json` переключает логи на structured JSON, `RUST_LOG`
  задаёт уровень (`info` по умолчанию).

```bash
curl -fsS -H "Authorization: Bearer $AWG_METRICS_TOKEN" \
  http://127.0.0.1:8080/metrics
```

## Тесты

```bash
cargo test --workspace          # точное число — в выводе раннера и CI
cd frontend && pnpm typecheck
cd frontend && pnpm test        # точное число — в выводе раннера и CI
cd frontend && pnpm arch:check  # границы слоёв (dependency-cruiser)
cd frontend && pnpm build
docker compose --profile worker build
```

### E2E (Playwright)

Браузерные тесты живут в `frontend/e2e` и запускаются против уже поднятого
стека (`http://127.0.0.1:8081`, вход только по email: `admin@local` /
`admin12345`). В CI их поднимает job `e2e`: `docker compose up -d --build`,
ожидание `/api/v1/health`, затем Chromium.

```bash
cd frontend
pnpm exec playwright install --with-deps chromium firefox  # один раз
pnpm e2e                       # headless, оба проекта
pnpm e2e --project=chromium    # только Chromium
pnpm e2e:headed                # с видимым браузером
pnpm e2e:report                # открыть HTML-отчёт
```

Адрес и учётные данные переопределяются `E2E_BASE_URL`, `E2E_ADMIN_LOGIN`,
`E2E_ADMIN_PASSWORD`. Данные для тестов создаются через API и уникальны по
timestamp, поэтому повторные прогоны не конфликтуют. Отчёт:
`frontend/playwright-report`, артефакты падений: `frontend/test-results`
(trace и screenshot сохраняются только при ошибке).

## Проверка production-блокеров

Блокеры, которые нельзя проверить в обычном CI (реальное ядро `amneziawg`,
`tc` ingress/egress, `nftables` forwarding, Docker build, TLS/ACME, HTTP/3),
проверяются отдельными скриптами. По умолчанию — dry-run; разрушающие действия
только с `--apply`, в одноразовом network namespace.

```bash
./scripts/verify-kernel.sh --apply --netns       # модуль, ip link, SetDevice, REPLACE_PEERS, счётчики
./scripts/verify-dataplane.sh --apply            # HTB + IFB + u32, nftables, изоляция на veth
./scripts/verify-tls.sh --static                 # аудит traefik.yml и docker-compose.yml
./scripts/verify-tls.sh --local --no-hsts-check --no-static  # Traefik + self-signed: h2, h3, health
```

Фактический прогон 16.11.2026 (Linux 7.3.4, `amneziawg` 3.1, iproute2 7.3.0):
`verify-kernel.sh --apply --netns` — 0 провалов; `verify-dataplane.sh --apply` —
1 провал (повторный `tc qdisc replace` root htb не поддерживался ядром);
`verify-tls.sh --local` — 2 провала (нет `Host(...)` в compose и HSTS), остальное
`ok`; live worker создаёт интерфейс с H1–H4/S1–S4/HPK и пирами, handshake
проходит, но на момент прогона статистика не собиралась: netlink `GetDevice`
отправлялся без `NLM_F_DUMP`. Оба дефекта (dump-флаг и пересоздание qdisc через
`del`+`add`) исправлены в коде; сводка в
[`docs/PRODUCTION-VERIFICATION.md`](docs/PRODUCTION-VERIFICATION.md) помечает
прогон как исторический.

Полный чек-лист с предусловиями, откатом и критериями приёмки:
[`docs/PRODUCTION-VERIFICATION.md`](docs/PRODUCTION-VERIFICATION.md).

## Структура

- `backend/crates/*` — Rust workspace (DDD-контексты + admin/worker).
- `frontend/src` — domain/application/infrastructure/app/features (MVVM).
- `docker` — Dockerfile, nginx, Traefik.
- `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `Makefile`.
- `docs` — архитектура, API, воркер, безопасность, TODO, заметки по фреймворку.
