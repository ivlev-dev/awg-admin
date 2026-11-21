# Безопасность

## HTTP-заголовки безопасности

Frontend отдаёт nginx (`docker/nginx.conf`), API — Traefik через middleware
`admin-api-sec` (`docker-compose.yml`). Заголовки nginx заданы на уровне
`server` и повторены в `location /assets/`, `location ~* \.html$` и
`location ~* \.map$`: в nginx `add_header` в location заменяет набор родителя,
поэтому без повтора `Cache-Control` вытеснил бы security-заголовки.

| Заголовок | Значение | Где задаётся |
| --- | --- | --- |
| `Content-Security-Policy` (frontend) | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` | nginx: `server` + повтор в `location /assets/`, `location ~* \.html$`, `location ~* \.map$` |
| `Content-Security-Policy` (API) | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | Traefik: `admin-api-sec` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Traefik: `frontend-hsts`, `admin-api-sec` (только роутеры `websecure`) |
| `X-Content-Type-Options` | `nosniff` | nginx + Traefik `admin-api-sec` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | nginx + Traefik `admin-api-sec` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=()` | nginx |
| `X-Frame-Options` | `DENY` | nginx + Traefik `admin-api-sec` |
| `Cross-Origin-Opener-Policy` | `same-origin` | nginx |
| `Cache-Control` | `public, max-age=31536000, immutable` (только `/assets/*`) | nginx |

HSTS не отдаётся на HTTP: Traefik публикует порт 80 (entrypoint `web`,
`AWG_TRAEFIK_HTTP_BIND`, по умолчанию `0.0.0.0`) и отвечает `301` на HTTPS,
middleware висит только на HTTPS-роутерах. ACME работает через TLS-ALPN на
443, поэтому для выпуска сертификата порт 80 не нужен; если он занят на хосте,
задайте `AWG_TRAEFIK_HTTP_BIND=127.0.0.1` или не используйте профиль `tls`.
`includeSubDomains` требует, чтобы все поддомены зоны тоже работали по HTTPS.

CSP API ограничивает только документы/встраивание: ответы JSON, `default-src`
там не влияет на работу SPA.

## Компромиссы CSP

- `style-src 'unsafe-inline'` обязателен: компоненты используют inline
  `style="..."` (silent JSX), включая вычисляемые значения (прогресс квоты,
  цвета статусов). Убрать атрибуты или перейти на CSS-переменные/классы, затем
  заменить на nonce/хэш — отдельная задача.
- `script-src 'self'` без `'unsafe-inline'` и `'unsafe-eval'`: собранный
  `index.html` содержит только внешние `<script type="module" src="/assets/...">`,
  inline-скриптов и eval нет. При добавлении инлайн-бутстрапа потребуется
  nonce.
- `connect-src 'self'` — HTTP API и WebSocket `/api/v1/ws/stats`
  (живая статистика) на том же origin. По CSP Level 3 `'self'` покрывает
  `ws:`/`wss:` того же хоста, поэтому отдельные схемы не нужны; проверено на
  HTTP/2 и HTTP/3-пути. При появлении API на другом origin добавьте его явно.
