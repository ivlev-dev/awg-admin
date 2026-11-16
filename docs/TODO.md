# Состояние проекта и что осталось сделать

Документ для следующего разработчика: что готово, что проверено, что нет и с
чего начинать. Актуально на текущий коммит.

## Что уже работает

- Rust workspace из 11 крейтов, DDD-контексты: `shared`, `storage`, `identity`,
  `tariffs`, `network`, `clients`, `statistics`, `orchestration`, `proto`,
  `admin`, `worker`.
- Admin REST API (MVC: controllers/models/views), h2c (HTTP/2 без TLS), gRPC для
  воркеров, WebSocket-статистика.
- redb-хранилище, argon2-пароли, JWT access/refresh, роли admin/user.
- Группы, ноды, интерфейсы, CIDR-пулы, устройства, пиры на всех интерфейсах
  группы, forwarding между устройствами пользователя, тарифы и квоты.
- AWG 3.1 генератор: H1–H4 диапазоны (narrow), S1–S4 с floor 12 и без коллизий,
  Jc/Jmin/Jmax, I1–I5 HTTP/3/TLS mimicry, браузерные размеры, RandomTrailers,
  `vpn://` кодек, временные share-ссылки.
- Worker: gRPC-сессия, dry-run, netlink SetDevice, tc (HTB + IFB), nftables
  forwarding, персистентные монотонные счётчики (переживают reload интерфейса).
- Frontend: silent + Vite + vitest, MVVM, кастомный роутер, кастомный Select,
  светлая/тёмная темы, 7–8 адаптивных брейкпоинтов, графики, все основные экраны.
- Docker: multi-stage образы admin/worker/frontend, Traefik (TLS/HTTP3), nginx,
  compose + dev-compose, `.env.example`, Makefile.

## Проверено

- `cargo test --workspace` — 28 тестов, зелёные.
- `cd frontend && pnpm typecheck` — чисто.
- `cd frontend && pnpm test` — 59 тестов, зелёные.
- `cd frontend && pnpm build` — успешно.
- REST-сценарий вручную: логин, тариф, группа, пулы, нода, интерфейс,
  пользователь, устройство, профиль (`.conf` + `vpn://`), share-ссылка,
  статистика, RBAC-отказы.
- `curl --http2-prior-knowledge` → `http_version=2` (h2c).
- gRPC: worker dry-run подключается, нода становится `online`, состояние
  применяется (`worker applied state`), статистика принимается.
- UI в Chromium: логин, обзор, клиенты, группа, интерфейсы, пользователи,
  тарифы, импорт, статистика, настройки, профиль, тёмная тема, мобильный вид.
- Кастомный Select в Chromium и Firefox (headless через geckodriver): меню
  открывается, выбор применяется, меню закрывается.
- `docker compose config` — валиден.

## Не проверено / не доделано

### Блокеры перед production

1. **Реальный kernel.** Worker проверен только в `AWG_DRY_RUN=true`. Нужен хост
   с загруженным `amneziawg`, проверить `ip link add … type amneziawg`,
   `SetDevice` с `H*Range`, `REPLACE_PEERS`, чтение счётчиков.
2. **tc ingress/egress на живом трафике.** Проверить HTB-классы (root 1:1,
   пользовательские 1:100+i, устройства 1:1000+…), IFB, фильтры `u32`,
   суммарные лимиты пользователя и устройства.
3. **nftables forwarding.** Проверить изоляцию устройств и разрешённые пары
   (`inet awg_admin`, цепь `fwd_<ifname>`).
4. **Docker-образы не собирались.** `docker compose config` проходит, но
   `docker compose build` не запускался (Rust release + git-зависимость).
5. **TLS/ACME Traefik** не проверялся на реальном домене. Локально будет
   self-signed; `letsencrypt` включён в labels. Нужен тест с настоящим доменом.
6. **Секреты.** `AWG_MASTER_KEY` без значения генерируется эфемерно — после
   рестарта приватные ключи устройств не расшифруются. В production обязателен
   фиксированный ключ. Смените `AWG_ADMIN_PASSWORD` после первого входа.
7. **HTTP/3 backend.** По требованию backend работает по h2c; HTTP/3
   терминирует Traefik. Если нужен h3 именно от admin, потребуется TLS на
   QUIC-порту (HTTP/3 без TLS невозможен).
8. **WebTransport.** Сейчас только WebSocket. WT не реализован: нужен h3 или
   проксирование WT через Traefik + клиентский fallback.
9. **Аудит.** Таблица `audit` есть, записи не создаются. Нужно логировать
   изменения пользователей/интерфейсов/устройств/тарифов.
