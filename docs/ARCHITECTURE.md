# Архитектура awg-admin

## Общая схема

```
Traefik (TLS/HTTP3) -> admin (h2c, порт 8080)
worker -> admin (gRPC, порт 9090, внутри сети)
admin -> redb (файл /data/awg-admin.redb)
```

- `admin` принимает HTTP/1.1 и h2c; TLS терминируется в Traefik.
- `worker` подключается к `admin` по gRPC `WorkerGateway.Session` и получает желаемое состояние, применяет его и шлёт статистику.
- Хранилище — единственный `redb` файл, монтируемый в контейнер.

## Bounded contexts

Backend (`backend/crates/*`) разбит на доменные модули. Зависимости направлены внутрь: presentation зависит от application/domain, infrastructure реализует порты.

- `shared` — shared kernel: `obf`, `conf`, `vpn`, `cidr`, `crypto`.
- `storage` — репозиторий `Store`.
- `identity` — пользователи, роли, Argon2, JWT.
- `tariffs` — тарифы и лимиты.
- `network` — группы, ноды, интерфейсы, пулы CIDR, obfuscation-настройки.
- `clients` — устройства, пирь, профили, share-ссылки.
- `statistics` — агрегация трафика, scope.
- `orchestration` — worker registry, desired state, снапшот, приём статистики.
- `proto` — protobuf-контракты gRPC.
- `admin` — composition root, presentation (controllers/models/views), маршруты.
- `worker` — применение состояния на хосте.

## Слои

Каждый контекст держит слои `domain/application/infrastructure` (worker явно, остальные по аналогии). Presentation (`admin`) использует MVC:

- контроллеры (`controllers/*`) — handlers;
- модели (`models.rs`) — DTO запросов;
- представления (`views.rs`) — сериализация ответов;
- `main.rs` — composition root, собирает сервисы и AppState.

Frontend (`frontend/src`) использует MVVM на silent-framework:

- `domain`, `application`, `infrastructure`, `app/features`;
- View (`*.tsx`) + ViewModel (`*.vm.ts`);
- `app` — router, session, theme, toast, DI через container-синглтоны.

## Worker

Модули:
- `domain`: `DesiredState`, `CounterBook`;
- `application`: `ReconcileService`;
- `infrastructure`: `netlink`, `tc`, `nft`, `grpc`, `counters`.

Архитектура application строится на trait-портах: `AwgControl`, `TrafficShaper`, `ForwardingControl`, `CounterRepository`.

## Потоки

### Создание пира

`DeviceService` создаёт устройство и пирь → `SnapshotBuilder` строит desired state с публичными ключами/IP → gRPC отправляет `DesiredState` → worker применяет netlink/tc/nft.

### Статистика

worker читает счётчики интерфейсов → `CounterBook` нормализует переполнения/перезагрузки → `StatsSnapshot` по gRPC → admin агрегирует в `statistics` → раздаёт по WebSocket `/api/v1/ws/stats`.

## Обфускация AWG 3.1

- `H1-H4`: диапазоны в зонах `100000`, `1000000`, `2000000`, `3000000`, ширина не более `HEADER_ZONE_WIDTH` (20 000). Для `RandomTrailers` зоны узкие (см. `header_ranges_stay_in_zone_and_narrow`).
- `S1-S4`: floor `S_FLOOR_WITH_HPK = 12`; генерация без коллизий суммарных размеров (`sizes_never_collide`).
- `Jc`, `Jmin`, `Jmax` для junk-пакетов; `I1-I5` — HTTP/3 mimicry (QUIC/TLS), браузерные размеры с выравниванием до 128 для Chrome/Edge/Safari.
- Кодек `vpn://`: сжатие конфига и AWG-параметров в base64-url.

## CIDR и forwarding

- Группа имеет `base_cidr`; пулы (`CidrPool`) выделяют поддиапазоны устройствам и интерфейсам.
- Forwarding между устройствами пользователя выражается `ForwardingRule` и применяется nftables-правилами.

## Тарифы

- Тариф задаёт лимиты на устройство (`device_down/up_kbps`) и группу (`group_down/up_kbps`), `max_devices`, `traffic_quota_bytes`.
- При превышении квоты device-скорость ограничивается до `1 kbps`; групповые лимиты применяются через HTB/tc.
```

Need worker env etc in WORKER.md. Write.<|end|><|start|>advisor to=write_file<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
awg-admin/docs/WORKER.md