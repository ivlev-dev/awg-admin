#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
readonly SCRIPT_PATH

IFACE="awgtest0"
APPLY=0
TRAFFIC=1
FAILED=0
WARNED=0
SKIPPED=0
WORKDIR=""
CHILD_PIDS=()
NS_PID=""

usage() {
  cat <<'EOF'
Проверка tc (HTB + IFB + u32) и nftables forwarding (production-блокеры №2 и №3).

Использование:
  scripts/verify-dataplane.sh              # dry-run: печать плана и проверка окружения
  scripts/verify-dataplane.sh --apply      # реальная проверка в одноразовом netns

Опции:
  --apply          выполнить проверку (по умолчанию dry-run)
  --ifname NAME    базовое имя проверяемого интерфейса (по умолчанию awgtest0)
  --no-traffic     только структура tc/nft, без ping между netns
  -h, --help       эта справка

--apply всегда работает в новом network namespace (root: unshare -n,
без root: unshare -rn). Живые интерфейсы, tc-правила и nftables хоста не
затрагиваются. Если unprivileged user namespaces недоступны, нужен root.

Что проверяется:
  egress:  htb root 1:1, классы пользователей 1:100+i, устройств 1:1000+...,
           фильтры u32 match ip dst; лимит 1 kbit (блокировка по квоте);
  ingress: qdisc ingress, mirred redirect в ifb-<ifname>, HTB и u32 match ip src;
  nftables: таблица inet awg_admin, цепь fwd_<ifname>, разрешающая пара + drop;
  трафик:  ping через два netns, счётчики классов растут, изоляция блокирует;
  повторный reconcile: worker пересоздаёт root/ingress qdisc через del+add
           (htb не поддерживает replace/change), классы и фильтры
           пересоздаются без ошибок и без дубликатов.

Ограничение: на veth нельзя воспроизвести hairpin iifname == oifname одного
AWG-интерфейса. Проверяется эквивалентная пара iifname/oifname на двух veth;
реальный hairpin проверяется на живом AWG-интерфейсе (см.
docs/PRODUCTION-VERIFICATION.md).
EOF
}

section() { printf '\n== %s ==\n' "$*"; }
ok() { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; WARNED=$((WARNED + 1)); }
fail() { printf '  [fail] %s\n' "$*"; FAILED=$((FAILED + 1)); }
skip() { printf '  [skip] %s\n' "$*"; SKIPPED=$((SKIPPED + 1)); }
note() { printf '  [info] %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 2; }

have() { command -v "$1" >/dev/null 2>&1; }

print_cmd() {
  local out="" arg
  for arg in "$@"; do
    out+="$(printf '%q' "$arg") "
  done
  printf '  + %s\n' "${out% }"
}

cleanup() {
  local pid
  for pid in "${CHILD_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  if have nft; then
    nft delete table inet awg_admin 2>/dev/null || true
  fi
  if have ip; then
    ip link del dev "dp-r1" 2>/dev/null || true
    ip link del dev "dp-r2" 2>/dev/null || true
    ip link del dev "$IFB" 2>/dev/null || true
  fi
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --apply) APPLY=1 ;;
      --no-traffic) TRAFFIC=0 ;;
      --ifname)
        [ $# -ge 2 ] || die "--ifname требует значение"
        IFACE="$2"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *) die "неизвестный аргумент: $1 (см. --help)" ;;
    esac
    shift
  done

  if [ ${#IFACE} -gt 15 ]; then
    die "имя интерфейса длиннее 15 символов: $IFACE"
  fi
  case "$IFACE" in
    *[!a-zA-Z0-9_-]*) die "недопустимое имя интерфейса: $IFACE" ;;
  esac
  IFB="ifb-${IFACE:0:11}"
  CHAIN="fwd_${IFACE}"
}