- `img-src 'self' data:` и `font-src 'self' data:` — только локальные ресурсы;
  внешних CDN, шрифтов и картинок приложение не использует.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` — двойная защита от
  clickjacking (XFO для старых браузеров).

Остаточные риски: inline-style не защищён nonce; нет `Trusted Types`
(`require-trusted-types-for 'script'`); нет `Cross-Origin-Embedder-Policy` /
`Cross-Origin-Resource-Policy`. Карты исходников в production-образ не попадают
(`VITE_SOURCEMAP=false`), а nginx отвечает `404` на `*.map`.

## Проверка заголовков

```bash
curl -sSI http://127.0.0.1:8081/ | grep -Ei 'content-security|x-content|referrer|permissions|x-frame|cross-origin'
curl -sSI http://127.0.0.1:8081/assets/<asset>.js | grep -Ei 'cache-control|content-security'
curl -sSI -k https://127.0.0.1/ | grep -i strict-transport-security
curl -sSI -k https://127.0.0.1/api/v1/health | grep -Ei 'content-security|strict-transport|x-content'
```

Проверка на дубли (nginx не должен отдавать заголовок дважды):

```bash
curl -sSI http://127.0.0.1:8081/ | awk -F': ' 'NF>1{print tolower($1)}' | sort | uniq -d
```

Ожидаемо: пустой вывод. CSP на frontend и API намеренно разные, поэтому при
проверке через Traefik у `/` и `/api` значения `content-security-policy`
отличаются.

Проверка CSP в браузере: DevTools → Console не должен содержать
`Refused to apply inline style` / `Refused to load`, логин и переходы по
разделам работают, WebSocket статистики подключается (`101 Switching
Protocols`).

## Docker API и Traefik

- Traefik не монтирует `/var/run/docker.sock`. Провайдер `docker` в
  `docker/traefik.yml` ходит на `tcp://docker-socket-proxy:2375` — это
  `tecnativa/docker-socket-proxy` из профиля `tls` с allowlist только на
  чтение: `CONTAINERS`, `NETWORKS`, `SERVICES`, `TASKS`, `EVENTS`, `PING`,
  `VERSION` = 1; `POST`, `EXEC`, `IMAGES`, `VOLUMES`, `SECRETS`, `CONFIGS`,
  `SYSTEM`, `SWARM` = 0.
- Компрометация Traefik после этого не даёт создавать контейнеры, монтировать
  хостовые каталоги и выполнять команды через Docker API.
- `docker-socket-proxy` подключён только к internal-сети `docker-socket`;
  admin и frontend в ней не состоят и Docker API не видят.
- Если Traefik перестал видеть контейнеры: проверьте `docker compose --profile tls ps`
  и логи `docker-socket-proxy`. При добавлении новых ресурсов (например swarm)
  расширяйте allowlist осознанно, а не включением `POST=1`.

## Роли

- `Admin` — полный доступ к пользователям, тарифам, группам, нодам, интерфейсам, импорту, настройкам.
- `User` — доступ только к своим устройствам, профилям и статистике; admin-only эндпоинты возвращают `403`.

## Аутентификация

- Пароли хэшируются Argon2. Политика: минимум **10** символов, максимум 1024 байта, пароль не должен входить в список распространённых (`password`, `qwerty123` и т.п.) и не должен совпадать с локальной частью email. Email при входе — не длиннее 254 символов (валидация на входе и в identity); техническое поле `actor_login` в аудите хранит email и обрезается до 254 символов, поэтому попытки входа с огромным значением не раздувают журнал. В API то же значение отдаётся как `actor_email` (alias `actor_login`).
- JWT выдаются парой: access (по умолчанию 900 с, `AWG_ACCESS_TTL_SECS`) и refresh (30 дней, `AWG_REFRESH_TTL_SECS`); обновление через `/auth/refresh`, отзыв через `/auth/logout`.
- Refresh-токены одноразовые (ротация при каждом `/auth/refresh`: старый отзывается, выдаётся новый), хранятся в redb и удаляются по TTL. Отзыв одной refresh-сессии — `/auth/logout` с refresh-токеном или `DELETE /auth/sessions/{jti}`; отзыв всех refresh — `/auth/logout-all` или смена/сброс пароля.
- Access-токены stateless, но с per-user epoch (`user_access_epochs`, схема 15). `authenticate` на каждом запросе проверяет существование и активность пользователя и сравнивает `iat` с epoch. `logout-all`, смена/сброс пароля и блокировка повышают epoch и гасят ранее выданные access-токены; `logout` и `DELETE /auth/sessions/{jti}` отзывают только refresh, поэтому access такой сессии живёт до `exp` (не дольше `AWG_ACCESS_TTL_SECS`). Токен, выданный в ту же секунду, что и epoch, принимается — иначе вход сразу после отзыва ломался бы.
- `POST /auth/password` всегда требует `current_password`; при включённом TOTP вместо пароля принимается действующий код (`totp_code`). Смена пароля отзывает все refresh-сессии и повышает epoch.
- TOTP: SHA-1, 6 цифр, шаг 30 секунд, допуск ±1. Использованный шаг запоминается в `last_totp_step`; повторное использование того же шага (replay) отклоняется, причём проверка и запись шага сериализуются мьютексом на пользователя. `POST /auth/totp/setup` всегда требует `password`; при уже включённом TOTP — ещё и действующий `code`. Новый секрет хранится как *pending* и не отключает 2FA до подтверждения через `/auth/totp/enable`, который требует `password` + `code`. Recovery-коды: 8 штук по 128 бит энтропии (32 hex-символа), в хранилище — Argon2-хэши, одноразовые.
- Самостоятельная регистрация отключается `AWG_REGISTRATION_ENABLED=false`: `POST /auth/register` отвечает `403 registration_disabled`. При включённой регистрации существующий email даёт тот же `202`, что и новый, — перечисление аккаунтов через регистрацию невозможно.
- Seed-администратор создаётся при первом запуске из `AWG_ADMIN_EMAIL`/`AWG_ADMIN_PASSWORD`; `AWG_ADMIN_LOGIN` удалён, вход только по email.

