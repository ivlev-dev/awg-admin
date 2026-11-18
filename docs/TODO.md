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
- Frontend: silent 0.11.17 + Vite + vitest, MVVM, DDD-слои (domain/application/
  infrastructure), репозитории и сервисы, DI на `@ivlev-dev/silent-di`, HTTP-клиент
  с request/response-интерсепторами, Select, темы, графики, статические
  SVG-иконки, 758 тестов.
- Роутинг на `@ivlev-dev/silent-router` 0.11.17: route-записи с метаданными,
  общий `load` страниц, история, `resolve`, `prefetch`, восстановление скролла.
  Страницы рендерит `RouterView` с DI-контейнером, слотами `error`/`notFound` и
  переиспользованием view; фасад `src/app/router.ts` сохраняет API для VM.
  DI работает в строгом режиме (`di: "error"` в Vite и `implicitBindings`).
- UI: Material You (M3) на navy-палитре: drawer 280px, top app bar 64px,
  page-head 28/36, тональные поверхности, M3-кнопки/поля/чипы, sticky-таблицы,
  аватары, метры, мобильные карточки; переведены shell и все основные страницы. Мобильная навигация «4 таба + Ещё» (bottom sheet),
  тач-таргеты 44px, массовые действия, сортировка, `BulkBar`, fallback
  копирования в буфер обмена для HTTP.
- Docker: multi-stage образы admin/worker/frontend, Traefik (TLS/HTTP3), nginx,
  compose + dev-compose, `.env.example`, Makefile.
- Эксплуатация: security-заголовки CSP/HSTS, graceful shutdown, `/ready`,
  `X-Request-Id`, Prometheus `/metrics`, JSON-логи, `docs/OPERATIONS.md`.
- UI: focus-trap и ARIA в модалках, ErrorBoundary, offline-баннер, страница 404,
  сохранение фильтров/поиска в Clients, Users, Audit.
- Ноды: ротация токена (`POST /nodes/{id}/rotate`), метрики воркера в heartbeat
  (CPU load, RAM, версия ядра и воркера, uptime, время обновления) и их показ в UI.
- Share-ссылки: одноразовые и с лимитом использований, атомарное потребление,
  отзыв списком, состояние `active/expired/exhausted/revoked` в API и UI.
- Статистика: текущая скорость `rx_bps`/`tx_bps` в overview и средняя скорость в
  сериях.
- Биллинг этап 2 (провайдер-агностично): checkout с идемпотентным счётом,
  публичный webhook с HMAC-подписью, окном timestamp и дедупликацией `event_id`,
  mock-шлюз для разработки, способы оплаты, активация подписки.
- Наблюдаемость и эксплуатация: OpenTelemetry OTLP/gRPC (`AWG_OTEL_ENDPOINT`),
  плановая ротация backup внутри admin (`AWG_BACKUP_*`), нагрузочный тест REST
  (`scripts/loadtest-rest.sh`).
- `admin/src` разбит по доменам: `routes/*`, `models/*`, `views/*`.
- Производительность: списки устройств/интерфейсов/групп без N+1, sourcemaps
  выключены в production, security-аудит зависимостей в CI, Dependabot.

## Проверено

- `cargo test --workspace` — 378 тестов, зелёные; `cargo clippy --workspace --all-targets -- -D warnings` — чисто.
- `cd frontend && pnpm typecheck` — чисто.
- `cd frontend && pnpm test` — 758 тестов, зелёные.
- `cd frontend && pnpm e2e` — 26/26 (Chromium + Firefox).
- Дизайн-система: `docs/DESIGN-SYSTEM.md`, живой прототип
  `frontend/public/design-preview.html`.
- Фреймворк `@ivlev-dev/*` 0.11.17: `RouterView` с DI-контейнером, общий
  `load` страниц, `navigate()` без unhandled rejection; обход `insertBefore`
  на аудите снят, `Switch`/`Match` работают после фикса issue #1 в 0.11.17.
  Строгий DI проверяется сборкой (`di: "error"`). Открытые вопросы фреймворка —
  `docs/FRAMEWORK-NOTES.md`.
