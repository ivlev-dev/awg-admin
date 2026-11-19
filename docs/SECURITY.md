# Безопасность

## HTTP-заголовки безопасности

Frontend отдаёт nginx (`docker/nginx.conf`), API — Traefik через middleware
`admin-api-sec` (`docker-compose.yml`). Заголовки nginx заданы на уровне
`server` и повторены в `location ^~ /assets/`: в nginx `add_header` в location
заменяет набор родителя, поэтому без повтора `Cache-Control` вытеснил бы
security-заголовки.

| Заголовок | Значение | Где задаётся |
| --- | --- | --- |
| `Content-Security-Policy` (frontend) | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` | nginx: `server`, `location ^~ /assets/` |
| `Content-Security-Policy` (API) | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | Traefik: `admin-api-sec` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Traefik: `frontend-hsts`, `admin-api-sec` (только роутеры `websecure`) |
| `X-Content-Type-Options` | `nosniff` | nginx + Traefik `admin-api-sec` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | nginx + Traefik `admin-api-sec` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=()` | nginx |
| `X-Frame-Options` | `DENY` | nginx + Traefik `admin-api-sec` |
| `Cross-Origin-Opener-Policy` | `same-origin` | nginx |
| `Cache-Control` | `public, max-age=31536000, immutable` (только `/assets/*`) | nginx |

HSTS не отдаётся на HTTP: порт 80 отвечает `308` на HTTPS, middleware висит
только на HTTPS-роутерах. `includeSubDomains` требует, чтобы все поддомены
зоны тоже работали по HTTPS.

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
- `connect-src 'self' ws: wss:` — HTTP API и WebSocket `/api/v1/ws/stats`
  (живая статистика) на том же origin. Схемы `ws:`/`wss:` оставлены для
  работы за прокси, который может менять схему; ужесточение до `'self'`
  возможно после проверки HTTP/3-пути.
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

## Роли

- `Admin` — полный доступ к пользователям, тарифам, группам, нодам, интерфейсам, импорту, настройкам.
- `User` — доступ только к своим устройствам, профилям и статистике; admin-only эндпоинты возвращают `403`.

## Аутентификация

- Пароли хэшируются Argon2. Email при входе — не длиннее 254, пароль — не длиннее 1024 символов (валидация на входе и в identity); техническое поле `actor_login` в аудите хранит email и обрезается до 254 символов, поэтому попытки входа с огромным значением не раздувают журнал. В API то же значение отдаётся как `actor_email` (alias `actor_login`).
- JWT выдаются парой: access (по умолчанию 900 с) и refresh (30 дней); обновление через `/auth/refresh`, отзыв через `/auth/logout`.
- `POST /auth/password` всегда требует `current_password`; при включённом TOTP вместо пароля принимается действующий код (`totp_code`). Смена пароля отзывает все refresh-сессии.
- TOTP: SHA-1, 6 цифр, шаг 30 секунд, допуск ±1. Использованный шаг запоминается в `last_totp_step`; повторное использование того же шага (replay) отклоняется. `POST /auth/totp/setup` при уже включённом TOTP требует `password` и действующий `code`, новый секрет хранится как *pending* и не отключает 2FA до подтверждения через `/auth/totp/enable`.
- Refresh-токены одноразовые (ротация при обновлении), хранятся в redb, удаляются по TTL.
- Seed-администратор создаётся при первом запуске из `AWG_ADMIN_EMAIL`/`AWG_ADMIN_PASSWORD`; `AWG_ADMIN_LOGIN` удалён, вход только по email.

## Доверенные прокси и клиентский IP

- `AWG_TRUSTED_PROXIES` — IP/CIDR через запятую. Пока прямой peer не входит в список, `X-Forwarded-For`/`X-Real-IP` полностью игнорируются.
- Для доверенного прокси клиентский IP — первый справа хоп `X-Forwarded-For`, не входящий в trusted-сети (или адрес peer, если вся цепочка доверенная). Некорректные записи заголовка пропускаются.
- IP используется в rate limit (`login`, `refresh`, `register`, `resend`, `forgot`) и аудите; без trusted-списка подделка заголовка не влияет на лимиты.

## Dev-mail

- `GET/DELETE /api/v1/dev/mail` доступны только вне production и требуют `AWG_DEV_MAIL_TOKEN` либо access-токен администратора.
- В production маршрут всегда `404`, dev-mailbox не наполняется, а log-mailer не пишет ссылки с токенами в журнал.

## Шифрование секретов