## Доверенные прокси и клиентский IP

- `AWG_TRUSTED_PROXIES` — IP/CIDR через запятую. Пока прямой peer не входит в список, `X-Forwarded-For`/`X-Real-IP` полностью игнорируются.
- Для доверенного прокси клиентский IP — первый справа хоп `X-Forwarded-For`, не входящий в trusted-сети (или адрес peer, если вся цепочка доверенная). Некорректные записи заголовка пропускаются.
- IP используется в rate limit (`login`, `refresh`, `register`, `resend`, `forgot`) и аудите; без trusted-списка подделка заголовка не влияет на лимиты.
- `docker-compose.yml` фиксирует подсеть сети `web` (`172.30.0.0/24`, `networks.web.ipam`) и по умолчанию подставляет `AWG_TRUSTED_PROXIES=172.30.0.0/24`, чтобы за Traefik лимиты считались по реальному IP клиента, а не по адресу контейнера прокси. Если меняете подсеть — обновите и `AWG_TRUSTED_PROXIES`, иначе заголовки снова начнут игнорироваться.
- Доверять всей docker-сети безопасно только потому, что порты `8080`/`9090` admin опубликованы на `127.0.0.1` и в сеть `web` не попадает ничего, кроме admin, frontend и Traefik. Не подключайте к `web` сторонние контейнеры.
- В dev-окружении (`docker-compose.dev.yml`) по умолчанию `127.0.0.1/32`.

## Dev-mail

- `GET/DELETE /api/v1/dev/mail` доступны только вне production и требуют `AWG_DEV_MAIL_TOKEN` либо access-токен администратора.
- В production маршрут всегда `404`, dev-mailbox не наполняется, а log-mailer не пишет ссылки с токенами в журнал.

## Шифрование секретов

- `AWG_MASTER_KEY` (32 байта base64) используется `Sealer` (ChaCha20-Poly1305) для шифрования приватных ключей устройств/интерфейсов в redb.
- При отсутствии ключа генерируется эфемерный; после рестарта хранимые секреты нечитаемы — ключ обязателен в production.
- JWT-секрет `AWG_JWT_SECRET` тоже не должен быть эфемерным.
- SMTP (`AWG_MAIL_MODE=smtp`) работает только по TLS: схема `smtp://` включает обязательный STARTTLS (`Tls::Required`, порт по умолчанию 587), `smtps://` — implicit TLS (465). Открытый текст и молчаливый fallback на plaintext невозможны: lettre обрывает соединение, если STARTTLS не удался. `AWG_SMTP_URL` и `AWG_SMTP_FROM` обязательны при `AWG_MAIL_MODE=smtp`.
- Backup redb содержит приватные ключи. Планировщик создаёт каталог с правами `0700`, файлы — `0600` (на Unix); при копировании на другой носитель права нужно сохранить и шифровать внешние копии.

