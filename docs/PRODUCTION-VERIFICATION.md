# Приёмка production-блокеров

Документ закрывает блокеры из [`docs/TODO.md`](TODO.md), которые нельзя проверить
в обычном CI: реальное ядро AmneziaWG, shaping через `tc`, `nftables`-forwarding,
сборка Docker-образов, TLS/ACME, фиксированный мастер-ключ, HTTP/3 и WebTransport.

Для воспроизводимых частей есть три скрипта:

| Скрипт | Что проверяет | Нужен root | Нужен реальный домен |
|---|---|---|---|
| `scripts/verify-kernel.sh` | модуль `amneziawg`, `ip link add … type amneziawg`, `SetDevice` (H1–H4Range, S1–S4, HPK, RandomTrailers), `REPLACE_PEERS`, счётчики, ICMP между двумя AWG-интерфейсами | только для `--apply` без `--netns` | нет |
| `scripts/verify-dataplane.sh` | HTB egress/IFB ingress, `u32`, лимиты 1 kbit, `inet awg_admin` + `fwd_<ifname>`, изоляция и разрешённые пары на veth | нет при доступных user namespaces | нет |
| `scripts/verify-tls.sh` | редирект http→https, HTTP/2, HSTS, сертификат, `/api/v1/health`, HTTP/3, статический аудит Traefik | нет | для ACME — да |

Все скрипты по умолчанию работают в режиме dry-run. Разрушающие действия
выполняются только с `--apply`, в одноразовом network namespace, где это возможно.
Все скрипты идемпотентны: временные интерфейсы, правила и каталоги удаляются в
`trap`.

## Матрица проверки на текущей машине

Проверочный хост: Linux 7.3.4, модуль `amneziawg` 3.1.20261113-02 (DKMS),
`iproute2` 7.3.0, `nftables` 1.1.7, `curl` 8.23.0 с HTTP/3, Docker 29.9.3,
нерабочий root (uid 1000), доступны unprivileged user namespaces.

| Блокер | Проверено здесь | Требует отдельного хоста/домена |
|---|---|---|
| 1. Ядро/SetDevice/REPLACE_PEERS/счётчики | да: `verify-kernel.sh --apply --netns` — все пункты `ok` | e2e через реальный worker + admin |
| 2. tc HTB + IFB + u32 и лимиты | да: `verify-dataplane.sh --apply` — структура, трафик, счётчики классов | hairpin `iifname == oifname` и замер реальной полосы между устройствами |
| 3. nftables forwarding | да: таблица/цепь/правила, ICMP разрешённой пары, изоляция | реальная пара устройств на одном AWG-интерфейсе |
| 4. Docker build | нет: образы `awg-admin`/`awg-worker` отсутствуют | сборка на хосте с сетью до git-зависимости |
| 5. TLS/ACME | частично: `verify-tls.sh --local` — Traefik + self-signed, h2, h3, health | ACME на реальном домене с DNS и портами 80/443 |
| 6. Мастер-ключ | нет: `.env` отсутствует | запущенный admin с redb |
| 7. HTTP/3 за Traefik | да: локальный Traefik, `curl --http3-only` → `http_version=3` | UDP/443 на реальном хосте |
| 8. WebTransport | не реализовано в коде — проверять нечего | — |

## Общие предусловия

- Linux, `iproute2`, `nftables`, `kmod`, `util-linux` (`unshare`, `nsenter`),
  `curl`, `openssl`, `ping`. Для `--netns` — разрешённые unprivileged user
  namespaces (`sysctl kernel.unprivileged_userns_clone=1`).
- `awg` (amneziawg-tools) для проверки `SetDevice` без worker. Без него
  `verify-kernel.sh` проверит только создание/удаление интерфейса.
- Docker Engine и Docker Compose v2 для блокеров 4, 5, 7.
- Репозиторий с `docker-compose.yml`, `docker/traefik.yml`, `scripts/*.sh`.

Запуск из корня репозитория:

```bash
bash -n scripts/verify-kernel.sh scripts/verify-dataplane.sh scripts/verify-tls.sh
command -v shellcheck >/dev/null && shellcheck scripts/verify-*.sh
```