- Смоук API (17.11.2026): checkout идемпотентен, webhook processed/duplicate,
  неверная подпись — 400, подписка переходит в `active`, способ оплаты сохранён;
  ротация токена ноды, `rx_bps` в overview; одноразовая share-ссылка отдаётся
  один раз (200 → 403), лимит использований, отзыв списка; аудит пишется.
- Backup-планировщик: снапшоты создаются по интервалу, retention оставляет
  `AWG_BACKUP_KEEP` файлов. OpenTelemetry-экспортёр инициализируется без ошибок.
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

## Текущий этап: UX/UI редизайн (в работе)

Сделано в последних коммитах:

- Мобильная навигация: верхний бургер убран, нижнее меню — Обзор · Клиенты ·
  Интерфейсы · Статистика · «Ещё» (bottom sheet со всеми разделами, темой,
  выходом). Focus-trap и Escape — от `Modal`.
- Navy-палитра: акценты, градиенты, сайдбар, бейджи; фиолетовые хардкоды убраны,
  тёмная тема пересобрана.
- Копирование в буфер обмена: `src/domain/clipboard.ts` с fallback через
  `execCommand` (панель по HTTP не имеет secure context).
- Обзор и Статистика разведены: обзор — состояние, квота и live-скорости;
  статистика — периодные суммы, график, разбивка.
- Списки: фильтры в Пользователях (роль/статус), Нодах (поиск/статус), Клиентах
  (статус), сортировка колонок (Пользователи, Клиенты, Ноды), массовые действия:
  Пользователи (блок/разблок/удаление), Ноды (удаление), Интерфейсы
  (включить/отключить/удалить), Клиенты (отозвать ссылки/удалить).
- Общая полировка таблиц: sticky-стили заголовков, hover/selected, `list-toolbar`,
  `BulkBar`, focus-visible, тени мобильного меню.
- Сортировка колонок: Пользователи, Клиенты, Ноды, Интерфейсы (интерфейс, адрес,
  пиры, статус), Тарифы (все числовые поля и название); поиск в Тарифах.
- Массовые действия: Группы и Тарифы (удаление выбранных), Аудит (очистка по
  фильтру через `DELETE /api/v1/audit`, экспорт CSV уже был).
- Серверные bulk-эндпоинты `POST /api/v1/{users,devices,interfaces,nodes,groups,tariffs}/bulk`:
  один запрос на массовое действие, ответ `{done, failed:[{id,error}]}`; клиент
  больше не делает N последовательных запросов. Покрыто VM-тестами и e2e
  массового удаления тарифов.
- Единый `list-toolbar`: Тарифы (поиск), Импорт (владелец/нода/группа), Сессии
  профиля (поиск по устройству/IP и «только активные»).
- Плотность таблиц: «Обычная»/«Компактная» в Настройках, `data-density` на
  `html`, сохранение в браузере; мобильные entity-карточки не затрагиваются.
- UX-аудит 390px: Импорт, Настройки, Профиль, Группы, Тарифы, Аудит — без
  горизонтального переполнения, проверено в Playwright.
- Мобильные жесты: горизонтальный свайп переключает Обзор/Клиенты/Интерфейсы/
  Статистика (без зацикливания, не срабатывает на полях ввода и горизонтально
  прокручиваемых областях), свайп вниз закрывает шит «Ещё». Safe-area учтён
  слева/справа/снизу, для ландшафта — компактное горизонтальное меню.
  Проверено в Chromium на 390×844 и 844×390.

UI-этап закрыт.

## Не проверено / не доделано

### Блокеры перед production

1. **Реальный kernel.** `scripts/verify-kernel.sh --apply --netns` — 0 провалов
   (16.11.2026): модуль, `ip link add`, SetDevice, H*Range, S1–S4,
   REPLACE_PEERS, счётчики, ICMP и handshake между двумя AWG в netns.
   E2E worker: dry-run (`online`, `worker applied state`) и live (интерфейс,
   пиры, HPK, RandomTrailers применены; handshake с тестовым клиентом прошёл).
   Live-статистика worker проверена (п. 11). Полоса измерена iperf3, hairpin
   между двумя клиентами на одном интерфейсе проверен. Осталось: физические
   клиенты.