## CORS и WebSocket

- `AWG_CORS_ORIGINS` — явный список origin (scheme + host + port). Пустое значение **не** включает `*`: cross-origin браузерные запросы отклоняются, same-origin работает без CORS-заголовков. Wildcard `*` в списке — ошибка старта.
- В `Access-Control-Allow-Headers` входят `Authorization`, `Content-Type`, `Accept`, `X-Request-Id` и `Idempotency-Key`.
- WebSocket статистики больше не принимает access-токен в query по умолчанию: клиент получает одноразовый 30-секундный тикет через `POST /api/v1/ws/ticket` и подключается с `?ticket=...`. Старый флоу `?token=` включается только `AWG_ALLOW_WS_TOKEN=true` и остаётся остаточным риском (токен может попасть в логи, прокси и историю браузера). Тикет привязан к `user_id` + `scope`, одноразовый, живёт в памяти процесса.
- `AWG_ENV` fail-closed: код по умолчанию считает окружение `development`, но `docker-compose.yml` подставляет `production`; в production обязательны `AWG_MASTER_KEY`, `AWG_JWT_SECRET` (≥32 байт) и пароль admin, отличный от `admin12345`.

## Share-токены и TTL

- Share-ссылка — случайный токен с `expires_at`; download публичный, но имеет срок жизни (`AWG_SHARE_TTL_SECS`, default 86400).
- В redb хранятся два поля: `token_hash = sha256(token)` (ключ таблицы `share_links`) и `token_sealed` — токен, зашифрованный `Sealer` (`AWG_MASTER_KEY`). В открытом виде токена в БД нет, но `token_sealed` обратим: при компрометации одновременно файла БД и мастер-ключа все активные share-ссылки можно восстановить. Ссылки отзывайте при подозрении на утечку ключа. Plaintext-токен возвращается в ответе на создание и при чтении списка владельцем/admin.
- `GET /share/{token}` не отдаёт конфиг для revoked/expired/exhausted ссылок (`403`), неизвестный токен — `404`.
- Отзыв: `DELETE /shares/{token}`; доступен владельцу устройства, создателю ссылки или admin, неизвестный токен — `404`. Вместо удаления ставится `revoked_at` (история), активная ссылка перестаёт работать сразу.
- Отозванные ссылки хранятся 30 дней и затем удаляются фоновой очисткой; истёкшие удаляются в ту же задачу.
- Миграция схемы `10 → 11` (`v11_share_token_hash`) пересчитывает хэш и запечатывает существующие токены, перенося записи на новые ключи; для legacy-ссылок при открытии БД нужен `AWG_MASTER_KEY`.

## Очистка TTL

Раз в час (и при старте) фоновая задача удаляет: idempotency-записи старше 24 часов, истёкшие `email_verifications`, истёкшие и давно отозванные share-ссылки. Redb-операции выполняются в `spawn_blocking`; временные `*.tmp-*` файлы backup чистятся при старте и после снимка.

## Worker-токены

- Токен ноды передаётся через `AWG_NODE_TOKEN` и проверяется как sha256-хэш при `Hello` (gRPC).
- Порт `9090` не должен быть публичным; рекомендуется сеть docker-compose.
- Транспорт gRPC по умолчанию plaintext (h2c). Server-auth TLS включается
  `AWG_GRPC_TLS_CERT`/`AWG_GRPC_TLS_KEY` на admin; worker доверяет серверу по
  `AWG_GRPC_TLS_CA`, `AWG_GRPC_TLS_DOMAIN` (system roots) или
  `AWG_GRPC_TLS_SYSTEM_ROOTS=true`.
