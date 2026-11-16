#!/usr/bin/env bash
set -euo pipefail

readonly MODULE="amneziawg"
SCRIPT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
readonly SCRIPT_PATH

IFACE="awgverify0"
APPLY=0
USE_NETNS=0
TRAFFIC=1
INSPECT=""
FAILED=0
WARNED=0
SKIPPED=0
WORKDIR=""
CHILD_PIDS=()

usage() {
  cat <<'EOF'
Проверка AmneziaWG на реальном ядре (production-блокер №1).

Использование:
  scripts/verify-kernel.sh                     # dry-run: только чтение, команды печатаются
  scripts/verify-kernel.sh --apply             # реальная проверка, нужен root
  scripts/verify-kernel.sh --apply --netns     # проверка в приватном user+net namespace, root не нужен
  scripts/verify-kernel.sh --inspect awg0      # только чтение параметров живого интерфейса

Опции:
  --apply             выполнить проверку (по умолчанию dry-run)
  --netns             выполнять всё в одноразовом user+net namespace (безопасно, без root)
  --ifname NAME       имя временного интерфейса (по умолчанию awgverify0), будет удалён
  --inspect NAME      прочитать живой интерфейс и выйти
  --no-traffic        не проверять сквозной трафик и счётчики
  -h, --help          эта справка

Что проверяется при --apply:
  1. модуль amneziawg: modinfo, загрузка (modprobe/lsmod), версия 3.1+;
  2. ip link add <temp> type amneziawg, MTU, адрес, ip link set up, ip link del;
  3. SetDevice через `awg setconf`: H1-H4 диапазоны, S1-S4, Jc/Jmin/Jmax,
     HeaderProtectionKey, RandomTrailers, пиры;
  4. REPLACE_PEERS: повторный setconf с меньшим числом пиров удаляет лишние;
  5. чтение счётчиков и сквозной трафик между двумя временными AWG-интерфейсами
     в изолированных netns (нужны awg, ping, nsenter).

Ничего из существующих интерфейсов, правил tc/nft и sysctl хоста не меняется.
EOF
}

section() { printf '\n== %s ==\n' "$*"; }
ok() { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; WARNED=$((WARNED + 1)); }
fail() { printf '  [fail] %s\n' "$*"; FAILED=$((FAILED + 1)); }
skip() { printf '  [skip] %s\n' "$*"; SKIPPED=$((SKIPPED + 1)); }
note() { printf '  [info] %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 2; }

print_cmd() {
  local out=""
  local arg
  for arg in "$@"; do
    out+="$(printf '%q' "$arg") "
  done
  printf '  + %s\n' "${out% }"
}

have() { command -v "$1" >/dev/null 2>&1; }

cleanup() {
  local pid
  for pid in "${CHILD_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --apply) APPLY=1 ;;
      --netns) USE_NETNS=1 ;;
      --no-traffic) TRAFFIC=0 ;;
      --ifname)
        [ $# -ge 2 ] || die "--ifname требует значение"
        IFACE="$2"
        shift
        ;;
      --inspect)
        [ $# -ge 2 ] || die "--inspect требует имя интерфейса"
        INSPECT="$2"
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
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    cat >&2 <<EOF
Ошибка: --apply требует root (modprobe и реальный netlink).
Если root недоступен, используйте:
  scripts/verify-kernel.sh --apply --netns
Это выполнит все проверки в одноразовом user+net namespace без влияния на хост.
EOF
    exit 2
  fi
}