---

## Блокер 1. Реальное ядро AmneziaWG

### Предусловия

- Загружаемый модуль `amneziawg` версии 3.1+ (нужны H1–H4Range, RandomTrailers,
  HeaderProtectionKey). Проверка: `modinfo amneziawg`, `lsmod | grep amneziawg`.
- `ip`, `awg`, `ping`, `unshare`, `nsenter`.
- Для e2e: запущенный admin, нода с токеном, группа, пул и интерфейс.

### Команды

```bash
./scripts/verify-kernel.sh                       # dry-run: только чтение и печать команд
./scripts/verify-kernel.sh --apply --netns       # без root, всё в одноразовом user+net namespace
sudo ./scripts/verify-kernel.sh --apply          # на хосте, временный интерфейс awgverify0
./scripts/verify-kernel.sh --inspect awg0        # только чтение живого интерфейса
```

Скрипт проверяет:

1. `modinfo`/`/proc/modules`/`/sys/module/amneziawg`, версию 3.1+;
2. `ip link add dev awgverify0 type amneziawg`, MTU, адрес, `ip link set up`,
   `ip -d link show` (тип `amneziawg`), `ip link del`;
3. `awg setconf` с полным набором параметров, которые worker отправляет через
   netlink `SetDevice`: `H1 = 100100-100200`, `H2 = 1000100-1000200`,
   `H3 = 2000100-2000200`, `H4 = 3000100-3000200`, `S1..S4`, `Jc/Jmin/Jmax`,
   `HeaderProtectionKey`, `RandomTrailers = on`, два пира;
4. чтение конфигурации назад (`awg showconf`) и наличие двух пиров в ядре;
5. `REPLACE_PEERS`: повторный `setconf` с одним пиром удаляет второй;
6. `awg show dump` — счётчики peer читаются;
7. сквозной трафик: два awg-интерфейса в двух изолированных netns, реальный
   handshake, ICMP, рост rx/tx и `latest handshake`.

### Ожидаемый результат

`[ok]` по всем пунктам, итог `провалено: 0`, код возврата 0.

### E2E через worker (обязательная часть блокатора)

```bash
# 1. В UI создайте ноду, группу, пул и интерфейс (имя 1..15 символов [A-Za-z0-9_-]).
# 2. Пропишите в .env:
#    AWG_NODE_ID=<uuid>, AWG_NODE_TOKEN=<token>
# 3. Запустите worker на Linux-хосте:
AWG_DRY_RUN=false docker compose --profile worker up -d --build

# 4. Проверьте, что состояние применилось:
docker compose logs --tail=100 worker | grep -E "worker applied state|ApplyResult|error"
ip -d link show <ifname>                       # тип amneziawg, MTU из интерфейса
awg show <ifname>                              # H1-H4, S1-S4, jc/jmin/jmax, HPK, random trailers, пиры
awg show <ifname> dump                         # rx/tx и latest handshake
cat /var/lib/awg-worker/counters.json | jq .   # offset/last по ключу "<ifname>|<pubkey>"
```

Проверка счётчиков и перезагрузки интерфейса:

1. Подключите два устройства, прогоните трафик между ними, убедитесь, что
   `awg show <ifname>` показывает `transfer` и `latest handshake`.
2. Удалите интерфейс на хосте: `sudo ip link del <ifname>`.
3. Дождитесь следующего reconcile (изменение любой сущности или рестарт worker).
   Worker пересоздаст интерфейс (`netlink.rs: ensure_interface`).
4. В UI статистика по устройствам/пирам не должна уменьшиться: `CounterBook`
   при уменьшении сырого значения добавляет предыдущее к offset
   (`domain/mod.rs`). Агрегат по интерфейсу считается из сырых байтов и может
   уменьшиться — см. п. 11 в разделе расхождений.

### Откат

```bash
sudo ip link del <ifname>        # если интерфейс остался
docker compose --profile worker down
```

При `--apply --netns` откат не нужен: namespace уничтожается вместе с процессом.
`verify-kernel.sh --apply` удаляет `awgverify0` в `trap`, даже при ошибке.