- Admin fail-closed в production: если TLS не настроен и `AWG_GRPC_BIND` не
  loopback-адрес, старт завершается ошибкой; plaintext на loopback разрешён с
  предупреждением. Worker по-прежнему не анализирует удалённость `AWG_GRPC_URL`
  и не отказывается от plaintext — выбор TLS для канала за пределами
  доверенной сети остаётся задачей деплоя (остаточный риск).
- Опциональный mTLS: при заданном на admin `AWG_GRPC_TLS_CLIENT_CA` сервер
  требует клиентский сертификат и проверяет его подпись этим CA; worker
  предъявляет `AWG_GRPC_TLS_CLIENT_CERT`/`AWG_GRPC_TLS_CLIENT_KEY`. Оба
  параметра задаются только вместе и только при включённом TLS. Без
  client CA сервер остаётся в режиме server-auth.
- mTLS не заменяет `AWG_NODE_TOKEN`: CN сертификата не связывается с
  `node_id`, CRL/OCSP нет, отзыв клиентского сертификата выполняется
  ротацией CA. Подробности — `OPERATIONS.md`, раздел 9.1.

## Рекомендации по развертыванию

- `AWG_ENV` — обязательная для осознанного выбора переменная. Образ admin и код
  backend по умолчанию считают окружение `development`; `docker-compose.yml`
  подставляет безопасное `production` (`${AWG_ENV:-production}`), поэтому без
  `.env` контейнер не стартует без `AWG_MASTER_KEY`, `AWG_JWT_SECRET` и
  сменённого пароля admin. Для локального запуска задайте
  `AWG_ENV=development` либо используйте `docker-compose.dev.yml`.
- TLS и HTTP/3 — на Traefik; backend работает по h2c только внутри сети.
- `GET /metrics`: при заданном `AWG_METRICS_TOKEN` нужен `Authorization:
  Bearer`; без корректного токена — `401`. В production без токена `/metrics`
  отвечает `404`; в development без токена он открыт. Порт `8080` не
  публикуйте наружу.
- Для admin↔worker за пределами одной доверенной сети включайте gRPC TLS.
- Не публиковать порт `9090` наружу; в compose он привязан к `127.0.0.1`.
- Worker-контейнеру нужны `NET_ADMIN`, `SYS_MODULE` для netlink/tc/nft.
- Worker не получает `.env` admin: в compose ему переданы только
  `AWG_NODE_ID`, `AWG_NODE_TOKEN`, `AWG_GRPC_*`, `AWG_DRY_RUN`,
  `AWG_COUNTERS_PATH`, `AWG_STATS_INTERVAL_SECS`. `AWG_MASTER_KEY`,
  `AWG_JWT_SECRET`, SMTP и платёжные секреты в контейнер worker не попадают.
- Использовать сильные `AWG_MASTER_KEY`, `AWG_JWT_SECRET`, пароль admin; менять дефолтный `admin/admin12345`.
- Образы в Dockerfile'ах и `docker-compose.yml` запинены по digest, версии
  GitHub Actions — по commit SHA. Обновление — только PR от Dependabot с
  зелёными `rust`/`frontend`/`docker`/`e2e`; тег без digest ломает
  воспроизводимость сборки.
- Контейнеры запускаются с `no-new-privileges:true` (admin, frontend, traefik,
  socket-proxy); worker работает `privileged` — это осознанное исключение,
  ограничивайте его отдельной нодой.

## Аудит зависимостей

CI job `security` проверяет зависимости параллельно сборке (`docker`/`e2e`
его не ждут). `continue-on-error` не используется: найденная уязвимость
делает job красным.

- Rust: `cargo audit --deny warnings` — падение на уязвимостях, а также на
  `unmaintained`/`unsound`/`yanked`-advisory.
- Frontend: `pnpm audit --audit-level high --prod` — только production-зависимости
  уровня `high` и `critical`.
