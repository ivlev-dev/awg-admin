# awg-admin

Панель управления AmneziaWG 3.1: Rust-бэкенд (admin + worker), SPA на
silent-framework и Traefik с TLS/HTTP/3.

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — DDD-контексты, слои, MVC/MVVM, потоки данных.
- [`docs/API.md`](docs/API.md) — REST API, права, ошибки, WebSocket.
- [`docs/WORKER.md`](docs/WORKER.md) — протокол воркера, netlink/tc/nft, статистика.
- [`docs/SECURITY.md`](docs/SECURITY.md) — роли, секреты, JWT, share-ссылки, ограничения.
- [`docs/TODO.md`](docs/TODO.md) — что проверено, что осталось, с чего продолжить.
- [`docs/FRAMEWORK-NOTES.md`](docs/FRAMEWORK-NOTES.md) — найденные баги silent и обходы.

## Архитектура

- `awg-admin` — HTTP API (h2c) на `:8080`, gRPC на `:9090`, БД redb (`AWG_DB_PATH`).
- `awg-worker` — исходящий gRPC к admin, управляет AmneziaWG (host network, privileged).
- frontend — Vite-сборка, раздаётся nginx; `/api` и WebSocket проксируются Traefik к admin.
- Traefik — TLS termination, HTTP/3, ACME (Let's Encrypt) или self-signed по умолчанию.

## Быстрый старт

```bash
cp .env.example .env
# сгенерируйте секреты и впишите в .env:
# AWG_MASTER_KEY=$(openssl rand -base64 32)
# AWG_JWT_SECRET=$(openssl rand -base64 48)
$EDITOR .env
docker compose up -d --build
```

Откройте `https://panel.localhost` (или `AWG_DOMAIN`). Первый вход:
`AWG_ADMIN_LOGIN` / `AWG_ADMIN_PASSWORD` из `.env` (по умолчанию `admin` /
`admin12345`) — **смените пароль после входа**.

Проверка API: `curl --http2-prior-knowledge http://127.0.0.1:8080/api/v1/health`.

## Создание ноды и запуск воркера

1. Войдите в панель и создайте ноду в разделе «Ноды».
2. Скопируйте `AWG_NODE_ID` и `AWG_NODE_TOKEN` в `.env`.
3. Запустите воркер: `docker compose --profile worker up -d --build`.

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

Traefik обращается к admin по h2c (`serversTransport protocol h2c`) на порту
8080. HTTP/3 терминирует Traefik; backend h2c — по требованию (без сертификатов).

## Тесты

```bash
cargo test --workspace          # 28 тестов
cd frontend && pnpm typecheck
cd frontend && pnpm test        # 59 тестов
cd frontend && pnpm build
```

## Структура

- `backend/crates/*` — Rust workspace (DDD-контексты + admin/worker).
- `frontend/src` — domain/application/infrastructure/app/features (MVVM).
- `docker` — Dockerfile, nginx, Traefik.
- `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `Makefile`.
- `docs` — архитектура, API, воркер, безопасность, TODO, заметки по фреймворку.