10. **Rate limiting / brute-force.** Нет ограничения попыток логина и запросов.

### Функционал

- **Импорт**: поддержан один серверный конфиг + пачка клиентских для одного
  интерфейса. Нет: нескольких интерфейсов за один импорт, серверных пиров без
  клиентских конфигов, дедупликации, предпросмотра diff, отката.
- **CIDR-пулы**: режимы `auto/rf_only/external_only` — только метки и выдача
  адресов; маршрутизация делается вне проекта (так согласовано). Нет проверки
  пересечения с адресами других групп и резервирования шлюзов на уровне БД.
- **Квоты**: при превышении worker получает `1 kbps` (фактическая блокировка).
  Нет статуса «заблокирован по квоте», уведомлений, сброса квоты по расписанию.
- **Статистика**: часовые бакеты, запросы суммируют их на лету. Нет дневных/
  месячных материализованных таблиц, per-second rate на бэкенде, retention-
  политики в настройках (жёстко 90 дней), графиков по нескольким scope сразу.
- **Share-ссылки**: многоразовые до истечения TTL. Нет одноразовых, лимита
  использований, QR-кода, отзыва по device_id списком.
- **Ротация ключей интерфейса** инвалидирует клиентские конфиги; в UI есть
  предупреждение, но нет пакетного перевыпуска/доставки.
- **Пользователи**: нет самостоятельной регистрации, сброса пароля по email,
  MFA, SSO, сессий (список активных refresh-токенов).
- **Ноды**: токен выдаётся один раз и не ротируется; нет отзыва токена и
  отображения метрик воркера (CPU/RAM/версия ядра).
- **Пиры**: нет QR, нет выбора нескольких интерфейсов при создании профиля,
  нет отдельного «профиля по умолчанию».
- **Forwarding UI**: в карточке устройства можно разрешить обмен с другими
  устройствами пользователя; нет матрицы «устройство × устройство».
- **i18n**: только русский, строки захардкожены.
- **A11y**: кастомный Select имеет aria/listbox и клавиатуру, но нет полного
  набора тестов и focus-trap в модалках.
- **Мобильное меню**: bottom nav + drawer; нет свайпа и safe-area для
  ландшафта (частично учтено `env(safe-area-inset-*)`).

### Инфраструктура и качество

- Нет CI (GitHub Actions): fmt, clippy, cargo test, pnpm typecheck/test/build,
  docker build.
- Нет миграций/версионирования схемы redb. При изменении структур нужен
  version + migration.
- Нет backup/restore redb и ротации файла.
- Нет метрик Prometheus/OpenTelemetry и structured access-логов.
- Нет e2e-тестов UI (Playwright MCP использовался вручную).
- Нет нагрузочных тестов API и gRPC.
- `docs/API.md` частично описывает DTO; стоит генерировать из кода/OpenAPI.
- Комментарии в коде отсутствуют по требованию; сложные инварианты описаны в
  `docs/ARCHITECTURE.md` и `docs/WORKER.md`.

## С чего начинать следующему разработчику

1. Прочитайте `docs/ARCHITECTURE.md`, `docs/WORKER.md`, `docs/API.md`,
   `docs/FRAMEWORK-NOTES.md`.
2. Поднимите локально:
   ```bash
   cp .env.example .env
   # заполните AWG_MASTER_KEY и AWG_JWT_SECRET (openssl rand -base64 ...)
   docker compose up -d --build
   ```
   Для быстрой разработки без Docker:
   ```bash
   cargo run -p awg-admin
   cd frontend && pnpm install && pnpm dev
   ```
3. Создайте ноду через UI, получите `AWG_NODE_ID`/`AWG_NODE_TOKEN`.
4. Запустите worker на Linux-хосте:
   ```bash
   docker compose --profile worker up -d --build
   # или локально:
   AWG_GRPC_URL=http://127.0.0.1:9090 AWG_NODE_ID=... AWG_NODE_TOKEN=... \
   AWG_DRY_RUN=false cargo run -p awg-worker
   ```
5. Начните с блокеров: kernel/tc/nft проверка, Docker build, аудит, rate limit.

## Особенности окружения

- Firefox под Playwright/geckodriver в этом окружении запускается только с
  `LD_PRELOAD=""` (иначе SIGSEGV). Для ручной проверки: `LD_PRELOAD= firefox`.
- `frontend/public/select-repro.html` — стенд для проверки нативного
  `<select>` в Firefox, если будете возвращаться к этой теме.
- В dev-режиме Vite проксирует `/api` (включая WS) на `http://127.0.0.1:8080`.
- Порт 9090 gRPC в compose опубликован только на `127.0.0.1`; не выставляйте
  его наружу.