- Job `Dependencies policy` — `cargo deny check` по `deny.toml`: advisories (RustSec, `yanked = deny`),
  лицензии (allowlist), `bans` (`multiple-versions = "deny"` + список известных
  дублей в `skip`) и `sources` (разрешены только crates.io и один git-репозиторий
  `netlink-packet-amnezia-wireguard`). Новый дубль зависимости или незнакомая
  лицензия делают job красным — это намеренно: дубль нужно либо убрать, либо
  осознанно добавить в `skip` с комментарием.
- Версии GitHub Actions запинены по commit SHA с комментарием-тегом; обновляет
  Dependabot (`.github/dependabot.yml`, ecosystem `github-actions`).

Игнорируемые advisory перечислены в `.cargo/audit.toml` с обоснованием. Текущий
список: `RUSTSEC-2024-0436` (`paste` 1.0.15, unmaintained, транзитивно через
`netlink-packet-core`; фикса и замены нет, в рантайме не эксплуатируется).

Локальный прогон:

```bash
cargo install --locked cargo-audit --version 0.23.0   # один раз
cargo audit --deny warnings

cd frontend
pnpm install --frozen-lockfile
pnpm audit --audit-level high --prod
```

Проверка только конкретного advisory: `cargo audit --json | jq '.warnings'`,
`pnpm audit --json`. Обновление базы RustSec — `cargo audit update-db`
(в CI база скачивается при каждом запуске).

### Реакция на advisory

1. Определите достижимость: `cargo tree -i <crate>` для Rust,
   `pnpm why <package>` для frontend. Если уязвимый код не используется —
   это всё равно фиксируется, но приоритет ниже.
2. Проверьте наличие исправленной версии (`cargo audit` печатает `Solution`,
   `pnpm audit --fix` предлагает `override`/`update`).
3. Обновите зависимость точечно (`cargo update -p <crate> --precise <ver>`,
   `pnpm update <package>` или override в `package.json`), прогоните
   `cargo test --workspace`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
4. Если фикса нет: добавьте advisory в `.cargo/audit.toml` (Rust) или
   зафиксируйте принятый риск в `docs/TODO.md` (frontend), с причиной,
   оценкой эксплуатируемости и сроком пересмотра (не более 90 дней).
5. Не подавляйте advisory «на время» без записи: игнор без обоснования
   не проходит review.

### Политика обновлений

- Dependabot (`.github/dependabot.yml`) еженедельно открывает PR: cargo,
  npm (`frontend`), github-actions, docker (`docker/`) и docker-compose.
  Patch/minor группируются, major приходят отдельными PR с лимитом 5.
- Security-обновления приходят отдельными PR вне групп и мержатся первыми.
- Автомержа нет: обязательны зелёные `rust`, `frontend`, `security`
  (и `docker`/`e2e` для изменений, влияющих на образы и рантайм).
- Перед мержем major-обновления проверяются changelog и обратная совместимость;
  для Rust — `cargo test --workspace`, для frontend — typecheck, unit, build,
  для docker/compose — `docker compose build`.

## Ограничения

- gRPC worker gateway по умолчанию работает без TLS; TLS включается
  сертификатом (server-auth), mTLS — дополнительно `AWG_GRPC_TLS_CLIENT_CA`
  на admin и клиентским сертификатом worker (см. `OPERATIONS.md`, 9.1).
- h2c backend ожидает proxy с поддержкой h2c (Traefik `h2c`).
- Self-signed сертификаты для HTTP/3 не используются; выпускаются нормальные сертификаты в Traefik.

## Аудит

- HTTP-запросы логируются `TraceLayer`; изменения состояния worker логируются на уровне info/error.
- При неуспешном применении state worker возвращает `ApplyResult.ok=false` с текстом ошибки.

## Остаточные риски после аудита 2026-11

Состояние на 21.11.2026 (включая инфраструктурные правки в
`docker-compose*.yml`, `docker/Dockerfile.*` и `.github/workflows/ci.yml`).