start_netns() {
  NS_PID=""
  local own_ns
  own_ns=$(readlink /proc/self/ns/net)
  unshare --net -- sleep 180 &
  NS_PID=$!
  CHILD_PIDS+=("$NS_PID")
  local tries=0
  while [ "$tries" -lt 100 ]; do
    if [ -e "/proc/$NS_PID/ns/net" ] && [ "$(readlink "/proc/$NS_PID/ns/net")" != "$own_ns" ]; then
      return 0
    fi
    tries=$((tries + 1))
    sleep 0.05
  done
  return 1
}

expect_contains() {
  local text="$1" needle="$2" what="$3"
  if printf '%s\n' "$text" | grep -qF -- "$needle"; then
    ok "$what"
  else
    fail "$what (не найдено: $needle)"
  fi
}

expect_count() {
  local text="$1" needle="$2" expected="$3" what="$4"
  local actual
  actual=$(printf '%s\n' "$text" | grep -cF -- "$needle" || true)
  actual=${actual:-0}
  if [ "$actual" -eq "$expected" ]; then
    ok "$what"
  else
    fail "$what (ожидалось $expected, получено $actual)"
  fi
}

class_packets() {
  local dev="$1" classid="$2"
  tc -s class show dev "$dev" classid "$classid" 2>/dev/null \
    | awk '/Sent/ {for (i = 1; i <= NF; i++) if ($i == "pkt") {print $(i - 1); exit}}'
}

reset_root_qdisc() {
  local dev="$1"
  print_cmd tc qdisc del dev "$dev" root
  tc qdisc del dev "$dev" root 2>/dev/null || true
  print_cmd tc qdisc add dev "$dev" root handle 1: htb default 1
  tc qdisc add dev "$dev" root handle 1: htb default 1
}

reset_ingress_qdisc() {
  local dev="$1"
  print_cmd tc qdisc del dev "$dev" ingress
  tc qdisc del dev "$dev" ingress 2>/dev/null || true
  print_cmd tc qdisc add dev "$dev" handle ffff: ingress
  tc qdisc add dev "$dev" handle ffff: ingress
}

apply_egress() {
  section "Egress: HTB root/классы и фильтры u32"

  reset_root_qdisc dp-r2

  print_cmd tc class replace dev dp-r2 parent 1: classid 1:1 htb rate 10mbit ceil 10mbit
  tc class replace dev dp-r2 parent 1: classid 1:1 htb rate 10mbit ceil 10mbit

  print_cmd tc class replace dev dp-r2 parent 1:1 classid 1:100 htb rate 5mbit ceil 5mbit
  tc class replace dev dp-r2 parent 1:1 classid 1:100 htb rate 5mbit ceil 5mbit
  print_cmd tc class replace dev dp-r2 parent 1:1 classid 1:101 htb rate 5mbit ceil 5mbit
  tc class replace dev dp-r2 parent 1:1 classid 1:101 htb rate 5mbit ceil 5mbit

  print_cmd tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  print_cmd tc class replace dev dp-r2 parent 1:101 classid 1:1101 htb rate 1000kbit ceil 1000kbit
  tc class replace dev dp-r2 parent 1:101 classid 1:1101 htb rate 1000kbit ceil 1000kbit

  print_cmd tc filter add dev dp-r2 protocol ip parent 1: prio 1 u32 match ip dst 10.30.2.2/32 flowid 1:1000
  tc filter add dev dp-r2 protocol ip parent 1: prio 1 u32 match ip dst 10.30.2.2/32 flowid 1:1000
  print_cmd tc filter add dev dp-r2 protocol ip parent 1: prio 1 u32 match ip dst 10.30.2.3/32 flowid 1:1101
  tc filter add dev dp-r2 protocol ip parent 1: prio 1 u32 match ip dst 10.30.2.3/32 flowid 1:1101

  local qdisc classes filters
  qdisc=$(tc qdisc show dev dp-r2)
  expect_contains "$qdisc" "qdisc htb 1:" "qdisc htb 1: на dp-r2"

  classes=$(tc class show dev dp-r2)
  expect_contains "$classes" "class htb 1:1 root" "корневой класс 1:1"
  expect_contains "$classes" "class htb 1:100 parent 1:1" "класс пользователя 1:100"
  expect_contains "$classes" "class htb 1:101 parent 1:1" "класс пользователя 1:101"
  expect_contains "$classes" "class htb 1:1000 parent 1:100" "класс устройства 1:1000"
  expect_contains "$classes" "class htb 1:1101 parent 1:101" "класс устройства 1:1101"

  filters=$(tc filter show dev dp-r2 parent 1:)
  expect_contains "$filters" "match 0a1e0202/ffffffff at 16" "фильтр u32 dst 10.30.2.2 (hex 0a1e0202)"
  expect_contains "$filters" "flowid 1:1000" "flowid 1:1000 в egress"
  expect_contains "$filters" "match 0a1e0203/ffffffff at 16" "фильтр u32 dst 10.30.2.3 (hex 0a1e0203)"

  print_cmd tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1kbit ceil 1kbit
  tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1kbit ceil 1kbit
  local quota
  quota=$(tc class show dev dp-r2 classid 1:1000)
  if printf '%s\n' "$quota" | grep -qi "rate 1Kbit"; then
    ok "квота 1 kbit принимается ядром (фактическая блокировка)"
  else
    fail "ядро не применило rate 1kbit"
  fi

  tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
}

