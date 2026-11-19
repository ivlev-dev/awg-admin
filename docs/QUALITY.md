# Качество и бюджеты

Документ описывает автоматические гейты качества, их пороги и порядок
локального запуска. Все проверки встроены в GitHub Actions и не требуют
ручного вмешательства при обычном pull request.

## Гейты CI

| Workflow / job | Что проверяет | Команда | Порог |
| --- | --- | --- | --- |
| `ci.yml` → `Rust` | форматирование, clippy, тесты workspace | `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` | без предупреждений и падений |
| `ci.yml` → `Frontend` | типы, архитектурные границы, unit-тесты, сборка | `pnpm typecheck`, `pnpm arch:check`, `pnpm test`, `pnpm build` | без ошибок |
| `ci.yml` → `Security` | уязвимости зависимостей | `cargo audit --deny warnings`, `pnpm audit --audit-level high --prod` | нет high/critical |
| `ci.yml` → `Docker` | сборка образов admin, worker, frontend | `docker build` | образы собираются |
| `ci.yml` → `E2E` | сквозные сценарии в реальном compose-стеке | `pnpm e2e --project=chromium` | все тесты проходят |
| `ci.yml` → `Performance budgets` | gzip-размер фронтенда и debug APK | `node scripts/check-frontend-size.mjs`, `../scripts/check-android-size.sh --mode debug` | см. ниже |
| `android.yml` → `quality` | форматирование, unit-тесты, lint, debug-сборка | `./gradlew formatCheck testFdroidDebugUnitTest lintFdroidDebug assembleFdroidDebug` | без ошибок |
| `android.yml` → `migration` | instrumentation-тесты на API 34 и 36 | `connectedFdroidDebugAndroidTest` | все тесты проходят |

### E2E

Job `E2E` поднимает только `admin` и `frontend`:

```bash
docker compose build admin frontend
docker compose up -d --no-build admin frontend
```

Traefik не запускается: он вынесен в профиль `tls`, поэтому порты 80/443 в CI
не занимаются. Admin доступен на `127.0.0.1:8080`, frontend — на
`127.0.0.1:8081`. Job ждёт одновременно `GET /ready` (проверка схемы redb и
отсутствия shutdown) и ответ frontend, затем запускает Playwright в Chromium.
При падении выгружаются `frontend/playwright-report` и
`frontend/test-results`; шаг `docker compose down -v --remove-orphans`
выполняется всегда.

Firefox-проект остаётся доступным локально:

```bash
cd frontend
pnpm e2e --project=firefox
```

## Бюджеты фронтенда

Скрипт: `scripts/check-frontend-size.mjs`. Запускается после `pnpm build` из
корня репозитория.

```bash
cd frontend && pnpm build && cd ..
node scripts/check-frontend-size.mjs
```

Бюджеты считаются по gzip (1 KiB = 1024 байта):

| Метрика | Порог | Что входит |
| --- | --- | --- |
| Initial JS | **160 KiB** | entry-чанк и все `modulepreload` из `dist/index.html` |
| CSS | **25 KiB** | все `.css` в `dist/assets` |
| All JS (guardrail) | **420 KiB** | все `.js` в `dist/assets`, включая lazy-чанки |

Initial JS — это то, что браузер скачивает до первого рендера; именно эта
метрика была около 117 KiB (≈120 КБ) на момент введения бюджета. Общая сумма
JS выше, потому что маршруты и локали вынесены в отдельные ленивые чанки; для
неё действует отдельный широкий guardrail, чтобы контролировать общий рост.

Пороги можно переопределить аргументами:

```bash
node scripts/check-frontend-size.mjs \
  --js-gzip=170 \
  --css-gzip=28 \
  --total-js-gzip=450 \
  --dist=frontend/dist
```

Скрипт печатает топ-5 начальных чанков, топ-5 всех чанков и итоговые значения
с процентом использования бюджета. При превышении любого порога exit code 1.

### Как обновлять бюджет

1. Запустите сборку и скрипт, убедитесь, что рост осознан.
2. Найдите причину роста: новый тяжёлый чанк в топ-5 или увеличение entry.
3. Предпочтительно уменьшить размер: ленивая загрузка, разделение локалей,
   вынос тяжёлых зависимостей.
4. Если рост оправдан, обновите константы `DEFAULTS` в
   `scripts/check-frontend-size.mjs` (или пороги в `ci.yml`, если используется
   переопределение) и зафиксируйте причину в описании PR.
5. Обновите таблицу выше и фактические цифры в этом документе.

