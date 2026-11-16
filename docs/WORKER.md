# Worker — AmneziaWG node agent

Воркер — единственный компонент, который трогает `amneziawg` и `tc` на сервере.
Он подключается к админке исходящим gRPC-стримом, поэтому открытых портов не требует.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `AWG_GRPC_URL` | `http://127.0.0.1:9090` | gRPC-адрес админки |
| `AWG_NODE_ID` | — | UUID ноды из админки (обязателен) |
| `AWG_NODE_TOKEN` | — | токен ноды, выдаётся один раз при создании (обязателен) |
| `AWG_DRY_RUN` | `false` | только логировать команды, ничего не применять |
| `AWG_COUNTERS_PATH` | `/var/lib/awg-worker/counters.json` | локальный снапшот счётчиков |
| `AWG_STATS_INTERVAL_SECS` | `2` | период опроса статистики |
| `RUST_LOG` | `info` | уровень логирования |

## Протокол сессии

1. Воркер открывает `WorkerGateway.Session` и отправляет первым сообщением `Hello { node_id, token, version }`.
2. Админка проверяет токен (sha256-хеш в БД), регистрирует сессию и отправляет `DesiredState`.
3. Воркер применяет состояние и отправляет `ApplyResult { revision, ok, error }`.
4. Каждые `AWG_STATS_INTERVAL_SECS` секунд отправляется `StatsSnapshot`:
   `interface_id`, `peer.device_id`, монотонные `rx_total`/`tx_total`, `last_handshake`.
5. Админка шлёт `Ping` каждые 20 секунд; при разрыве воркер переподключается с задержкой.

При изменении сущностей админка пересобирает снапшот и пушит его в активную сессию ноды.

## DesiredState

Для каждого интерфейса передаются:

- `private_key`, `listen_port`, `mtu`, `addresses` (шлюзы пулов);
- обфускация: `H1..H4` (диапазоны), `S1..S4`, `HeaderProtectionKey`, `RandomTrailers`;
- пиры: `public_key`, `preshared_key`, `allowed_ips` (/32), `addresses` (CIDR пула), лимиты;
- `user_limits` — тарифные лимиты группы устройств пользователя;
- `forwarding` — разрешённые пары устройств (по IP).

## Применение

**AmneziaWG.** Интерфейс создаётся через `ip link add … type amneziawg` (если отсутствует),
адреса — `ip addr replace`, затем параметры и пиры — generic netlink
(`netlink-packet-amnezia-wireguard`, команда `SetDevice` с `Flags = REPLACE_PEERS`).
Только netlink-слой меняет ядро; остальное идемпотентно.

**tc.**

- egress: `htb` на интерфейсе, класс `1:1` (сумма лимитов пользователей),
  пользовательские классы `1:100+i`, классы устройств `1:1000+…`, фильтры `u32 match ip dst`.
- ingress: `ingress` qdisc → `mirred` в `ifb-<iface>`, на IFB те же HTB-классы и фильтры `match ip src`.

Применение идемпотентно. `htb` в root не поддерживает `replace`/`change`
(`Change operation not supported by specified qdisc`), поэтому worker удаляет
root- и ingress-qdisc и создаёт их заново: `qdisc del … root` (ошибка
игнорируется) → `qdisc add … root handle 1: htb`, то же для `handle ffff: ingress`.
Удаление qdisc сбрасывает старые классы и фильтры, поэтому дубликаты `u32`
не накапливаются между reconcile. На время пересоздания (доли секунды) трафик
идёт без шейпера. `clear` удаляет root/ingress qdisc и IFB.

Лимит `0` означает «без ограничения». При превышении квоты тарифа админка присылает `1 kbps` —
это фактическая блокировка.

**Forwarding.** nftables-таблица `inet awg_admin`, отдельная цепь `fwd_<ifname>`:
разрешающие правила `iifname/oifname + ip saddr/daddr`, затем `drop` для остального
внутриинтерфейсного форвардинга. Это изолирует устройства друг от друга по умолчанию.

## Статистика и перезагрузка интерфейса

Счётчики читаются generic netlink-командой `WG_CMD_GET_DEVICE`. В ядре она
зарегистрирована только как dump (`.start`/`.dumpit`), поэтому запрос уходит с
`NLM_F_REQUEST | NLM_F_DUMP` и атрибутом `WG_DEVICE_IFNAME` (ядро требует ровно
один из `IFNAME`/`IFINDEX`). Ответ multipart: воркер собирает все сообщения до
`NLMSG_DONE`, объединяет пиров из всех фрагментов и выбирает устройство по имени.
Без dump-флага ядро отвечает `Operation not supported (os error 95)`.

Счётчики ядра монотонны, но обнуляются при пересоздании интерфейса или пира:
`SetDevice` с `REPLACE_PEERS` пересоздаёт пиров при каждом применении состояния.
Воркер хранит `CounterBook` (offset + last) в JSON-файле и при уменьшении сырого
значения добавляет предыдущее значение к offset. Наружу всегда отдаётся
монотонный тотал, поэтому админка не теряет трафик между перезагрузками,
reconcile и рестартами воркера.

## Проверка на живом ядре

```bash
scripts/verify-kernel.sh --apply --netns
scripts/verify-dataplane.sh --apply
unshare -rn -- cargo test -p awg-worker --test live_dataplane -- --ignored --test-threads=1
```

Live-тесты `tests/live_dataplane.rs` поднимают AWG-интерфейс, гоняют ICMP через
туннель и проверяют полный путь `ReconcileService::apply/collect`: dump-статистику,
монотонные тоталы после повторного `SetDevice`, двукратное применение tc и nft.
Нужны `CAP_NET_ADMIN` (запуск под `unshare -rn`), модуль `amneziawg` и утилиты
`awg`, `tc`, `nft`.

## Запуск

```bash
docker compose --profile worker up -d --build
```

Требования: Linux с загруженным модулем `amneziawg`, `network_mode: host`,
`privileged: true`, `NET_ADMIN`, `SYS_MODULE`, смонтированный `/lib/modules`.