apply_ingress() {
  section "Ingress: ingress qdisc, IFB, HTB и u32"

  if ! ip link show "$IFB" >/dev/null 2>&1; then
    print_cmd ip link add "$IFB" type ifb
    ip link add "$IFB" type ifb
  fi
  print_cmd ip link set dev "$IFB" up
  ip link set dev "$IFB" up

  reset_ingress_qdisc dp-r1
  print_cmd tc filter add dev dp-r1 parent ffff: protocol ip u32 match u32 0 0 action mirred egress redirect dev "$IFB"
  tc filter add dev dp-r1 parent ffff: protocol ip u32 match u32 0 0 action mirred egress redirect dev "$IFB"

  reset_root_qdisc "$IFB"
  print_cmd tc class replace dev "$IFB" parent 1: classid 1:1 htb rate 10mbit ceil 10mbit
  tc class replace dev "$IFB" parent 1: classid 1:1 htb rate 10mbit ceil 10mbit
  print_cmd tc class replace dev "$IFB" parent 1:1 classid 1:100 htb rate 5mbit ceil 5mbit
  tc class replace dev "$IFB" parent 1:1 classid 1:100 htb rate 5mbit ceil 5mbit
  print_cmd tc class replace dev "$IFB" parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  tc class replace dev "$IFB" parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  print_cmd tc filter add dev "$IFB" protocol ip parent 1: prio 1 u32 match ip src 10.30.1.2/32 flowid 1:1000
  tc filter add dev "$IFB" protocol ip parent 1: prio 1 u32 match ip src 10.30.1.2/32 flowid 1:1000

  local ingress ifb_qdisc ifb_filters
  ingress=$(tc qdisc show dev dp-r1)
  expect_contains "$ingress" "ingress" "qdisc ingress на dp-r1"

  local ingress_filter
  ingress_filter=$(tc filter show dev dp-r1 parent ffff:)
  expect_contains "$ingress_filter" "mirred" "фильтр mirred на dp-r1"
  expect_contains "$ingress_filter" "$IFB" "redirect в $IFB"

  ifb_qdisc=$(tc qdisc show dev "$IFB")
  expect_contains "$ifb_qdisc" "qdisc htb 1:" "qdisc htb на $IFB"
  ifb_filters=$(tc filter show dev "$IFB" parent 1:)
  expect_contains "$ifb_filters" "match 0a1e0102/ffffffff at 12" "фильтр u32 src 10.30.1.2 (hex 0a1e0102)"
  expect_contains "$ifb_filters" "flowid 1:1000" "flowid 1:1000 в ingress"
}

create_router_links() {
  ip link add dp-r1 type veth peer name dp-c1
  ip link add dp-r2 type veth peer name dp-c2
  ip addr add 10.30.1.1/24 dev dp-r1
  ip addr add 10.30.2.1/24 dev dp-r2
  ip link set dp-r1 up
  ip link set dp-r2 up
  sysctl -qw net.ipv4.ip_forward=1
}