2. **tc ingress/egress.** Структура, квоты, счётчики и изоляция проверены;
   живая полоса измерена iperf3 на реальном `awgpanel0` (17.11.2026):
   - устройство 5/2 Mbit → 4.79/1.89 Mbit; после редактирования на 4/1 →
     3.74/0.84 Mbit;
   - устройство без тарифа 5/2 Mbit → 4.79/1.89 Mbit (исправлено);
   - групповой лимит 6/3 Mbit при device=0 → 5.62/2.73 Mbit (исправлена
     классификация);
   - снятие всех лимитов → `tc` и IFB удалены, 3.0/4.7 Gbit/s без шейпера.
   Исправлены: очистка tc при снятии лимитов, групповой лимит без лимита
   устройства, лимиты устройств без тарифа, публикация состояния при
   изменении тарифа/пользователя. Пул без `gateway` по-прежнему оставляет
   интерфейс без адреса.

   Hairpin проверен 18.11.2026 двумя клиентами на одном `awgpanel0`: ping и
   iperf3 в обе стороны (2.4–3.0 Gbit/s без лимитов), PATCH лимитов без потерь
   и без сброса endpoint'ов, изоляция пар работает при активном IFB, после
   down-only лимита IFB и redirect удаляются. Осталось: физические клиенты.
3. **nftables forwarding.** Закрыто (18.11.2026): таблица/цепь/правила и
   изоляция проверены на veth; live worker создаёт `fwd_<ifname>` на реальном
   интерфейсе. Два устройства на одном `awgpanel0` обмениваются ping/iperf3
   (hairpin), изоляция пар работает и при активном IFB, ответный трафик
   разрешается только через `established`-правила. `iifname` включает IFB,
   правила содержат `counter`.
4. **Docker-образы.** Закрыто: сборка и запуск проверены, healthcheck'и зелёные.
5. **TLS/ACME Traefik.** Локально проверены self-signed, HTTP/2, HTTP/3,
   редирект и health; живой стенд отдаёт h2/h3 с TRAEFIK DEFAULT CERT.
   Домен параметризован через `AWG_DOMAIN`, роутеры содержат `Host(...)`,
   HSTS настроен middleware'ами (admin-api-sec, frontend-hsts). `--static`
   проходит. Выпуск Let's Encrypt на реальном домене остаётся за стендом.
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
11. **Статистика worker в live-режиме.** Закрыто (16.11.2026):
    `backend/crates/worker/src/infrastructure/netlink.rs` отправляет
    `WG_CMD_GET_DEVICE` с `NLM_F_REQUEST | NLM_F_DUMP` и `WG_DEVICE_IFNAME`,
    собирает multipart-ответ до `NLMSG_DONE`, объединяет пиров из всех
    фрагментов. Причина прежнего `Operation not supported (os error 95)`: у
    команды в ядре только `.start`/`.dumpit`, запрос без dump-флага уходит в
    несуществующий `.doit`. Live-проверка (`unshare -rn`,
    `tests/live_dataplane.rs`): dump читается без ошибок, после ICMP через
    AWG-туннель растут `rx/tx`, есть `last_handshake`; повторный `SetDevice`
    проходит, а `ReconcileService::collect` отдаёт монотонные тоталы после
    сброса счётчиков через `CounterBook`.
13. **Живая полоса tc (iperf3).** Закрыто (17.11.2026): egress/ingress,
    лимиты устройства и группы, редактирование и снятие; см. п. 2.
14. **Инкрементальный reconcile пиров.** Закрыто (18.11.2026): `SetDevice`
    больше не использует `REPLACE_PEERS`; воркер применяет дельту (добавление,
    удаление, смена allowed IPs/PSK), поэтому endpoint'ы и handshake
    сохраняются, а PATCH лимитов/forwarding не вызывает обрыва трафика
    (проверено: 0% потерь ping). Ограничения: снятие PSK и смена PSK во время
    простоя воркера применяются при следующем изменении allowed IPs или
    пересоздании пира — ядро не отдаёт PSK в dump.