### Критерий «блокер закрыт»

- `verify-kernel.sh --apply` (или `--apply --netns`) — 0 провалов;
- worker с `AWG_DRY_RUN=false` применяет состояние (`ApplyResult ok`), нода online;
- `awg show <ifname>` содержит H1–H4, S1–S4, HPK и `random trailers: on`;
- реальный handshake и ненулевые счётчики; после пересоздания интерфейса
  статистика в UI не убывает.

---

## Блокер 2. tc: HTB egress, IFB ingress, фильтры u32, лимиты

### Предусловия

- Ядро с `sch_htb`, `cls_u32`, `ifb`, `act_mirred`, `sch_ingress`.
- `iproute2` 6.x+; для проверки трафика — `ping` и `nsenter`.
- Понимание фактической схемы worker (`backend/crates/worker/src/infrastructure/tc.rs`):
  - egress: `qdisc replace … root handle 1: htb default 1`; класс `1:1`
    (rate = сумма групповых лимитов пользователей); пользовательские классы
    `1:100 + i`; классы устройств `1:1000 + user_index*100 + peer_index`;
  - фильтры `u32 match ip dst <ip>/32 flowid 1:<device>`;
  - ingress: `ingress` qdisc → `mirred egress redirect dev ifb-<ifname>`, на IFB
    те же HTB-классы и фильтры `match ip src`;
  - лимит `0` в классе заменяется на `10gbit`, при квоте тарифа приходит `1 kbit`.

### Команды

```bash
./scripts/verify-dataplane.sh                 # dry-run: план и готовность окружения
./scripts/verify-dataplane.sh --apply         # всё в одноразовом netns, root не нужен
./scripts/verify-dataplane.sh --apply --no-traffic   # только структура tc/nft
```

Что проверяется на veth (без реального AWG):

- `htb 1:` на тестовом интерфейсе, классы `1:1`, `1:100`, `1:101`,
  устройства `1:1000` (parent `1:100`) и `1:1101` (parent `1:101`);
- `u32`-фильтры egress по `dst` (в выводе `tc` — hex-значение и offset 16);
- применение `rate 1kbit` (фактическая блокировка по квоте);
- `ingress` qdisc, `mirred` в `ifb-awgtest0`, HTB и фильтр `ip src` на IFB;
- ICMP через два netns: разрешённая пара проходит, счётчики классов egress и IFB растут;
- после `flush chain` + один `drop` трафик блокируется (изоляция);
- повторный `tc filter add` (как при каждом reconcile worker) — дубликат фильтра;
  скрипт печатает `[warn]`.

### Реальная проверка лимитов (отдельный хост)

```bash
# На интерфейсе с двумя устройствами:
tc -s qdisc show dev <ifname>
tc -s class show dev <ifname>
tc -s class show dev ifb-<ifname>
tc filter show dev <ifname> parent 1:

# iperf3: сервер на устройстве B, клиент на A
iperf3 -s                                    # на B
iperf3 -c <ip-B> -t 20 -R                   # down, ограничен down_kbps устройства
iperf3 -c <ip-B> -t 20                      # up, ограничен up_kbps
# два устройства одного пользователя одновременно — сумма не выше group_*_kbps
```

Ожидаемо: скорость устройства не превышает `down_kbps`/`up_kbps`, сумма по
пользователю не превышает групповой лимит, при квоте — около 1 kbit.

### Откат

```bash
tc qdisc del dev <ifname> root 2>/dev/null || true
tc qdisc del dev <ifname> ingress 2>/dev/null || true
ip link del ifb-<ifname> 2>/dev/null || true
# или удалить интерфейс в UI — worker вызовет TcShaper::clear
```

### Критерий «блокер закрыт»

- `verify-dataplane.sh --apply` — 0 провалов (warn о дубликатах фильтров допустим);
- на реальном интерфейсе классы и фильтры соответствуют схеме выше;
- iperf3 подтверждает ограничение устройства и суммы пользователя;
- квота `1 kbit` реально ограничивает трафик.

