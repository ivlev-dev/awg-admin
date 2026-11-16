# Безопасность

## Роли

- `Admin` — полный доступ к пользователям, тарифам, группам, нодам, интерфейсам, импорту, настройкам.
- `User` — доступ только к своим устройствам, профилям и статистике; admin-only эндпоинты возвращают `403`.

## Аутентификация

- Пароли хэшируются Argon2.
- JWT выдаются парой: access (по умолчанию 900 с) и refresh (30 дней); обновление через `/auth/refresh`, отзыв через `/auth/logout`.
- Seed-администратор создаётся при первом запуске из `AWG_ADMIN_LOGIN`/`AWG_ADMIN_PASSWORD`.

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

## Ограничения

- gRPC worker gateway не использует TLS внутри (ожидается внутренняя сеть); внешний TLS на Traefik покрывает клиентский HTTP, но не gRPC.
- h2c backend ожидает proxy с поддержкой h2c (Traefik `h2c`).
- Self-signed сертификаты для HTTP/3 не используются; выпускаются нормальные сертификаты в Traefik.

## Аудит

- HTTP-запросы логируются `TraceLayer`; изменения состояния worker логируются на уровне info/error.
- При неуспешном применении state worker возвращает `ApplyResult.ok=false` с текстом ошибки.
```

Now write WORKER.md.<|end|><|start|>advisor to=write_file<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
awg-admin/docs/WORKER.md