12. **Повторный reconcile tc.** Закрыто (16.11.2026): `htb` в root не
    поддерживает `replace`/`change` на проверочном ядре (Linux 7.3.4,
    iproute2 7.3.0). `TcShaper` теперь пересоздаёт root- и ingress-qdisc
    (`qdisc del` с игнором ошибки → `qdisc add`), из-за чего классы и фильтры
    тоже пересоздаются и не дублируются. `scripts/verify-dataplane.sh --apply`
    проверяет повторный reconcile: 0 провалов, дубликатов фильтров нет; live-тест
    `tests/live_dataplane.rs` применяет tc дважды на veth, `clear` удаляет
    правила. Там же nft применяется дважды: цепь `fwd_<ifname>` не накапливает
    дубликаты `drop`.

### Функционал

- **Импорт**: батч из нескольких интерфейсов, preview/apply, дедупликация по
  public key, откат при фатальной ошибке, импорт клиентов в существующий
  интерфейс с автоопределением по public key, diff (unchanged/update) и
  external peers из серверного конфига. Осталось: импорт серверных пиров без
  AllowedIPs и пакетное обновление существующих устройств сверх address/psk/name.
- **CIDR-пулы**: режимы `auto/rf_only/external_only` — только метки и выдача
  адресов; маршрутизация делается вне проекта (так согласовано). Нет проверки
  пересечения с адресами других групп и резервирования шлюзов на уровне БД.
- **Квоты**: состояние отдаётся в API (`/quota`, `/quota/users`), в UI есть
  прогресс, «осталось», дата сброса и предупреждение при превышении; worker
  получает `1 kbps`. Нет уведомлений (email/webhook) и настраиваемого периода —
  сброс календарный, раз в месяц.
- **Статистика**: часовые бакеты, агрегация на лету, текущая скорость
  (`rx_bps`/`tx_bps`) и средняя скорость в сериях, retention в настройках. Нет
  материализованных дневных/месячных таблиц и графиков по нескольким scope сразу.
- **Share-ссылки**: TTL, лимит использований и одноразовые ссылки, QR-коды для
  share и `vpn://`, отзыв по токену и списком. Нет журнала скачиваний и
  уведомления владельцу.
- **Ротация ключей интерфейса** инвалидирует клиентские конфиги; в UI есть
  предупреждение, но нет пакетного перевыпуска/доставки.
- **Пользователи**: регистрация с подтверждением email и одобрением админом,
  вход по email, TOTP 2FA с QR и recovery-кодами, сброс пароля по email,
  управление активными сессиями в профиле — сделаны. Нет SSO.
- **Ноды**: ротация токена и метрики воркера сделаны. Нет отзыва токена без
  выпуска нового и истории метрик (хранится только последний снимок).
- **Пиры**: нет QR, нет выбора нескольких интерфейсов при создании профиля,
  нет отдельного «профиля по умолчанию».
- **Forwarding UI**: сделано. Три режима (выкл / все свои / выбранные), матрица
  «источник × назначение» по устройствам пользователя, симметричные пары по
  умолчанию, список пар для мобильного, немедленное сохранение с откатом.
  Ограничение бэкенда: только устройства одного пользователя.
- **i18n**: ru/en для всех основных экранов (shell, auth, clients, nodes,
  interfaces, groups, stats, audit, import, profile, settings), локаль
  сохраняется; серверные сообщения показываются как есть.
- **A11y**: focus-trap, Escape и возврат фокуса в модалках, ARIA, skip-link,
  aria-live для тостов, `aria-busy` для загрузки.
- **Мобильное меню**: bottom nav + drawer, свайпы между разделами и закрытие
  шита вниз, safe-area слева/справа/снизу, компактный ландшафтный режим.

### Инфраструктура и качество

- CI добавлен: `.github/workflows/ci.yml` (fmt, clippy -D warnings, cargo test,
  pnpm typecheck/test/build, сборка трёх Docker-образов).
- Версионирование схемы redb сделано (`meta.schema_version`, каркас миграций).
- Backup/restore: методы `Store`, CLI `awg-backup backup|restore|info`,
  проверка `schema_version`, офлайн-замена. Ротации по расписанию нет.
