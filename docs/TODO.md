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
- Frontend: silent 0.7.3 + Vite + vitest, MVVM, DDD-слои (domain/application/
  infrastructure), репозитории и сервисы, DI на `@ivlev-dev/silent-di`, HTTP-клиент
  с request/response-интерсепторами, кастомный роутер, Select, темы, графики,
  статические SVG-иконки, 450 тестов.
- Docker: multi-stage образы admin/worker/frontend, Traefik (TLS/HTTP3), nginx,
  compose + dev-compose, `.env.example`, Makefile.

## Проверено

- `cargo test --workspace` — 132 теста, зелёные; `cargo clippy --workspace --all-targets -- -D warnings` — чисто.
- `cd frontend && pnpm typecheck` — чисто.
- `cd frontend && pnpm test` — 450 тестов, зелёные.
- `cd frontend && pnpm build` — успешно.
- `docker compose build` — admin/worker/frontend собираются; `up -d` поднимает
  admin (healthy), frontend (healthy), traefik; worker в `AWG_DRY_RUN=true`
  подключается и применяет состояние.
- Аудит: `GET /api/v1/audit`, записи для mutating-запросов; rate limiting логина
  и refresh; production-конфиг падает без `AWG_MASTER_KEY`/`AWG_JWT_SECRET`.
- JWT: `iss`/`aud`/`nbf`, ротация refresh с reuse detection, `/auth/sessions`,
  `/auth/logout-all`, отзыв сессий при смене пароля/блокировке/удалении.
- UI (Playwright, Chromium/Firefox): логин, обзор, клиенты, группы,
  интерфейсы, ноды, статистика, настройки, профиль, тарифы, пользователи,
  импорт; SVG во всех разделах в namespace `svg`; ошибок JS нет.
- `scripts/verify-kernel.sh`, `verify-dataplane.sh`, `verify-tls.sh` — синтаксис
  и dry-run проверены; см. `docs/PRODUCTION-VERIFICATION.md`.
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

1. **Реальный kernel.** `scripts/verify-kernel.sh --apply --netns` — 0 провалов
   (16.11.2026): модуль, `ip link add`, SetDevice, H*Range, S1–S4,
   REPLACE_PEERS, счётчики, ICMP и handshake между двумя AWG в netns.
   E2E worker: dry-run (`online`, `worker applied state`) и live (интерфейс,
   пиры, HPK, RandomTrailers применены; handshake с тестовым клиентом прошёл).
   Осталось: реальные клиенты и замер полосы. Статистика не работает — п. 11.
2. **tc ingress/egress.** Структура HTB/IFB/u32, квоты, счётчики и изоляция
   проверены; на реальном AWG htb/ingress/IFB применяются. Повторный reconcile
   падает — п. 12. Без тарифа пользователя tc не применяется; пул без
   `gateway` оставляет интерфейс без адреса. Осталось: живая полоса и hairpin.
3. **nftables forwarding.** Таблица/цепь/правила и изоляция проверены на veth;
   live worker создаёт `fwd_<ifname>` на реальном интерфейсе. Реальная пара
   устройств на одном AWG-интерфейсе (hairpin `iifname == oifname`) — не
   проверена.
4. **Docker-образы.** Закрыто: сборка и запуск проверены, healthcheck'и зелёные.
5. **TLS/ACME Traefik.** Локально проверены self-signed, HTTP/2, HTTP/3,
   редирект и health; живой стенд отдаёт h2/h3 с TRAEFIK DEFAULT CERT.
   `--static` падает: у роутеров нет `Host(...)`, HSTS не настроен. Выпуск
   Let's Encrypt на реальном домене не проверялся.
6. **Секреты.** В production старт падает без `AWG_MASTER_KEY` (32 байта
   base64), `AWG_JWT_SECRET` (32+ байта) и с дефолтным паролем администратора.
   На проверочной машине `.env` с ключами есть, предупреждения об эфемерном
   ключе нет, профиль читается; рестарт admin не выполнялся.
7. **HTTP/3 backend.** Backend по-прежнему h2c; HTTP/3 терминирует Traefik.
   Это осознанное ограничение.
8. **WebTransport.** Не реализован, используется WebSocket. Нужен h3 или
   проксирование WT + клиентский fallback.
9. **Аудит.** Закрыто: крейт `awg-audit`, middleware, `GET /api/v1/audit`
   с фильтрами и курсорной пагинацией, retention, UI-журнал `/audit`.
10. **Rate limiting.** Закрыто: sliding window для login/refresh, 429 +
    `Retry-After`. В памяти процесса, при нескольких репликах лимиты не общие.
11. **Статистика worker в live-режиме.** `backend/crates/worker/src/infrastructure/netlink.rs`
    (`read_interface`) отправляет `WG_CMD_GET_DEVICE` без `NLM_F_DUMP`. В ядре
    команда зарегистрирована только как dump (`.start`/`.dumpit`, без `.doit`),
    поэтому ответ — `Operation not supported (os error 95)`. Worker каждые 2 с
    пишет `failed to read counters`, API/UI показывают нули даже при реальном
    handshake. Dry-run это скрывает: `read_interface` возвращает пустой runtime.
    Нужно выставлять `NLM_F_DUMP` и читать multipart-ответ.