## Бюджеты Android

Скрипт: `scripts/check-android-size.sh`.

```bash
# автовыбор: release при полном наборе signing-переменных, иначе debug
scripts/check-android-size.sh

# принудительно debug (универсальный APK)
scripts/check-android-size.sh --mode=debug

# принудительно release (нужен keystore)
KEY_STORE_PATH=/path/release.jks \
SIGNING_STORE_PASSWORD=... \
SIGNING_KEY_ALIAS=... \
SIGNING_KEY_PASSWORD=... \
scripts/check-android-size.sh --mode=release

# измерить уже собранные APK без запуска Gradle
scripts/check-android-size.sh --no-build
```

| Режим | Артефакт | Порог |
| --- | --- | --- |
| release | `fdroid/release/*-arm64*.apk` | **12 MiB** |
| debug | универсальный `fdroid/debug/*.apk` | **95 MiB** |

Release-сборка требует `KEY_STORE_PATH`, `SIGNING_STORE_PASSWORD`,
`SIGNING_KEY_ALIAS` и `SIGNING_KEY_PASSWORD`. Если ключа нет, скрипт не ломает
сборку, а переходит в debug-режим и проверяет универсальный debug APK. Debug
APK содержит отладочные символы нативных библиотек, поэтому его порог заметно
выше; сравнивать debug и release между собой нельзя.

Пороги переопределяются аргументами `--arm64-limit-mib` и
`--universal-limit-mib`.

### Как обновлять бюджет

1. Соберите APK и запустите скрипт.
2. Проверьте, что рост не вызван случайно добавленными ресурсами, шрифтами или
   нативными библиотеками.
3. Если рост оправдан, обновите значения по умолчанию
   `ARM64_LIMIT_MIB` / `UNIVERSAL_LIMIT_MIB` в скрипте и таблицу выше.
4. Для release-порога ориентируйтесь на arm64 split, а не на универсальный APK.

## Backend performance smoke

Скрипт: `scripts/check-backend-perf.sh`. Использует ignored-тест
`backend/crates/clients/tests/paging_flow.rs::measure_paging_over_1k_and_10k`,
который наполняет in-memory redb 1 000 и 10 000 устройств и измеряет выборку
страниц по 50 записей.

```bash
# release, порог 50 мс на последнюю страницу 10k
scripts/check-backend-perf.sh

# debug, порог 250 мс
scripts/check-backend-perf.sh --debug

# свой порог
scripts/check-backend-perf.sh --threshold-ms=80
```

Проверяется страница с offset 9950 (последняя страница 10k набора): она
нагружает сортировку и фильтрацию сильнее всего. Скрипт парсит
машиночитаемую строку теста:

```text
devices=10000 seed=... pages=[(0, 150.533µs, 10000), (5000, 507.188µs, 10000), (9950, 864.024µs, 10000)] filtered=5.714158ms total=9
```

Фактические значения на эталонной машине (release): последняя страница
10k — около **0.86 мс**, фильтрованная выборка — около **5.7 мс**. Порог
50 мс оставляет большой запас на медленные CI-раннеры. Debug-порог 250 мс
используется при локальной отладке без оптимизаций.

Если формат вывода теста изменится, скрипт завершится с ошибкой парсинга —
это сигнал обновить регулярное выражение вместе с тестом.

## Локальный чек-лист перед PR

```bash
# скрипты
bash -n scripts/check-android-size.sh scripts/check-backend-perf.sh
node --check scripts/check-frontend-size.mjs

# фронтенд
cd frontend
pnpm typecheck
pnpm test
pnpm build
cd ..
node scripts/check-frontend-size.mjs

# backend
cargo test --workspace
scripts/check-backend-perf.sh

# android (при наличии SDK)
scripts/check-android-size.sh --mode=debug

# e2e (нужен Docker; Traefik не обязателен)
docker compose build admin frontend
docker compose up -d --no-build admin frontend
cd frontend && pnpm e2e --project=chromium
cd .. && docker compose down -v --remove-orphans
```

## Ограничения

- E2E в CI использует только Chromium; Firefox запускается вручную.
- Android release-бюджет проверяется только при наличии signing-секретов;
   в обычном PR проверяется debug APK.
- Backend perf smoke — это регрессионный порог, а не бенчмарк. Он не заменяет
  профилирование и не измеряет сеть или HTTP-слой.
- Пороги привязаны к текущим зависимостям и конфигурации сборки; после крупных
  обновлений фреймворка их нужно пересмотреть.