### Замечания, найденные при проверке

- `tc filter add` не идемпотентен: каждый reconcile добавляет новый фильтр,
  старые не удаляются. Shaping не ломается, но набор правил растёт. Нужен
  `filter replace` или предварительный `flush`.
- `DesiredInterface.group_down_kbps`/`group_up_kbps` в `tc.rs` не используются:
  корневой класс считается как сумма `user_limits`. Если `user_limits` пуст,
  корень получает `10gbit`.
- `tc.rs` создаёт классы только для пиров с ненулевым лимитом в данном
  направлении; пир с `down_kbps = 0` не получает egress-класс.

---

## Блокер 3. nftables forwarding

### Предусловия

- `nftables` 1.x, права `CAP_NET_ADMIN` (или unprivileged netns).
- На интерфейсе должно быть минимум два устройства пользователя.

### Команды

```bash
./scripts/verify-dataplane.sh --apply
```

Скрипт создаёт `table inet awg_admin`, цепь `fwd_awgtest0` с
`type filter hook forward priority 10`, правило разрешённой пары
(`iifname`/`oifname` + `ip saddr`/`ip daddr` + `accept`) и завершающий `drop`.
Проверяется текст правил, прохождение ICMP для разрешённой пары и блокировка
после замены правил на один `drop`.

На реальном AWG-интерфейсе:

```bash
nft list table inet awg_admin
nft list chain inet awg_admin fwd_<ifname>
# в UI разрешите обмен между устройствами A и B и проверьте ping в обе стороны
# затем запретите — ping должен перестать проходить
```

Worker использует то же имя интерфейса в `iifname` и `oifname` (hairpin внутри
одного AWG-интерфейса). На veth это состояние недостижимо, поэтому скрипт
проверяет эквивалентную пару `iifname dp-r1` / `oifname dp-r2`.

### Откат

```bash
nft flush chain inet awg_admin fwd_<ifname>
nft delete chain inet awg_admin fwd_<ifname>
# nft delete table inet awg_admin   # удалит цепи ВСЕХ интерфейсов, используйте осознанно
```

После удаления таблицы worker пересоздаст её при следующем reconcile.

### Критерий «блокер закрыт»

- `verify-dataplane.sh --apply` — 0 провалов;
- на реальном интерфейсе по умолчанию устройства изолированы;
- разрешённая в UI пара обменивается трафиком в обе стороны;
- `nft list chain inet awg_admin fwd_<ifname>` содержит ожидаемые пары и `drop`.

---

## Блокер 4. Сборка Docker-образов

### Предусловия

- Docker Engine + Compose v2, доступ в сеть (в `Cargo.toml` есть git-зависимость
  `netlink-packet-amnezia-wireguard`).
- Свободное место под Rust release-сборку.

### Команды

```bash
docker compose config --quiet
docker compose build --pull
docker images | grep -E 'awg-(admin|worker|frontend)'

docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/api/v1/health

# admin не должен работать от root
docker run --rm --entrypoint sh awg-admin:latest -c 'id'

# в worker-образе есть инструменты для netlink/tc/nft
docker run --rm --entrypoint sh awg-worker:latest -c \
  'ip -V; tc -V; nft --version; modprobe --version'
```

### Ожидаемый результат

- три образа собираются без ошибок;
- `admin` и `frontend` — `healthy`, `worker` подключается к admin;
- admin работает от uid 10001 (`Dockerfile.admin`), healthcheck отвечает;
- worker-образ содержит `ip`, `tc`, `nft`, `modprobe`.

### Откат

```bash
docker compose down
# при необходимости удалить локальные образы:
docker image rm awg-admin:latest awg-worker:latest awg-frontend:latest
```

Не используйте `docker compose down -v` на production: том `awg-data` содержит redb.

### Критерий «блокер закрыт»

- `docker compose build` завершается успешно на чистом кеше;
- контейнеры поднимаются и проходят healthcheck;
- worker видит admin по gRPC и применяет состояние;
- размеры и время сборки зафиксированы в отчёте о приёмке.

### Текущий статус