Закрыто в ходе аудита: per-key идемпотентность, доверенные прокси для
`X-Forwarded-For`, закрытый dev-mailbox, обязательный текущий пароль,
TOTP anti-replay и 128-битные recovery-коды, пароль при setup/enable TOTP,
отзыв access через epoch, отключаемая регистрация, политика паролей,
SMTP только по TLS, маскирование share-токенов в аудите, аудит 4xx-мутаций,
каскадное удаление пользователя, корректный отзыв share-ссылок, TTL-очистка,
права групп/интерфейсов, публикации после изменений, шифрование бэкапов
Android, sensitive clipboard, release-логи, PIN lockout, https-only, CSP
`connect-src 'self'`, refresh auth-эндпоинтов, logout-гонки, WebSocket
reconnect, WS-тикет вместо токена в query, CSV-инъекции, share-токены at rest
(`sha256` + `Sealer`, схема 11), `no-new-privileges` для
admin/frontend/traefik, Docker API только через socket-proxy с allowlist,
пины базовых образов по digest и GitHub Actions по SHA, `env_file` убран у
worker, порты dev-стека на loopback, `cargo deny` в CI, фиксированная подсеть
сети `web`, fail-closed `AWG_ENV` в compose, права backup `0600`/`0700`,
production-проверка plaintext gRPC на не-loopback.

Осознанно оставлено (требует отдельного этапа):

- Access/refresh-токены панели хранятся в `localStorage`. Для полного
  устранения XSS-риска нужен переход на `HttpOnly; Secure; SameSite` cookies
  и CSRF-токен на backend.
- `logout` и `DELETE /auth/sessions/{jti}` отзывают только refresh: access
  этой конкретной сессии живёт до `exp`. Отозвать access точечно нельзя —
  токены stateless, а epoch действует на все сессии пользователя; для полного
  отзыва используйте `logout-all`.
- Тяжёлые блокирующие операции (Argon2, полные обходы таблиц, импорт, backup,
  запись аудита и статистики) вынесены в `spawn_blocking`. Часть точечных
  чтений redb (`state.devices.get`, `state.identity.find` и т.п.) в async-хендлерах
  остаётся синхронной: на малых объёмах это микросекунды, но при медленном
  диске такие чтения могут задерживать runtime-поток.
- `AWG_ALLOW_WS_TOKEN=true` возвращает передачу access-токена в query
  WebSocket. Это совместимость для старых клиентов, а не рекомендуемый режим:
  токен может осесть в access-логах и истории браузера.
- Ограничители, реестр worker-сессий и per-key/per-group блокировки локальны
  для процесса. Несколько реплик admin требуют `AWG_RATE_LIMIT_STORE=redb` и
  общего `AWG_DB_PATH`, но registry сессий и часть блокировок всё равно
  остаются single-instance допущением; горизонтальное масштабирование без
  внешней координации не поддерживается.
- gRPC worker gateway: admin в production отказывается от plaintext на
  не-loopback, но worker не проверяет `AWG_GRPC_URL` и может подключиться по
  plaintext к удалённому адресу. mTLS не заменяет токен ноды, не связывает CN
  с `node_id` и не поддерживает CRL/OCSP, поэтому отзыв — только ротация CA.
- Загружаемые серверные и клиентские конфиги (импорт) проходят структурную
  валидацию, но не антивирусную проверку и не sandbox-анализ; файлы разбираются
  как текст, исполняемого кода не содержат, однако это не заменяет AV-скан
  вложений на периметре.
- Общая CSP по-прежнему разрешает inline-стили (`style-src 'unsafe-inline'`):
  это нужно для вычисляемых `style="..."` в компонентах.
- Android: remote-control receiver остаётся exported для Tasker (защита —
  shared key + PIN), PIN-библиотека хранит PIN внутри своего хранилища
  (добавлен только счётчик попыток), `QUERY_ALL_PACKAGES` нужен split
  tunneling.
- Release-подпись и публикация Android пока не настроены.
- Импорт конфигураций обновляет primary-пир интерфейса; для выбора
  конкретного пира нужен peer-scoped импорт.