attach_clients() {
  if ! start_netns; then
    skip "не удалось создать netns 1"
    return 1
  fi
  local ns1="$NS_PID"

  if ! start_netns; then
    skip "не удалось создать netns 2"
    return 1
  fi
  local ns2="$NS_PID"

  ip link set dp-c1 netns "$ns1"
  ip link set dp-c2 netns "$ns2"

  nsenter -t "$ns1" -n bash -c '
set -e
ip link set dp-c1 up
ip addr add 10.30.1.2/24 dev dp-c1
ip route add default via 10.30.1.1
sysctl -qw net.ipv4.conf.all.rp_filter=0
' || { fail "настройка netns 1"; return 1; }

  nsenter -t "$ns2" -n bash -c '
set -e
ip link set dp-c2 up
ip addr add 10.30.2.2/24 dev dp-c2
ip route add default via 10.30.2.1
sysctl -qw net.ipv4.conf.all.rp_filter=0
' || { fail "настройка netns 2"; return 1; }

  NS1="$ns1"
  return 0
}

check_reapply_idempotency() {
  section "Повторный reconcile: del+add qdisc, классы и фильтры"

  if tc qdisc replace dev dp-r2 root handle 1: htb default 1 2>"$WORKDIR/replace.err"; then
    note "ядро принимает tc qdisc replace для htb root"
  else
    note "ядро не принимает replace/change для htb root: $(cat "$WORKDIR/replace.err"): worker использует del+add"
  fi

  if ( reset_root_qdisc dp-r2 ) 2>"$WORKDIR/egress-reapply.err"; then
    ok "повторное пересоздание root htb на dp-r2"
  else
    fail "повторное пересоздание root htb на dp-r2: $(cat "$WORKDIR/egress-reapply.err")"
  fi
  tc class replace dev dp-r2 parent 1: classid 1:1 htb rate 10mbit ceil 10mbit
  tc class replace dev dp-r2 parent 1:1 classid 1:100 htb rate 5mbit ceil 5mbit
  tc class replace dev dp-r2 parent 1:1 classid 1:101 htb rate 5mbit ceil 5mbit
  tc class replace dev dp-r2 parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  tc class replace dev dp-r2 parent 1:101 classid 1:1101 htb rate 1000kbit ceil 1000kbit
  tc filter add dev dp-r2 protocol ip parent 1: prio 1 u32 match ip dst 10.30.2.2/32 flowid 1:1000
  tc filter add dev dp-r2 protocol ip parent 1: prio 1 u32 match ip dst 10.30.2.3/32 flowid 1:1101

  local qdisc filters
  qdisc=$(tc qdisc show dev dp-r2)
  expect_contains "$qdisc" "qdisc htb 1:" "root htb после повторного reconcile"
  filters=$(tc filter show dev dp-r2 parent 1:)
  expect_count "$filters" "flowid 1:1000" 1 "фильтр 1:1000 не продублирован"
  expect_count "$filters" "flowid 1:1101" 1 "фильтр 1:1101 не продублирован"

  if ( reset_ingress_qdisc dp-r1 ) 2>"$WORKDIR/ingress-reapply.err"; then
    ok "повторное пересоздание ingress qdisc на dp-r1"
  else
    fail "повторное пересоздание ingress qdisc на dp-r1: $(cat "$WORKDIR/ingress-reapply.err")"
  fi
  tc filter add dev dp-r1 parent ffff: protocol ip u32 match u32 0 0 action mirred egress redirect dev "$IFB"

  local ingress_filter
  ingress_filter=$(tc filter show dev dp-r1 parent ffff:)
  expect_count "$ingress_filter" "mirred" 1 "фильтр mirred не продублирован"

  if ( reset_root_qdisc "$IFB" ) 2>"$WORKDIR/ifb-reapply.err"; then
    ok "повторное пересоздание root htb на $IFB"
  else
    fail "повторное пересоздание root htb на $IFB: $(cat "$WORKDIR/ifb-reapply.err")"
  fi
  tc class replace dev "$IFB" parent 1: classid 1:1 htb rate 10mbit ceil 10mbit
  tc class replace dev "$IFB" parent 1:1 classid 1:100 htb rate 5mbit ceil 5mbit
  tc class replace dev "$IFB" parent 1:100 classid 1:1000 htb rate 1000kbit ceil 1000kbit
  tc filter add dev "$IFB" protocol ip parent 1: prio 1 u32 match ip src 10.30.1.2/32 flowid 1:1000

  local ifb_filters
  ifb_filters=$(tc filter show dev "$IFB" parent 1:)
  expect_count "$ifb_filters" "flowid 1:1000" 1 "фильтр IFB 1:1000 не продублирован"
}