На проверочной машине присутствует только `awg-frontend:latest`; образы
`awg-admin`/`awg-worker` не собирались. Блокер открыт.

---

## Блокер 5. TLS/ACME Traefik

### Предусловия

- Реальный домен, A/AAAA-запись указывает на хост.
- Открыты `80/tcp` (ACME HTTP-01 и редирект) и `443/tcp`, `443/udp` (HTTP/3).
- Задан `TRAEFIK_ACME_EMAIL` в `.env`; том `traefik-letsencrypt` сохраняется.
- Для локальной проверки без домена: Docker и образ `traefik:v3.3`.

### Команды

```bash
# 1. Статический аудит конфигурации (без сети)
./scripts/verify-tls.sh --static

# 2. Локальная проверка Traefik с self-signed (без домена, только TLS-транспорт)
./scripts/verify-tls.sh --local --no-hsts-check --no-static

# 3. Реальный домен
DNS_NAME=panel.example.org
curl -fsS "https://dns.google/resolve?name=$DNS_NAME&type=A" | jq -r '.Answer[].data'
TRAEFIK_ACME_EMAIL=ops@example.org docker compose up -d traefik admin frontend
docker compose logs -f traefik        # ожидаются попытки ACME и выдача сертификата
./scripts/verify-tls.sh --url "https://$DNS_NAME"
```

Скрипт проверяет: редирект `http://` → `https://` (301/308), HTTP/2 по ALPN,
HSTS (`Strict-Transport-Security` с `max-age`), срок действия и SAN сертификата,
`/api/v1/health` (200 и `"status":"ok"`), HTTP/3 через `curl --http3-only`
(только если `curl -V` содержит `HTTP3`) и заголовок `Alt-Svc: h3`.

Ожидаемый результат на реальном домене:

- роутеры Traefik содержат `Host(\`<домен>\`)`, иначе ACME не выпустит сертификат
  (сейчас в compose таких правил нет — это провал `--static`);