- Prometheus-метрики (`/metrics`, опциональный Bearer), structured-логи
  (`AWG_LOG_FORMAT=json|text`) и OpenTelemetry OTLP/gRPC (`AWG_OTEL_ENDPOINT`)
  сделаны.
- E2E Playwright в CI: 26 тестов (Chromium+Firefox) — логин/RBAC, навигация,
  forwarding, квоты, аудит, регистрация/2FA, импорт.
- Нагрузочный тест REST — `scripts/loadtest-rest.sh` (wrk). Нагрузочных тестов
  gRPC и WebSocket нет.
- Hairpin-стенд оформлен: `scripts/verify-hairpin.sh` (18.11.2026) создаёт два
  устройства и netns, проверяет ping/iperf3, отсутствие обрыва при PATCH
  лимитов, IFB, down-only лимит и изоляцию; параметры через env/CLI, пароль
  sudo не хранится.
- OpenAPI не генерируется: `docs/API.md` поддерживается вручную. Для генерации
  нужен `utoipa` и разметка всех хендлеров — отдельная задача.
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
   Панель для просмотра на VPN-хосте (как запускалась последняя сессия):
   ```bash
   # backend на свободном порту (8080 занят другим процессом)
   set -a; . ./.env; set +a
   AWG_BIND=0.0.0.0:18080 AWG_GRPC_BIND=0.0.0.0:19090 \
   AWG_DB_PATH="$PWD/data/panel-demo.redb" \
   AWG_BILLING_ENABLED=true AWG_PAYMENT_PROVIDER=mock \
   AWG_PAYMENT_SECRET=panel-demo-secret-with-32-characters-min \
   ./target/debug/awg-admin &

   # frontend с проксированием API на backend
   cd frontend
   VITE_API_PROXY=http://10.100.0.5:18080 \
     ./node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort
   ```
   Открыть `http://10.100.0.5:5173`, логин `admin` / `admin12345` (из `.env`).
   БД `data/panel-demo.redb` содержит демо-данные: тариф, план, активная подписка,
   группа, нода, интерфейс, два устройства и share-ссылки. `data/dev.redb` не
   используется этим стендом.
3. Создайте ноду через UI, получите `AWG_NODE_ID`/`AWG_NODE_TOKEN`.
4. Запустите worker на Linux-хосте:
   ```bash
   docker compose --profile worker up -d --build
   # или локально:
   AWG_GRPC_URL=http://127.0.0.1:9090 AWG_NODE_ID=... AWG_NODE_TOKEN=... \
   AWG_DRY_RUN=false cargo run -p awg-worker
   ```
5. Блокеры kernel/tc/nft/ TLS описаны в `docs/PRODUCTION-VERIFICATION.md`;
   Docker, аудит, rate limit (включая общий redb-режим), JWT, CI/E2E,
   миграции/backup redb + CLI, lazy-роуты, архитектурные границы,
   регистрация/2FA, метрики, квоты, i18n и a11y уже закрыты.
- Производительность: списки и snapshot без N+1, prefetch lazy-чанков,
  sourcemaps выключены в production, i18n разбит на доменные модули.
- UI: QR-коды (share, vpn, 2FA), сессии, сброс пароля, skeleton, aria-live,
  мобильные карточки.
   Архитектура оплаты описана в `docs/PAYMENTS.md`; этапы 1–2 (модель, схема
   v2, API планов/подписок/счетов, checkout, webhook, mock-шлюз) реализованы.
   Нет реального провайдера, автосписаний/dunning и UI биллинга (этапы 3–4).

## Особенности окружения

- Firefox под Playwright/geckodriver в этом окружении запускается только с
  `LD_PRELOAD=""` (иначе SIGSEGV). Для ручной проверки: `LD_PRELOAD= firefox`.
- `frontend/public/select-repro.html` — стенд для проверки нативного
  `<select>` в Firefox, если будете возвращаться к этой теме.
- В dev-режиме Vite проксирует `/api` (включая WS) на `http://127.0.0.1:8080`.
- Порт 9090 gRPC в compose опубликован только на `127.0.0.1`; не выставляйте
  его наружу.