check_module() {
  section "Модуль ядра"

  if have modinfo && modinfo "$MODULE" >/dev/null 2>&1; then
    local path version description
    path=$(modinfo -F filename "$MODULE" 2>/dev/null || true)
    version=$(modinfo -F version "$MODULE" 2>/dev/null || true)
    description=$(modinfo -F description "$MODULE" 2>/dev/null || true)
    ok "modinfo: ${path:-?} (${description:-no description})"
    note "версия модуля: ${version:-unknown}"

    if [ -n "$version" ]; then
      local major minor
      major=${version%%.*}
      minor=${version#*.}
      minor=${minor%%.*}
      if [ "$major" -gt 3 ] 2>/dev/null || { [ "$major" -eq 3 ] 2>/dev/null && [ "$minor" -ge 1 ] 2>/dev/null; }; then
        ok "версия >= 3.1 (H1-H4Range, RandomTrailers, HeaderProtectionKey)"
      else
        fail "нужна версия 3.1+, найдена $version"
      fi
    fi
  else
    fail "модуль amneziawg не найден (modinfo). Установите DKMS-модуль amneziawg"
  fi

  if grep -qw "$MODULE" /proc/modules 2>/dev/null; then
    ok "модуль загружен (/proc/modules)"
  else
    note "модуль не загружен"
    if [ "$APPLY" -eq 1 ] && [ -z "${AWG_VERIFY_KERNEL_NS:-}" ]; then
      if [ "$(id -u)" -eq 0 ]; then
        if modprobe "$MODULE" 2>&1; then
          ok "modprobe $MODULE"
        else
          fail "modprobe $MODULE завершился ошибкой"
        fi
      else
        skip "modprobe требует root"
      fi
    else
      print_cmd modprobe "$MODULE"
    fi
    if grep -qw "$MODULE" /proc/modules 2>/dev/null; then
      ok "модуль загружен после modprobe"
    fi
  fi

  if [ -d /sys/module/"$MODULE" ]; then
    ok "sysfs: /sys/module/$MODULE"
  fi
}

inspect_interface() {
  local name="$1"
  section "Интерфейс $name (только чтение)"

  if ! ip link show dev "$name" >/dev/null 2>&1; then
    fail "интерфейс $name отсутствует"
    return
  fi
  ok "интерфейс существует"

  local details
  details=$(ip -d link show dev "$name")
  if printf '%s\n' "$details" | grep -qw "$MODULE"; then
    ok "тип link: $MODULE"
  else
    fail "тип link не $MODULE"
  fi

  local cidr
  while read -r cidr; do
    note "адрес: $cidr"
  done < <(ip -o addr show dev "$name" | awk '{print $4}')
  note "link: $(printf '%s\n' "$details" | head -n1)"

  if have awg; then
    note "awg show (первые 40 строк):"
    awg show "$name" 2>/dev/null | head -n 40 | sed 's/^/    /'
    local peers
    peers=$(awg show "$name" peers 2>/dev/null | wc -l)
    if [ "$peers" -gt 0 ]; then
      ok "пиров в ядре: $peers"
    else
      fail "в ядре нет пиров"
    fi
    if awg show "$name" dump 2>/dev/null | tail -n +2 | awk '{rx += $6; tx += $7} END {exit !(rx + tx > 0)}'; then
      ok "счётчики peer не нулевые"
    else
      warn "счётчики peer нулевые (нет трафика или handshake)"
    fi
  else
    skip "нет утилиты awg: параметры обфускации и счётчики не прочитать"
  fi
}

write_conf() {
  local file="$1" iface_key="$2" port="$3" hpk="$4" peer1="$5" peer2="${6:-}"
  {
    printf '[Interface]\n'
    printf 'PrivateKey = %s\n' "$iface_key"
    printf 'ListenPort = %s\n' "$port"
    printf 'Jc = 3\nJmin = 10\nJmax = 50\n'
    printf 'S1 = 15\nS2 = 16\nS3 = 17\nS4 = 18\n'
    printf 'H1 = 100100-100200\n'
    printf 'H2 = 1000100-1000200\n'
    printf 'H3 = 2000100-2000200\n'
    printf 'H4 = 3000100-3000200\n'
    printf 'HeaderProtectionKey = %s\n' "$hpk"
    printf 'RandomTrailers = on\n'
    printf '\n[Peer]\nPublicKey = %s\nAllowedIPs = 10.255.0.2/32\nPersistentKeepalive = 25\n' "$peer1"
    if [ -n "$peer2" ]; then
      printf '\n[Peer]\nPublicKey = %s\nAllowedIPs = 10.255.0.3/32\nPersistentKeepalive = 25\n' "$peer2"
    fi
  } > "$file"
}

require_awk() {
  local line="$1" needle="$2" what="$3"
  if printf '%s\n' "$line" | grep -qF "$needle"; then
    ok "$what: $needle"
  else
    fail "$what: не найдено «$needle»"
  fi
}

check_link_and_obf() {
  section "Интерфейс, SetDevice и REPLACE_PEERS"

  if ip link show dev "$IFACE" >/dev/null 2>&1; then
    die "интерфейс $IFACE уже существует; укажите другое имя через --ifname"
  fi
  ok "имя $IFACE свободно"

  print_cmd ip link add dev "$IFACE" type "$MODULE"
  if ! ip link add dev "$IFACE" type "$MODULE" 2>"$WORKDIR/ip.err"; then
    fail "ip link add type $MODULE: $(cat "$WORKDIR/ip.err")"
    return
  fi
  ok "ip link add type $MODULE"

  print_cmd ip link set dev "$IFACE" mtu 1420
  ip link set dev "$IFACE" mtu 1420
  print_cmd ip addr replace 10.255.255.1/32 dev "$IFACE"
  ip addr replace 10.255.255.1/32 dev "$IFACE"
  print_cmd ip link set dev "$IFACE" up
  ip link set dev "$IFACE" up

  if ! ip -d link show dev "$IFACE" | grep -qw "$MODULE"; then
    fail "ip -d link show не показывает тип $MODULE"
    return
  fi
  ok "ip -d link show: тип $MODULE"

  local mtu
  mtu=$(ip -o link show dev "$IFACE" | awk '{for (i = 1; i <= NF; i++) if ($i == "mtu") print $(i + 1)}')
  if [ "$mtu" = "1420" ]; then
    ok "MTU 1420 применён"
  else
    fail "MTU: ожидался 1420, получено ${mtu:-?}"
  fi

  if ! have awg; then
    skip "нет утилиты awg: SetDevice/параметры/пиры не проверены"
    return
  fi

  local key peer1_key peer1_pub peer2_key peer2_pub hpk conf conf_one
  key=$(awg genkey)
  peer1_key=$(awg genkey)
  peer1_pub=$(printf '%s' "$peer1_key" | awg pubkey)
  peer2_key=$(awg genkey)
  peer2_pub=$(printf '%s' "$peer2_key" | awg pubkey)
  hpk=$(awg genkey)
  conf="$WORKDIR/awg-full.conf"
  conf_one="$WORKDIR/awg-one-peer.conf"

  write_conf "$conf" "$key" 51820 "$hpk" "$peer1_pub" "$peer2_pub"
  print_cmd awg setconf "$IFACE" "$conf"
  if awg setconf "$IFACE" "$conf"; then
    ok "awg setconf (2 пира, полный набор AWG-параметров)"
  else
    fail "awg setconf завершился ошибкой"
    return
  fi

  local shown
  shown=$(awg showconf "$IFACE")
  require_awk "$shown" "H1 = 100100-100200" "H1 диапазон"
  require_awk "$shown" "H2 = 1000100-1000200" "H2 диапазон"
  require_awk "$shown" "H3 = 2000100-2000200" "H3 диапазон"
  require_awk "$shown" "H4 = 3000100-3000200" "H4 диапазон"
  require_awk "$shown" "S1 = 15" "S1"
  require_awk "$shown" "S2 = 16" "S2"
  require_awk "$shown" "S3 = 17" "S3"
  require_awk "$shown" "S4 = 18" "S4"
  require_awk "$shown" "Jc = 3" "Jc"
  require_awk "$shown" "Jmin = 10" "Jmin"
  require_awk "$shown" "Jmax = 50" "Jmax"
  require_awk "$shown" "HeaderProtectionKey = $hpk" "HeaderProtectionKey"
  require_awk "$shown" "RandomTrailers = on" "RandomTrailers"

  local peers
  peers=$(awg show "$IFACE" peers | wc -l | tr -d ' ')
  if [ "$peers" = "2" ]; then
    ok "в ядре 2 пира"
  else
    fail "в ядре $peers пиров, ожидалось 2"
  fi

  if awg show "$IFACE" dump | tail -n +2 | awk 'NF >= 8 {ok = 1} END {exit !ok}'; then
    ok "счётчики пира читаются из ядра (awg show dump: rx/tx)"
  else
    fail "счётчики пира недоступны"
  fi

  write_conf "$conf_one" "$key" 51820 "$hpk" "$peer1_pub"
  print_cmd awg setconf "$IFACE" "$conf_one"
  if awg setconf "$IFACE" "$conf_one"; then
    peers=$(awg show "$IFACE" peers | wc -l | tr -d ' ')
    if [ "$peers" = "1" ]; then
      ok "REPLACE_PEERS: лишний пир удалён (остался 1)"
    else
      fail "REPLACE_PEERS: в ядре $peers пиров, ожидался 1"
    fi
  else
    fail "повторный awg setconf завершился ошибкой"
  fi

  print_cmd ip link del dev "$IFACE"
  ip link del dev "$IFACE" 2>/dev/null || true
  if ip link show dev "$IFACE" >/dev/null 2>&1; then
    fail "интерфейс $IFACE не удалён"
  else
    ok "ip link del: интерфейс удалён"
  fi
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

traffic_test() {
  section "Сквозной трафик и счётчики (2 netns, 2 AWG-интерфейса)"

  local tool
  for tool in awg ping nsenter unshare; do
    if ! have "$tool"; then
      skip "нет $tool: сквозной тест невозможен"
      return
    fi
  done

  if ! unshare --net true 2>/dev/null; then
    skip "нет прав на создание вложенного netns"
    return
  fi

  local ns1 ns2
  start_netns || { skip "не удалось создать netns 1"; return; }
  ns1=$NS_PID
  start_netns || { skip "не удалось создать netns 2"; return; }
  ns2=$NS_PID

  local r1=awgtr-r1 r2=awgtr-r2 c1=awgtr-c1 c2=awgtr-c2
  local k0 k1 pub0 pub1

  ip link add "$r1" type veth peer name "$c1"
  ip link add "$r2" type veth peer name "$c2"
  ip addr add 10.40.1.1/24 dev "$r1"
  ip addr add 10.40.2.1/24 dev "$r2"
  ip link set "$r1" up
  ip link set "$r2" up
  ip link set "$c1" netns "$ns1"
  ip link set "$c2" netns "$ns2"
  sysctl -qw net.ipv4.ip_forward=1

  k0=$(awg genkey)
  pub0=$(printf '%s' "$k0" | awg pubkey)
  k1=$(awg genkey)
  pub1=$(printf '%s' "$k1" | awg pubkey)

  local conf
  conf="$WORKDIR/awg-traffic.conf"

  nsenter -t "$ns1" -n bash -s -- "$k0" "$pub1" "$c1" "$conf" <<'INNER' || { fail "настройка netns 1"; return; }
set -e
key=$1; peer=$2; veth=$3; conf=$4
ip link set "$veth" up
ip addr add 10.40.1.2/24 dev "$veth"
ip route add default via 10.40.1.1
sysctl -qw net.ipv4.conf.all.rp_filter=0
ip link add dev awg0 type amneziawg
ip addr add 10.250.0.1/32 dev awg0
ip link set dev awg0 mtu 1420 up
ip route add 10.250.1.0/24 dev awg0
printf '[Interface]\nPrivateKey = %s\nListenPort = 51820\nJc = 3\nJmin = 10\nJmax = 50\nS1 = 15\nS2 = 16\nS3 = 17\nS4 = 18\nH1 = 100100-100200\nH2 = 1000100-1000200\nH3 = 2000100-2000200\nH4 = 3000100-3000200\nRandomTrailers = on\n\n[Peer]\nPublicKey = %s\nAllowedIPs = 10.250.1.0/24\nEndpoint = 10.40.2.2:51821\nPersistentKeepalive = 5\n' "$key" "$peer" > "$conf"
awg setconf awg0 "$conf"
INNER

  nsenter -t "$ns2" -n bash -s -- "$k1" "$pub0" "$c2" "$conf" <<'INNER' || { fail "настройка netns 2"; return; }
set -e
key=$1; peer=$2; veth=$3; conf=$4
ip link set "$veth" up
ip addr add 10.40.2.2/24 dev "$veth"
ip route add default via 10.40.2.1
sysctl -qw net.ipv4.conf.all.rp_filter=0
ip link add dev awg1 type amneziawg
ip addr add 10.250.1.1/32 dev awg1
ip link set dev awg1 mtu 1420 up
ip route add 10.250.0.0/24 dev awg1
printf '[Interface]\nPrivateKey = %s\nListenPort = 51821\nJc = 3\nJmin = 10\nJmax = 50\nS1 = 15\nS2 = 16\nS3 = 17\nS4 = 18\nH1 = 100100-100200\nH2 = 1000100-1000200\nH3 = 2000100-2000200\nH4 = 3000100-3000200\nRandomTrailers = on\n\n[Peer]\nPublicKey = %s\nAllowedIPs = 10.250.0.0/24\n' "$key" "$peer" > "$conf"
awg setconf awg1 "$conf"
INNER

  local attempt=0 rc=1
  while [ "$attempt" -lt 25 ]; do
    if nsenter -t "$ns1" -n ping -c 1 -W 1 -I awg0 10.250.1.1 >/dev/null 2>&1; then
      rc=0
      break
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  if [ "$rc" -eq 0 ]; then
    ok "ICMP между двумя AWG-интерфейсами проходит"
    local ping_out
    ping_out=$(nsenter -t "$ns1" -n ping -c 3 -W 2 -i 0.4 10.250.1.1 2>&1) || true
    if printf '%s\n' "$ping_out" | grep -q '0% packet loss'; then
      ok "стабильный ICMP (0% потерь на 3 пакетах)"
    else
      warn "ICMP проходит, но есть потери"; printf '%s\n' "$ping_out" | tail -n 3 | sed 's/^/    /'
    fi
  else
    fail "ICMP не проходит между AWG-интерфейсами"
    nsenter -t "$ns1" -n awg show awg0 2>&1 | sed 's/^/    /' || true
    nsenter -t "$ns2" -n awg show awg1 2>&1 | sed 's/^/    /' || true
    nsenter -t "$ns1" -n ip route 2>&1 | sed 's/^/    R1 /' || true
  fi

  if nsenter -t "$ns1" -n awg show awg0 dump 2>/dev/null | tail -n +2 | awk '{rx += $6; tx += $7} END {exit !(rx > 0 && tx > 0)}'; then
    ok "awg show dump: счётчики rx/tx растут"
  else
    fail "awg show dump: счётчики rx/tx не выросли"
  fi
  if nsenter -t "$ns1" -n awg show awg0 2>/dev/null | grep -q 'latest handshake:'; then
    ok "latest handshake зафиксирован"
  else
    fail "latest handshake отсутствует"
  fi

  ip link del "$r1" 2>/dev/null || true
  ip link del "$r2" 2>/dev/null || true
}

dry_run() {
  section "План (dry-run)"
  note "Ничего не создаётся. Реальное выполнение: --apply (root) или --apply --netns."
  note "Модуль:"; print_cmd modprobe "$MODULE"
  note "Интерфейс:"
  print_cmd ip link add dev "$IFACE" type "$MODULE"
  print_cmd ip link set dev "$IFACE" mtu 1420
  print_cmd ip addr replace 10.255.255.1/32 dev "$IFACE"
  print_cmd ip link set dev "$IFACE" up
  print_cmd awg setconf "$IFACE" "<conf: H1-H4, S1-S4, Jc/Jmin/Jmax, HeaderProtectionKey, RandomTrailers, 2 peers>"
  print_cmd awg setconf "$IFACE" "<conf: 1 peer, проверка REPLACE_PEERS>"
  print_cmd ip link del dev "$IFACE"
  if [ "$TRAFFIC" -eq 1 ]; then
    note "Сквозной трафик (при --apply): два вложенных netns, veth, два awg-интерфейса, ping и awg show dump."
  fi

  section "Готовность окружения"
  local tool
  for tool in ip awg modprobe unshare nsenter ping; do
    if have "$tool"; then
      ok "$tool: $(command -v "$tool")"
    else
      warn "$tool не найден"
    fi
  done
  if [ "$(id -u)" -eq 0 ]; then
    ok "запуск от root"
  else
    note "запуск не от root: --apply потребует root или --netns"
    if unshare -rn true 2>/dev/null; then
      ok "unprivileged user namespaces доступны (--apply --netns сработает)"
    else
      warn "unprivileged user namespaces недоступны"
    fi
  fi
  if [ -e /sys/module/"$MODULE" ]; then
    ok "/sys/module/$MODULE присутствует"
  fi
}

print_summary() {
  section "Итог"
  printf '  провалено: %s, предупреждений: %s, пропущено: %s\n' "$FAILED" "$WARNED" "$SKIPPED"
  if [ "$FAILED" -gt 0 ]; then
    return 1
  fi
  ok "проверка завершена без ошибок"
  return 0
}

main() {
  parse_args "$@"

  if [ -n "$INSPECT" ]; then
    inspect_interface "$INSPECT"
    print_summary || exit 1
    return 0
  fi

  if [ "$APPLY" -eq 0 ]; then
    check_module
    dry_run
    print_summary || exit 1
    return 0
  fi

  require_root_or_netns

  if [ -z "${AWG_VERIFY_KERNEL_NS:-}" ]; then
    check_module
    local rc=0
    reexec_in_netns || rc=$?
    exit "$rc"
  fi

  trap cleanup EXIT
  WORKDIR=$(mktemp -d)
  check_link_and_obf
  if [ "$TRAFFIC" -eq 1 ]; then
    traffic_test
  fi
  print_summary || exit 1
}

require_root_or_netns() {
  if [ "$(id -u)" -ne 0 ] && [ "$USE_NETNS" -eq 0 ]; then
    require_root
  fi
}

reexec_in_netns() {
  local args=(--apply --ifname "$IFACE")
  if [ "$TRAFFIC" -eq 0 ]; then
    args+=(--no-traffic)
  fi
  if [ "$USE_NETNS" -eq 1 ]; then
    args+=(--netns)
  fi

  section "Изолированный netns"
  if [ "$(id -u)" -eq 0 ]; then
    note "все проверки выполняются в новом netns, хост не затрагивается"
    unshare --net -- env AWG_VERIFY_KERNEL_NS=1 bash "$SCRIPT_PATH" "${args[@]}"
  else
    note "все проверки выполняются в user+net namespace, root не нужен"
    unshare -rn -- env AWG_VERIFY_KERNEL_NS=1 bash "$SCRIPT_PATH" "${args[@]}"
  fi
}

main "$@"