apply_nft() {
  section "nftables: inet awg_admin, цепь $CHAIN"

  print_cmd nft add table inet awg_admin
  nft add table inet awg_admin
  print_cmd nft add chain inet awg_admin "$CHAIN" "{ type filter hook forward priority 10; }"
  nft add chain inet awg_admin "$CHAIN" "{ type filter hook forward priority 10; }"

  print_cmd nft add rule inet awg_admin "$CHAIN" iifname dp-r1 oifname dp-r2 ip saddr 10.30.1.2 ip daddr 10.30.2.2 accept
  nft add rule inet awg_admin "$CHAIN" iifname "dp-r1" oifname "dp-r2" ip saddr 10.30.1.2 ip daddr 10.30.2.2 accept
  print_cmd nft add rule inet awg_admin "$CHAIN" iifname dp-r1 oifname dp-r2 drop
  nft add rule inet awg_admin "$CHAIN" iifname "dp-r1" oifname "dp-r2" drop

  local chain
  chain=$(nft list chain inet awg_admin "$CHAIN")
  expect_contains "$chain" "hook forward priority filter + 10" "hook forward priority 10"
  expect_contains "$chain" 'iifname "dp-r1" oifname "dp-r2"' "iifname/oifname в правиле"
  expect_contains "$chain" "ip saddr 10.30.1.2 ip daddr 10.30.2.2 accept" "разрешённая пара"
  expect_contains "$chain" "drop" "drop для остального"
}

traffic_checks() {
  section "Трафик: разрешённая пара, счётчики классов, изоляция"

  if [ "$TRAFFIC" -eq 0 ]; then
    skip "проверка трафика отключена (--no-traffic)"
    return
  fi

  local tool
  for tool in ping nsenter unshare; do
    if ! have "$tool"; then
      skip "нет $tool: проверка трафика пропущена"
      return
    fi
  done

  if ! attach_clients; then
    return
  fi

  local attempt=0 rc=1
  while [ "$attempt" -lt 10 ]; do
    if nsenter -t "$NS1" -n ping -c 1 -W 1 10.30.2.2 >/dev/null 2>&1; then
      rc=0
      break
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  if [ "$rc" -eq 0 ]; then
    ok "разрешённая пара пропускает ICMP"
  else
    fail "разрешённая пара не пропускает ICMP"
    nft list chain inet awg_admin "$CHAIN" 2>/dev/null | sed 's/^/    /' || true
  fi

  nsenter -t "$NS1" -n ping -c 4 -W 2 -i 0.2 10.30.2.2 >/dev/null 2>&1 || true

  local down_pkt ifb_pkt
  down_pkt=$(class_packets dp-r2 1:1000)
  ifb_pkt=$(class_packets "$IFB" 1:1000)
  if [ -n "$down_pkt" ] && [ "$down_pkt" -gt 0 ] 2>/dev/null; then
    ok "egress-класс 1:1000 насчитал пакеты ($down_pkt)"
  else
    fail "egress-класс 1:1000 не насчитал пакеты"
  fi
  if [ -n "$ifb_pkt" ] && [ "$ifb_pkt" -gt 0 ] 2>/dev/null; then
    ok "ingress-класс на IFB насчитал пакеты ($ifb_pkt)"
  else
    fail "ingress-класс на IFB не насчитал пакеты"
  fi

  print_cmd nft flush chain inet awg_admin "$CHAIN"
  nft flush chain inet awg_admin "$CHAIN"
  print_cmd nft add rule inet awg_admin "$CHAIN" iifname dp-r1 oifname dp-r2 drop
  nft add rule inet awg_admin "$CHAIN" iifname "dp-r1" oifname "dp-r2" drop

  if nsenter -t "$NS1" -n ping -c 2 -W 1 10.30.2.2 >/dev/null 2>&1; then
    fail "изоляция не работает: ICMP проходит при одном drop"
  else
    ok "изоляция работает: без разрешающей пары ICMP блокируется"
  fi
}