- сертификат выпущен Let's Encrypt, `issuer` содержит `Let's Encrypt`;
- `acme.json` создан в томе `traefik-letsencrypt` (права 600);
- `http_version=2` для обычного HTTPS и `http_version=3` для `--http3-only`;
- `/api/v1/health` отвечает 200;
- HSTS присутствует (см. замечание ниже);
- автопродление обеспечивает Traefik, повторный запуск не ломает сертификат.

### Откат

```bash
docker compose stop traefik
# сертификаты остаются в томе traefik-letsencrypt; удаление тома сбросит ACME
```

### Критерий «блокер закрыт»

- `--static` без fail (кроме осознанно принятых warn); сейчас падает из-за
  отсутствия `Host(...)` — до закрытия блокера;
- `--local --no-hsts-check --no-static` без fail: редирект, h2, цепочка, health, h3;
- на реальном домене сертификат валиден и выдан Let's Encrypt, h2/h3 работают,
  health 200, HSTS с `max-age`.

### Замечания, найденные при проверке

- **Нет правила `Host(...)` у роутеров Traefik.** Роутеры построены на
  `PathPrefix`, поэтому Traefik не знает, на какой домен выпускать сертификат:
  ACME не сработает, клиенту достанется TRAEFIK DEFAULT CERT. Нужно добавить
  `Host(\`<домен>\`)` (или явно задать домены в ACME), после чего `--static`
  перестанет падать. `AWG_DOMAIN` при этом объявлен в `.env.example`/README, но
  не используется в compose.
- **HSTS не настроен.** Ни в `docker/traefik.yml`, ни в labels нет middleware
  `stsSeconds`/`Strict-Transport-Security`. Проверка HSTS падает, пока не добавлен
  headers-middleware (это изменение Docker-конфигурации, не входит в данные скрипты).
- `--local` поднимает Traefik с `--network host` на портах 8088/8443 и требует
  свободные порты. Backend `http://127.0.0.1:8080` опционален: без него health
  пропускается.
- HTTP/3 требует TLS; backend admin остаётся h2c/HTTP1.1, HTTP/3 терминирует Traefik.
- Во время проверки из `docker-compose.yml` исчезли labels `serversTransport h2c`
  для admin (параллельные правки Docker-конфигурации). Скрипт сообщает об этом
  предупреждением, на TLS это не влияет.
- `AWG_DOMAIN` из `.env.example` не используется в compose: роутеры построены на
  `PathPrefix`, а не на `Host(...)`. Для ACME это не критично, но переменная вводит
  в заблуждение. Также не используются `TRAEFIK_LOG_LEVEL`, `TRAEFIK_CERT_RESOLVER`,
  `TRAEFIK_ACME_STORAGE`, `TRAEFIK_HTTP_ENTRYPOINT`, `TRAEFIK_HTTPS_ENTRYPOINT`.

---

## Блокер 6. Фиксированный мастер-ключ

### Предусловия

- `.env` с непустыми `AWG_MASTER_KEY` (32 байта base64) и `AWG_JWT_SECRET`.
- Работающий admin и хотя бы одно устройство с профилем.

### Команды

```bash
# 1. Сгенерируйте и проверьте длину
KEY=$(openssl rand -base64 32)
printf '%s' "$KEY" | base64 -d | wc -c        # ожидается 32
# пропишите AWG_MASTER_KEY=$KEY и AWG_JWT_SECRET=$(openssl rand -base64 48) в .env

# 2. Перезапустите admin и убедитесь, что нет предупреждения об эфемерном ключе
docker compose up -d admin
docker compose logs admin | grep -i "ephemeral" && echo "БЛОКЕР: ключ не задан"

# 3. Получите профиль устройства, перезапустите admin, получите снова
TOKEN=$(curl -fsS -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"admin","password":"<пароль>"}' | jq -r .token)
DEVICE=<uuid>
IFACE=<uuid>
curl -fsS -H "authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/devices/$DEVICE/profiles/$IFACE" | jq -r .conf

docker compose restart admin
# повторите login и запрос профиля — приватный ключ и conf должны совпасть
```

### Ожидаемый результат

- в логах нет `AWG_MASTER_KEY is not set; generated an ephemeral key`;
- профиль устройства (`.conf`, `vpn://`) читается после рестарта без ошибок
  расшифровки;
- повторный запрос возвращает тот же приватный ключ.

### Откат

Верните прежний `AWG_MASTER_KEY` и перезапустите admin. **Не меняйте ключ на
production с данными**: приватные ключи интерфейсов и устройств в redb зашифрованы
ChaCha20-Poly1305, старый ключ нужен для их чтения. Потеря ключа = потеря секретов.

### Критерий «блокер закрыт»

- `AWG_MASTER_KEY` фиксирован в `.env` (не генерируется при старте);
- после рестарта admin профили устройств читаются;
- в логах отсутствует предупреждение об эфемерном ключе;
- ключ и `.env` не попадают в git (`.gitignore`).

---

## Блокер 7. HTTP/3 за Traefik

### Предусловия

- Traefik с `http3: {}` на entrypoint `websecure` (`docker/traefik.yml`).
- Опубликован `443/udp` (compose) и открыт на firewall.
- `curl`, собранный с HTTP/3 (`curl -V | grep HTTP3`), либо клиент с h3.

### Команды

```bash
curl -V | grep -o HTTP3
curl --http3-only -sS -o /dev/null -w '%{http_version}\n' https://panel.example.org/
curl -sSI https://panel.example.org/ | grep -i '^alt-svc'
./scripts/verify-tls.sh --url https://panel.example.org
```

### Ожидаемый результат

- `curl --http3-only` печатает `3`;
- `Alt-Svc` содержит `h3=":443"`;
- HTTP/2 по TCP продолжает работать (fallback);
- в логах Traefik нет ошибок QUIC.

Если `curl` собран без HTTP/3, `verify-tls.sh` выводит `[skip]` с версией curl и
не считает это провалом. Это ограничение клиента, а не конфигурации.

### Откат

Отдельного отката нет: HTTP/3 — дополнительный транспорт. При проблемах можно
убрать `http3: {}` и публикацию `443/udp`, оставив TCP/TLS.

### Критерий «блокер закрыт»

- на реальном домене `http_version=3` через `--http3-only`;
- `Alt-Svc` анонсирует h3;
- TCP/HTTP2 и health продолжают работать.

---

## Блокер 8. WebTransport — не реализовано

В коде есть только WebSocket:

- маршрут `GET /api/v1/ws/stats` (`backend/crates/admin/src/routes.rs`);
- параметры `token`, `scope`, `id` (`backend/crates/admin/src/ws.rs`);
- сервер — `axum::extract::ws::WebSocketUpgrade`, без h3/WT.

WebTransport в репозитории отсутствует: нет зависимостей `webtransport`,
`quinn`/`h3`, нет серверных сессий WT и клиентского fallback. Пункт 8 в
`docs/TODO.md` описывает состояние корректно.

Чтобы закрыть блокер, нужно:

1. Терминировать HTTP/3 в Traefik (уже есть) и решить, будет ли WT идти через
   прокси или напрямую в backend (для WT нужен h3-сервер, одного h2c недостаточно).
2. Реализовать WT-сессию на сервере (QUIC/h3 + WebTransport API) и аналог
   подписки на статистику.
3. Добавить клиентский fallback: WT → WebSocket при недоступности h3.
4. Проверить: `curl --http3-only` до `/api/v1/health` (транспорт), WT-соединение
   из браузера, fallback при закрытом UDP/443.

Критерий закрытия: WT-соединение устанавливается на реальном домене, статистика
приходит, при недоступности h3 клиент автоматически переключается на WebSocket.
Сейчас критерий не выполним: функциональность не реализована.

### Откат

Не требуется: WebTransport отсутствует, откатывать нечего. Если WT будет
добавлен, откат — фича-флаг и возврат клиента на WebSocket.

---

## Сводка: расхождения `docs/TODO.md` и кода

| Пункт TODO | Фактическое состояние |
|---|---|
| 1. Реальный kernel | `verify-kernel.sh` проверяет модуль, `ip link`, `SetDevice`-параметры, `REPLACE_PEERS`, счётчики и ICMP на реальном ядре. Осталось e2e через worker. Монотонность гарантирована для per-peer счётчиков; интерфейсные тоталы считаются из сырых байт и могут уменьшиться после reload |
| 2. tc ingress/egress | Структура HTB/IFB/u32 и лимиты проверяются; hairpin и полоса — только на реальном интерфейсе. Найден дублирующийся `tc filter add`; `group_down/up_kbps` не используются |
| 3. nftables forwarding | Таблица/цепь/правила и изоляция проверяются на veth; hairpin `iifname == oifname` — только на реальном AWG |
| 4. Docker build | Образы `awg-admin`/`awg-worker` не собирались; на машине есть только `awg-frontend` |
| 5. TLS/ACME | Локальный Traefik с self-signed проходит (redirect, h2, h3, health); ACME требует домен. Нет правила `Host(...)` (ACME не выпустит сертификат), HSTS не настроен; `AWG_DOMAIN` не используется в compose |
| 6. Секреты | Логика эфемерного ключа подтверждена (`config.rs`); `.env` на проверочной машине отсутствует, пункт не закрыт |
| 7. HTTP/3 backend | HTTP/3 работает на Traefik (проверено локально); backend остаётся h2c/HTTP1.1, это соответствует архитектуре |
| 8. WebTransport | Не реализовано: только WebSocket `/api/v1/ws/stats` |
| 9. Аудит | Вне зоны проверки; таблица есть, записи не создаются (по TODO) |
| 10. Rate limiting | Вне зоны проверки; на момент проверки в рабочем дереве появился `rate_limit.rs` (параллельные правки) |
| 11. Монотонность счётчиков | `CounterBook` нормализует только peer-счётчики (`rx_total`/`tx_total` пира). Верхнеуровневые `InterfaceReport.rx_total/tx_total` считаются из сырых `peer.rx_bytes` (`worker/src/application/mod.rs`), поэтому после пересоздания интерфейса агрегат по интерфейсу может уменьшиться. Проверять монотонность нужно по пирам/устройствам |
| 12. Очистка при удалении интерфейса | `ReconcileService.known` — множество в памяти процесса: интерфейс, удалённый из desired state, пока worker был остановлен, не будет вычищен после рестарта (teardown выполняется только для известных в этой сессии) |

Дополнительно:

- `docs/ARCHITECTURE.md` и `docs/SECURITY.md` содержат посторонние строки в конце
  файлов (`Write.`, `Now write WORKER.md.`) — следы генерации, стоит вычистить.
- `worker/src/infrastructure/netlink.rs: ensure_interface` игнорирует ошибку
  `ip link add` (`let _ = self.run(...)`) — при отсутствии модуля ошибка проявится
  позже и в другом месте. Для приёмки важно смотреть `docker compose logs worker`.
- `worker/src/infrastructure/nft.rs: ensure_chain` также игнорирует ошибки
  `nft add table/chain`; при отсутствии `nft` в образе ошибка будет неочевидной.
- `worker/src/application/mod.rs`: per-peer счётчики нормализуются `CounterBook`,
  но `InterfaceReport.rx_total/tx_total` считаются из сырых `peer.rx_bytes`/
  `tx_bytes` (без offset). После пересоздания интерфейса интерфейсные тоталы
  могут уменьшиться, хотя тоталы устройств монотонны. Проверять в UI нужно
  в первую очередь значения по устройствам.

## Результаты прогона на проверочной машине

Ниже — фактический результат, не заменяет приёмку на production.

- Окружение: Linux 7.3.4, `amneziawg` 3.1.20261113-02, `iproute2` 7.3.0,
  `nftables` 1.1.7, `curl` 8.23.0 (HTTP3), Docker 29.9.3, uid 1000,
  unprivileged user namespaces доступны.
- `scripts/verify-kernel.sh --apply --netns`: 0 провалов — модуль, `ip link
  add/del`, `SetDevice` (H1–H4/S1–S4/Jc/Jmin/Jmax/HPK/RandomTrailers),
  `REPLACE_PEERS`, счётчики, ICMP между двумя AWG-интерфейсами.
- `scripts/verify-dataplane.sh --apply`: 0 провалов, 1 предупреждение —
  дубликат `u32`-фильтра; HTB/IFB/u32, счётчики классов, изоляция
  подтверждены.
- `scripts/verify-tls.sh --static`: падает на отсутствии `Host(...)` в
  правилах роутеров (ACME не выпустит сертификат); предупреждения — HSTS,
  h2c, `AWG_DOMAIN`.
- `scripts/verify-tls.sh --local --no-hsts-check --no-static`: 0 провалов —
  редирект, h2, цепочка self-signed, `/api/v1/health`, HTTP/3 (`http_version=3`).
- Не проверялось здесь: e2e worker с реальными клиентами, ACME на домене,
  сборка `awg-admin`/`awg-worker`, WebTransport.

## Чек-лист приёмки

- [ ] `verify-kernel.sh --apply --netns` — 0 провалов
- [ ] worker с `AWG_DRY_RUN=false` применяет состояние, `awg show` содержит H1–H4/S1–S4/HPK/RandomTrailers
- [ ] реальный handshake и счётчики; после пересоздания интерфейса статистика не убывает
- [ ] `verify-dataplane.sh --apply` — 0 провалов
- [ ] iperf3 подтверждает лимиты устройства и пользователя, квота 1 kbit
- [ ] nftables: изоляция по умолчанию и разрешённые пары на реальном интерфейсе
- [ ] `docker compose build` + `docker compose ps` — образы healthy
- [ ] `verify-tls.sh --local --no-hsts-check --no-static` — 0 провалов
- [ ] реальный домен: Let's Encrypt, h2, h3, `/api/v1/health`, HSTS (если принято требование)
- [ ] фиксированный `AWG_MASTER_KEY`, профиль читается после рестарта admin
- [ ] HTTP/3: `curl --http3-only` → `http_version=3`, `Alt-Svc: h3`
- [ ] WebTransport: зафиксировано как не реализовано либо реализовано и проверено
