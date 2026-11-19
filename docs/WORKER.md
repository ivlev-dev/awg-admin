# Worker — AmneziaWG node agent

Воркер — единственный компонент, который трогает `amneziawg` и `tc` на сервере.
Он подключается к админке исходящим gRPC-стримом, поэтому открытых портов не требует.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `AWG_GRPC_URL` | `http://127.0.0.1:9090` | gRPC-адрес админки |
| `AWG_GRPC_TLS_CA` | — | PEM CA для проверки admin; включает TLS |
| `AWG_GRPC_TLS_DOMAIN` | host из URL | SNI/имя сервера; включает TLS (system roots) |
| `AWG_GRPC_TLS_SYSTEM_ROOTS` | `false` | доверять системным корням; включает TLS |
| `AWG_GRPC_TLS_CLIENT_CERT` | — | PEM клиентский сертификат воркера (mTLS); только вместе с ключом и CA |
| `AWG_GRPC_TLS_CLIENT_KEY` | — | PEM ключ клиентского сертификата (mTLS) |
| `AWG_NODE_ID` | — | UUID ноды из админки (обязателен) |
| `AWG_NODE_TOKEN` | — | токен ноды, выдаётся один раз при создании (обязателен) |
| `AWG_DRY_RUN` | `false` | только логировать команды, ничего не применять |
| `AWG_COUNTERS_PATH` | `/var/lib/awg-worker/counters.json` | локальный снапшот счётчиков |
| `AWG_STATS_INTERVAL_SECS` | `2` | период опроса статистики |
| `RUST_LOG` | `info` | уровень логирования |

## TLS и mTLS

По умолчанию канал plaintext (h2c). TLS включается на воркере, если задан
`AWG_GRPC_TLS_CA`, `AWG_GRPC_TLS_DOMAIN` или `AWG_GRPC_TLS_SYSTEM_ROOTS=true`;
при этом воркер проверяет сертификат admin. Для взаимной аутентификации
дополнительно задаются `AWG_GRPC_TLS_CLIENT_CERT` и `AWG_GRPC_TLS_CLIENT_KEY`:
воркер предъявляет клиентский сертификат, подписанный CA из
`AWG_GRPC_TLS_CLIENT_CA` на стороне admin.

Правила валидации при старте:

- client cert и ключ задаются только вместе;
- client cert/ключ допустимы только при включённом TLS (CA/DOMAIN/SYSTEM_ROOTS) —
  иначе процесс завершается с ошибкой, так как mTLS без проверки сервера
  бессмыслен и небезопасен;
- файлы читаются при старте, PEM проверяется до подключения;
- без client cert/ключа поведение прежнее — server-auth TLS либо plaintext.

Выпуск CA и сертификатов, ротация и ограничения описаны в `OPERATIONS.md`,
раздел 9.1. Клиентский сертификат не заменяет `AWG_NODE_TOKEN`: токен
по-прежнему проверяется в `Hello`, mTLS лишь отсекает подключения без
доверенного клиентского сертификата на уровне TLS.

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
(`netlink-packet-amnezia-wireguard`, команда `SetDevice`).

Пиры применяются инкрементально, без `REPLACE_PEERS`: воркер читает dump,
добавляет отсутствующих, удаляет лишних (`WGPEER_F_REMOVE_ME`) и обновляет
изменившихся (`WGPEER_F_REPLACE_ALLOWEDIPS`). Неизменившиеся пиры в сообщение
не попадают, поэтому ядро сохраняет их endpoint'ы и handshake; PATCH лимитов
или forwarding больше не вызывает обрыва трафика. Смена PSK отслеживается
in-memory картой (ядро не отдаёт её в dump); снятие PSK и смена во время
простоя воркера применяются при следующем изменении allowed IPs или
пересоздании пира. Только netlink-слой меняет ядро; остальное идемпотентно.

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

Если up-план пуст (все `up_kbps = 0`, включая чисто групповые down-лимиты),
ingress-шейпинг не нужен: worker удаляет ingress-qdisc, match-all `mirred`
и `ifb-<iface>`. Иначе после перехода с up-лимита на down-лимит оставались бы
IFB и redirect без классов.

Лимит `0` означает «без ограничения». При превышении квоты тарифа админка присылает `1 kbps` —
это фактическая блокировка.

**Forwarding.** nftables-таблица `inet awg_admin`, отдельная цепь `fwd_<ifname>`:
на каждую разрешённую пару — прямое правило `accept` и обратное
`ct state established,related accept`, затем `counter drop` для остального
внутриинтерфейсного форвардинга. Матчер входящего интерфейса —
`iifname { "<ifname>", "ifb-<ifname>" }`: при ingress-шейпинге пакет приходит
уже с IFB, и без второго имени изоляция перестала бы применяться. Ответный
трафик разрешается только для уже установленных соединений, поэтому
выключение forwarding блокирует новые сессии сразу. Все правила содержат
`counter`, счётчики видны в `nft -a list chain`.

## Статистика и перезагрузка интерфейса

Счётчики читаются generic netlink-командой `WG_CMD_GET_DEVICE`. В ядре она
зарегистрирована только как dump (`.start`/`.dumpit`), поэтому запрос уходит с
`NLM_F_REQUEST | NLM_F_DUMP` и атрибутом `WG_DEVICE_IFNAME` (ядро требует ровно
один из `IFNAME`/`IFINDEX`). Ответ multipart: воркер собирает все сообщения до
`NLMSG_DONE`, объединяет пиров из всех фрагментов и выбирает устройство по имени.
Без dump-флага ядро отвечает `Operation not supported (os error 95)`.

Счётчики ядра монотонны, но обнуляются при пересоздании интерфейса или
удалении/повторном добавлении пира. Инкрементальный reconcile пиров не трогает
неизменившихся, поэтому рутинные применения состояния счётчики не сбрасывают.
Воркер хранит `CounterBook` (offset + last) в JSON-файле и при уменьшении сырого
значения добавляет предыдущее значение к offset. Наружу всегда отдаётся
монотонный тотал, поэтому админка не теряет трафик между перезагрузками,
reconcile и рестартами воркера.

## Проверка на живом ядре

```bash
scripts/verify-kernel.sh --apply --netns
scripts/verify-dataplane.sh --apply
sudo -E PANEL_PASSWORD=... scripts/verify-hairpin.sh --apply --group "VPN Pilot"
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