run_scenario() {
  trap cleanup EXIT
  WORKDIR=$(mktemp -d)

  create_router_links
  apply_egress
  apply_ingress
  check_reapply_idempotency
  apply_nft
  traffic_checks
}

dry_run() {
  section "План (dry-run)"
  note "Реальное выполнение: --apply. Всё создаётся в одноразовом netns."
  note "egress на dp-r2: htb 1:1 (10mbit), пользователи 1:100/1:101 (5mbit),"
  note "  устройства 1:1000 (parent 1:100) и 1:1101 (parent 1:101), u32 dst 10.30.2.2/32 -> 1:1000,"
  note "  u32 dst 10.30.2.3/32 -> 1:1101, затем rate 1kbit (квота)."
  note "ingress на dp-r1: ingress qdisc, mirred -> $IFB, htb и u32 src 10.30.1.2/32 -> 1:1000."
  note "повторный reconcile: root/ingress qdisc удаляются и создаются заново (htb не поддерживает replace),"
  note "  классы и фильтры пересоздаются без дубликатов."
  note "nftables: table inet awg_admin, chain $CHAIN, accept-пара и drop."
  note "трафик: ping между двумя netns, счётчики классов, изоляция."

  section "Готовность окружения"
  local tool
  for tool in ip tc nft unshare nsenter ping; do
    if have "$tool"; then
      ok "$tool: $(command -v "$tool")"
    else
      warn "$tool не найден"
    fi
  done

  if [ "$(id -u)" -eq 0 ]; then
    ok "запуск от root"
  elif unshare -rn true 2>/dev/null; then
    ok "unprivileged user namespaces доступны: root не нужен"
  else
    warn "нужен root: unprivileged user namespaces недоступны"
  fi

  if have nft && [ "$(id -u)" -eq 0 ]; then
    if nft list table inet awg_admin >/dev/null 2>&1; then
      warn "на хосте уже есть inet awg_admin (проверка его не затрагивает: своя netns)"
    else
      ok "конфликтующих правил на хосте нет"
    fi
  else
    note "состояние nftables хоста не читается без root (это не влияет на --apply)"
  fi
}

main() {
  parse_args "$@"

  if [ "$APPLY" -eq 0 ]; then
    dry_run
  else
    if [ -z "${AWG_VERIFY_DATAPLANE_NS:-}" ]; then
      local args=(--apply --ifname "$IFACE")
      if [ "$TRAFFIC" -eq 0 ]; then
        args+=(--no-traffic)
      fi
      if ! have unshare; then
        die "нужен unshare (util-linux)"
      fi
      local rc=0
      if [ "$(id -u)" -eq 0 ]; then
        unshare --net -- env AWG_VERIFY_DATAPLANE_NS=1 bash "$SCRIPT_PATH" "${args[@]}" || rc=$?
      elif unshare -rn true 2>/dev/null; then
        unshare -rn -- env AWG_VERIFY_DATAPLANE_NS=1 bash "$SCRIPT_PATH" "${args[@]}" || rc=$?
      else
        die "нужен root или доступные unprivileged user namespaces (unshare -rn)"
      fi
      exit "$rc"
    fi
    run_scenario
  fi

  section "Итог"
  printf '  провалено: %s, предупреждений: %s, пропущено: %s\n' "$FAILED" "$WARNED" "$SKIPPED"
  if [ "$FAILED" -gt 0 ]; then
    exit 1
  fi
  ok "проверка завершена без ошибок"
}

main "$@"
