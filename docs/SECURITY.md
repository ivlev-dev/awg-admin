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

- Пароли хэшируются Argon2.
- JWT выдаются парой: access (по умолчанию 900 с) и refresh (30 дней); обновление через `/auth/refresh`, отзыв через `/auth/logout`.
- Seed-администратор создаётся при первом запуске из `AWG_ADMIN_EMAIL`/`AWG_ADMIN_PASSWORD`; `AWG_ADMIN_LOGIN` остаётся legacy-логином для поиска существующей записи.

## Шифрование секретов

- `AWG_MASTER_KEY` (32 байта base64) используется `Sealer` (ChaCha20-Poly1305) для шифрования приватных ключей устройств/интерфейсов в redb.
- При отсутствии ключа генерируется эфемерный; после рестарта хранимые секреты нечитаемы — ключ обязателен в production.
- JWT-секрет `AWG_JWT_SECRET` тоже не должен быть эфемерным.

## Share-токены и TTL

- Share-ссылка — случайный токен с `expires_at`; download публичный, но имеет срок жизни (`AWG_SHARE_TTL_SECS`, default 86400).
- Отзыв: `DELETE /shares/{token}`.

## Worker-токены

- Токен ноды передаётся через `AWG_NODE_TOKEN` и проверяется как sha256-хэш при `Hello` (gRPC).
- Порт `9090` не должен быть публичным; рекомендуется сеть docker-compose.

## Рекомендации по развертыванию

- TLS и HTTP/3 — на Traefik; backend работает по h2c только внутри сети.
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

- gRPC worker gateway не использует TLS внутри (ожидается внутренняя сеть); внешний TLS на Traefik покрывает клиентский HTTP, но не gRPC.
- h2c backend ожидает proxy с поддержкой h2c (Traefik `h2c`).
- Self-signed сертификаты для HTTP/3 не используются; выпускаются нормальные сертификаты в Traefik.

## Аудит

- HTTP-запросы логируются `TraceLayer`; изменения состояния worker логируются на уровне info/error.
- При неуспешном применении state worker возвращает `ApplyResult.ok=false` с текстом ошибки.