- `AWG_MASTER_KEY` (32 байта base64) используется `Sealer` (ChaCha20-Poly1305) для шифрования приватных ключей устройств/интерфейсов в redb.
- При отсутствии ключа генерируется эфемерный; после рестарта хранимые секреты нечитаемы — ключ обязателен в production.
- JWT-секрет `AWG_JWT_SECRET` тоже не должен быть эфемерным.

## Share-токены и TTL

- Share-ссылка — случайный токен с `expires_at`; download публичный, но имеет срок жизни (`AWG_SHARE_TTL_SECS`, default 86400).
- В redb хранится только `token_hash = sha256(token)` (ключ таблицы `share_links`) и `token_sealed` — токен, зашифрованный `Sealer` (`AWG_MASTER_KEY`). Открытого токена в базе нет; plaintext возвращается только в ответе на создание и при чтении списка владельцем/admin.
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
- Опциональный mTLS: при заданном на admin `AWG_GRPC_TLS_CLIENT_CA` сервер
  требует клиентский сертификат и проверяет его подпись этим CA; worker
  предъявляет `AWG_GRPC_TLS_CLIENT_CERT`/`AWG_GRPC_TLS_CLIENT_KEY`. Оба
  параметра задаются только вместе и только при включённом TLS. Без
  client CA сервер остаётся в режиме server-auth.
- mTLS не заменяет `AWG_NODE_TOKEN`: CN сертификата не связывается с
  `node_id`, CRL/OCSP нет, отзыв клиентского сертификата выполняется
  ротацией CA. Подробности — `OPERATIONS.md`, раздел 9.1.

## Рекомендации по развертыванию

- TLS и HTTP/3 — на Traefik; backend работает по h2c только внутри сети.
- Для admin↔worker за пределами одной доверенной сети включайте gRPC TLS.
- Не публиковать порт `9090` наружу.
- Worker-контейнеру нужны `NET_ADMIN`, `SYS_MODULE` для netlink/tc/nft.
- Использовать сильные `AWG_MASTER_KEY`, `AWG_JWT_SECRET`, пароль admin; менять дефолтный `admin/admin12345`.

## Аудит зависимостей

CI job `security` проверяет зависимости параллельно сборке (`docker`/`e2e`
его не ждут). `continue-on-error` не используется: найденная уязвимость
делает job красным.

- Rust: `cargo audit --deny warnings` — падение на уязвимостях, а также на
  `unmaintained`/`unsound`/`yanked`-advisory.
- Frontend: `pnpm audit --audit-level high --prod` — только production-зависимости
  уровня `high` и `critical`.

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

Закрыто в ходе аудита: per-key идемпотентность, доверенные прокси для
`X-Forwarded-For`, закрытый dev-mailbox, обязательный текущий пароль,
TOTP anti-replay, каскадное удаление пользователя, корректный отзыв
share-ссылок, TTL-очистка, права групп/интерфейсов, публикации после
изменений, шифрование бэкапов Android, sensitive clipboard, release-логи,
PIN lockout, https-only, CSP `connect-src 'self'`, refresh auth-эндпоинтов,
logout-гонки, WebSocket reconnect, CSV-инъекции, share-токены at rest
(`sha256` + `Sealer`, схема 11).

Осознанно оставлено (требует отдельного этапа):

- Access/refresh-токены панели хранятся в `localStorage`. Для полного
  устранения XSS-риска нужен переход на `HttpOnly; Secure; SameSite` cookies
  и CSRF-токен на backend.
- gRPC worker gateway по умолчанию работает без TLS; TLS включается
  сертификатом (server-auth), mTLS — дополнительным клиентским CA на admin и
  сертификатами worker. mTLS не заменяет токен ноды и не поддерживает
  CRL/OCSP, поэтому отзыв — только ротацией CA.
- Блокирующие операции redb и argon2 выполняются в async-контексте; нужен
  `spawn_blocking`/отдельный writer-пул.
- per-group mutex и worker registry локальны для процесса; для нескольких
  реплик нужны транзакционные блокировки и общий реестр сессий.
- CORS при пустом `AWG_CORS_ORIGINS` разрешает любой origin; в production
  задавайте явный список.
- Android: remote-control receiver остаётся exported для Tasker (защита —
  shared key + PIN), PIN-библиотека хранит PIN внутри своего хранилища
  (добавлен только счётчик попыток), `QUERY_ALL_PACKAGES` нужен split
  tunneling.
- Release-подпись и публикация Android пока не настроены.
- Импорт конфигураций обновляет primary-пир интерфейса; для выбора
  конкретного пира нужен peer-scoped импорт.