12. **Повторный reconcile tc.** `TcShaper::apply_egress` вызывает
    `tc qdisc replace` при каждом применении. На проверочном ядре (Linux 7.3.4,
    iproute2 7.3.0) второй `replace` root htb возвращает
    `Change operation not supported by specified qdisc`; после первого
    успешного reconcile любое изменение состояния падает на `apply tc`, а nft
    (применяется после tc) остаётся от предыдущей ревизии. `ingress replace`
    идемпотентен, `qdisc del` + `add` работают. `scripts/verify-dataplane.sh`
    теперь проверяет это отдельным пунктом.

### Функционал

- **Импорт**: поддержан один серверный конфиг + пачка клиентских для одного
  интерфейса. Нет: нескольких интерфейсов за один импорт, серверных пиров без
  клиентских конфигов, дедупликации, предпросмотра diff, отката.
- **CIDR-пулы**: режимы `auto/rf_only/external_only` — только метки и выдача
  адресов; маршрутизация делается вне проекта (так согласовано). Нет проверки
  пересечения с адресами других групп и резервирования шлюзов на уровне БД.
- **Квоты**: состояние отдаётся в API (`/quota`, `/quota/users`), в UI есть
  прогресс, «осталось», дата сброса и предупреждение при превышении; worker
  получает `1 kbps`. Нет уведомлений (email/webhook) и настраиваемого периода —
  сброс календарный, раз в месяц.
- **Статистика**: часовые бакеты, запросы суммируют их на лету. Нет дневных/
  месячных материализованных таблиц, per-second rate на бэкенде, retention-
  политики в настройках (жёстко 90 дней), графиков по нескольким scope сразу.
- **Share-ссылки**: многоразовые до истечения TTL. Нет одноразовых, лимита
  использований, QR-кода, отзыва по device_id списком.
- **Ротация ключей интерфейса** инвалидирует клиентские конфиги; в UI есть
  предупреждение, но нет пакетного перевыпуска/доставки.
- **Пользователи**: нет самостоятельной регистрации, сброса пароля по email,
  MFA, SSO. Список активных refresh-сессий и их отзыв есть в API.
- **Ноды**: токен выдаётся один раз и не ротируется; нет отзыва токена и
  отображения метрик воркера (CPU/RAM/версия ядра).
- **Пиры**: нет QR, нет выбора нескольких интерфейсов при создании профиля,
  нет отдельного «профиля по умолчанию».
- **Forwarding UI**: сделано. Три режима (выкл / все свои / выбранные), матрица
  «источник × назначение» по устройствам пользователя, симметричные пары по
  умолчанию, список пар для мобильного, немедленное сохранение с откатом.
  Ограничение бэкенда: только устройства одного пользователя.
- **i18n**: только русский, строки захардкожены.
- **A11y**: кастомный Select имеет aria/listbox и клавиатуру, но нет полного
  набора тестов и focus-trap в модалках.
- **Мобильное меню**: bottom nav + drawer; нет свайпа и safe-area для
  ландшафта (частично учтено `env(safe-area-inset-*)`).

### Инфраструктура и качество

- CI добавлен: `.github/workflows/ci.yml` (fmt, clippy -D warnings, cargo test,
  pnpm typecheck/test/build, сборка трёх Docker-образов).
- Версионирование схемы redb сделано (`meta.schema_version`, каркас миграций).
- Backup/restore: `Store::backup_to`, `restore_from`, `replace_file_from`
  (офлайн). Ротации файла по расписанию нет.
- Prometheus-метрики (`/metrics`, опциональный Bearer) и structured-логи
  (`AWG_LOG_FORMAT=json|text`) сделаны. OpenTelemetry-трейсинга нет.
- Нет автоматических e2e-тестов UI: Playwright использовался вручную; набор
  можно закрепить в CI.
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
5. Блокеры kernel/tc/nft/ TLS описаны в `docs/PRODUCTION-VERIFICATION.md`;
   Docker, аудит, rate limit, JWT, CI, миграции/backup redb, lazy-роуты и
   архитектурные границы уже закрыты.

## Особенности окружения

- Firefox под Playwright/geckodriver в этом окружении запускается только с
  `LD_PRELOAD=""` (иначе SIGSEGV). Для ручной проверки: `LD_PRELOAD= firefox`.
- `frontend/public/select-repro.html` — стенд для проверки нативного
  `<select>` в Firefox, если будете возвращаться к этой теме.
- В dev-режиме Vite проксирует `/api` (включая WS) на `http://127.0.0.1:8080`.
- Порт 9090 gRPC в compose опубликован только на `127.0.0.1`; не выставляйте
  его наружу.
