#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
readonly SCRIPT_PATH

API="http://127.0.0.1:8080/api/v1"
APPLY=0
GROUP=""
IFACE=""
DEVICE_A="hairpin-a"
DEVICE_B="hairpin-b"
DEVICE_A_ID=""
DEVICE_B_ID=""
CREATED_A=0
CREATED_B=0
CLEANUP_DEVICES=0
KEEP=0
TRAFFIC=1
WAIT=12
UP_LIMIT=2000
DOWN_LIMIT=5000
IFB=""

NS_A="ns-hairpin-a"
NS_B="ns-hairpin-b"
VETH_A="hairpin-a"
VETH_A_NS="hairpin-a-ns"
VETH_B="hairpin-b"
VETH_B_NS="hairpin-b-ns"
HOST_A="198.18.50.1"
ADDR_A="198.18.50.2"
NET_A="198.18.50.0/24"
HOST_B="198.18.51.1"
ADDR_B="198.18.51.2"
NET_B="198.18.51.0/24"
IPERF_PORT=5201

WORKDIR=""
TOKEN=""
USER_ID=""
GROUP_ID=""
IFACE_ID=""
A_IP=""
B_IP=""
CONF_A=""
CONF_B=""
PASSED=0
FAILED=0
SKIPPED=0

usage() {
  cat <<'EOF'
Проверка hairpin-forwarding на одном AWG-интерфейсе и его совместимости с tc.

Использование:
  sudo -E scripts/verify-hairpin.sh --apply --group "VPN Pilot"

Опции:
  --apply               выполнить проверку (по умолчанию только план и окружение)
  --api URL             базовый URL API (по умолчанию http://127.0.0.1:8080/api/v1)
  --group NAME          группа, в которой создаются/используются устройства
  --iface NAME          интерфейс (по умолчанию единственный интерфейс группы)
  --device-a NAME       первое устройство (по умолчанию hairpin-a)
  --device-b NAME       второе устройство (по умолчанию hairpin-b)
  --wait SECONDS        ожидание reconcile worker (по умолчанию 12)
  --no-traffic          без iperf3, только ping и структура
  --cleanup-devices     удалить устройства, созданные этим запуском
  --keep                не удалять netns/veth при завершении (для отладки)
  -h, --help            эта справка

Переменные окружения:
  PANEL_LOGIN           логин администратора (по умолчанию admin)
  PANEL_PASSWORD        пароль администратора (обязателен при --apply)

Что проверяется:
  - ping и iperf3 между двумя клиентами на одном интерфейсе (hairpin);
  - PATCH лимитов не сбрасывает endpoint'ы и не теряет пакеты;
  - up-лимит применяется, IFB создаётся, ping продолжает работать;
  - down-only лимит не оставляет ifb-<iface> и ingress-redirect;
  - изоляция: при forwarding только у B трафик A->B блокируется, B->A работает,
    в том числе при активном IFB;
  - после снятия лимитов шейпер и IFB удалены, ping работает.

Стенд создаёт два временных netns и veth в диапазоне 198.18.0.0/15, меняет
forwarding/лимиты только у выбранных устройств и восстанавливает их в trap.
Требуются root (netns/veth/awg-quick), curl, jq, ip, tc, nft, awg, awg-quick,
iperf3 и ping. Скрипт не правит nft-правила вручную: всё делает worker.
EOF
}

section() { printf '\n== %s ==\n' "$*"; }
ok() { printf '  [ok]   %s\n' "$*"; PASSED=$((PASSED + 1)); }
fail() { printf '  [fail] %s\n' "$*"; FAILED=$((FAILED + 1)); }
skip() { printf '  [skip] %s\n' "$*"; SKIPPED=$((SKIPPED + 1)); }
note() { printf '  [info] %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 2; }

have() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  have sudo || die "нужен root или sudo для netns/veth/awg-quick"
  SUDO="sudo"
fi

S() {
  if [ -n "$SUDO" ]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --api) API="${2:?}"; shift ;;
    --group) GROUP="${2:?}"; shift ;;
    --iface) IFACE="${2:?}"; shift ;;
    --device-a) DEVICE_A="${2:?}"; shift ;;
    --device-b) DEVICE_B="${2:?}"; shift ;;
    --wait) WAIT="${2:?}"; shift ;;
    --no-traffic) TRAFFIC=0 ;;
    --cleanup-devices) CLEANUP_DEVICES=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "неизвестный аргумент: $1" ;;
  esac
  shift
done

cleanup() {
  local rc=$?
  if [ "$APPLY" -eq 1 ] && [ "$KEEP" -eq 0 ]; then
    if [ -n "$CONF_A" ]; then
      S ip netns exec "$NS_A" awg-quick down "$CONF_A" >/dev/null 2>&1 || true
    fi
    if [ -n "$CONF_B" ]; then
      S ip netns exec "$NS_B" awg-quick down "$CONF_B" >/dev/null 2>&1 || true
    fi
    S ip link del "$VETH_A" >/dev/null 2>&1 || true
    S ip link del "$VETH_B" >/dev/null 2>&1 || true
    S ip netns del "$NS_A" >/dev/null 2>&1 || true
    S ip netns del "$NS_B" >/dev/null 2>&1 || true
    if [ -n "$TOKEN" ]; then
      local body='{"forwarding":{"to_own_devices":true,"allowed_devices":[]},"up_kbps":0,"down_kbps":0}'
      for id in "$DEVICE_A_ID" "$DEVICE_B_ID"; do
        if [ -n "$id" ]; then
          curl -sS -o /dev/null -X PATCH "$API/devices/$id" \
            -H "Authorization: Bearer $TOKEN" \
            -H 'Content-Type: application/json' -d "$body" || true
        fi
      done
      if [ "$CLEANUP_DEVICES" -eq 1 ]; then
        if [ "$CREATED_A" -eq 1 ] && [ -n "$DEVICE_A_ID" ]; then
          curl -sS -o /dev/null -X DELETE "$API/devices/$DEVICE_A_ID" \
            -H "Authorization: Bearer $TOKEN" || true
        fi
        if [ "$CREATED_B" -eq 1 ] && [ -n "$DEVICE_B_ID" ]; then
          curl -sS -o /dev/null -X DELETE "$API/devices/$DEVICE_B_ID" \
            -H "Authorization: Bearer $TOKEN" || true
        fi
      fi
    fi
  fi
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
  exit "$rc"
}
trap cleanup EXIT

api() {
  local method=$1 path=$2 body=${3:-} tmp code
  tmp=$(mktemp)
  local args=(-sS -o "$tmp" -w '%{http_code}' -X "$method" "$API$path")
  if [ -n "$TOKEN" ]; then
    args+=(-H "Authorization: Bearer $TOKEN")
  fi
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$body")
  fi
  if ! code=$(curl "${args[@]}"); then
    rm -f "$tmp"
    die "curl не смог выполнить $method $path"
  fi
  case "$code" in
    2*) cat "$tmp"; rm -f "$tmp" ;;
    *) local message; message=$(cat "$tmp"); rm -f "$tmp"; die "API $method $path -> HTTP $code: $message" ;;
  esac
}

ping_ok() {
  local ns=$1 dst=$2
  S ip netns exec "$ns" ping -c2 -W2 "$dst" >/dev/null 2>&1
}

iperf_mbit() {
  local srv_ns=$1 srv_ip=$2 cli_ns=$3 tag=$4 dur=${5:-4}
  local out="$WORKDIR/iperf-$tag.json" err="$WORKDIR/iperf-$tag.err"
  S ip netns exec "$srv_ns" iperf3 -s -B "$srv_ip" -p "$IPERF_PORT" -1 >"$err" 2>&1 &
  local pid=$!
  sleep 1
  local value=0
  if S ip netns exec "$cli_ns" iperf3 -c "$srv_ip" -p "$IPERF_PORT" -t "$dur" --json >"$out" 2>>"$err"; then
    local bps
    bps=$(jq -r '.end.sum_received.bits_per_second // 0' "$out")
    value=$(awk -v b="$bps" 'BEGIN { printf "%.2f", b / 1000000 }')
  else
    kill "$pid" >/dev/null 2>&1 || true
  fi
  wait "$pid" >/dev/null 2>&1 || true
  printf '%s' "$value"
}

check_range() {
  local label=$1 value=$2 min=$3 max=$4
  if awk -v v="$value" -v lo="$min" -v hi="$max" 'BEGIN { exit !(v >= lo && v <= hi) }'; then
    ok "$label: ${value} Mbit/s (ожидалось ${min}..${max})"
  else
    fail "$label: ${value} Mbit/s (ожидалось ${min}..${max})"
  fi
}

endpoints() {
  S awg show "$IFACE" 2>/dev/null | grep -c '^  endpoint:' || true
}

section "окружение"
note "API: $API"
[ "$(id -u)" -eq 0 ] && note "запуск от root" || note "запуск через sudo: $SUDO"
for tool in curl jq ip tc nft awg awg-quick iperf3 ping; do
  have "$tool" || die "не найдена команда: $tool"
done
if [ "$APPLY" -eq 1 ]; then
  [ -n "${PANEL_PASSWORD:-}" ] || die "задайте PANEL_PASSWORD"
  [ -n "$GROUP" ] || die "задайте --group"
  note "группа: $GROUP"
  note "лимиты для проверки: up=$UP_LIMIT kbit, down=$DOWN_LIMIT kbit"
else
  note "dry-run: окружение в порядке; для реальной проверки добавьте --apply"
  note "пример: sudo -E PANEL_PASSWORD=... $SCRIPT_PATH --apply --group \"VPN Pilot\""
  exit 0
fi

WORKDIR=$(mktemp -d)
PANEL_LOGIN=${PANEL_LOGIN:-admin}
TOKEN=$(curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"login\":\"$PANEL_LOGIN\",\"password\":\"$PANEL_PASSWORD\"}" | jq -r '.token // empty')
[ -n "$TOKEN" ] || die "не удалось получить токен"

section "панель: пользователь, группа, интерфейс"
USER_JSON=$(api GET /users | jq -c --arg login "$PANEL_LOGIN" '.[] | select(.login == $login)')
USER_ID=$(jq -r '.id // empty' <<<"$USER_JSON")
[ -n "$USER_ID" ] || die "пользователь $PANEL_LOGIN не найден"
GROUP_ID=$(api GET /groups | jq -r --arg name "$GROUP" '.[] | select(.name == $name) | .id')
[ -n "$GROUP_ID" ] || die "группа $GROUP не найдена"

INTERFACES=$(api GET /interfaces | jq -c --arg gid "$GROUP_ID" '[.[] | select(.group_id == $gid)]')
if [ -n "$IFACE" ]; then
  IFACE_JSON=$(jq -c --arg name "$IFACE" '.[] | select(.name == $name)' <<<"$INTERFACES")
else
  COUNT=$(jq 'length' <<<"$INTERFACES")
  [ "$COUNT" -eq 1 ] || die "в группе $COUNT интерфейсов: укажите --iface"
  IFACE_JSON=$(jq -c '.[0]' <<<"$INTERFACES")
fi
[ -n "$IFACE_JSON" ] && [ "$IFACE_JSON" != "null" ] || die "интерфейс не найден в группе $GROUP"
IFACE=$(jq -r '.name' <<<"$IFACE_JSON")
IFACE_ID=$(jq -r '.id' <<<"$IFACE_JSON")
note "пользователь: $USER_ID"
note "группа: $GROUP_ID"
note "интерфейс: $IFACE ($IFACE_ID)"

TARIFF_ID=$(jq -r '.tariff_id // empty' <<<"$USER_JSON")
if [ -n "$TARIFF_ID" ]; then
  TARIFF=$(api GET /tariffs | jq -c --arg id "$TARIFF_ID" '.[] | select(.id == $id)')
  GROUP_UP=$(jq -r '.group_up_kbps // 0' <<<"$TARIFF")
  GROUP_DOWN=$(jq -r '.group_down_kbps // 0' <<<"$TARIFF")
  if [ "$GROUP_UP" -gt 0 ] && [ "$GROUP_UP" -lt "$UP_LIMIT" ]; then UP_LIMIT=$GROUP_UP; fi
  if [ "$GROUP_DOWN" -gt 0 ] && [ "$GROUP_DOWN" -lt "$DOWN_LIMIT" ]; then DOWN_LIMIT=$GROUP_DOWN; fi
  note "лимиты ограничены тарифом: up=$UP_LIMIT kbit, down=$DOWN_LIMIT kbit"
fi

section "панель: устройства"
resolve_device() {
  local name=$1
  api GET /devices | jq -r --arg name "$name" --arg gid "$GROUP_ID" \
    'first(.[] | select(.name == $name and .group_id == $gid) | .id) // empty'
}
DEVICE_A_ID=$(resolve_device "$DEVICE_A")
if [ -z "$DEVICE_A_ID" ]; then
  DEVICE_A_ID=$(api POST /devices \
    "{\"user_id\":\"$USER_ID\",\"group_id\":\"$GROUP_ID\",\"name\":\"$DEVICE_A\"}" | jq -r '.id')
  CREATED_A=1
fi
DEVICE_B_ID=$(resolve_device "$DEVICE_B")
if [ -z "$DEVICE_B_ID" ]; then
  DEVICE_B_ID=$(api POST /devices \
    "{\"user_id\":\"$USER_ID\",\"group_id\":\"$GROUP_ID\",\"name\":\"$DEVICE_B\"}" | jq -r '.id')
  CREATED_B=1
fi
note "устройства: A=$DEVICE_A ($DEVICE_A_ID), B=$DEVICE_B ($DEVICE_B_ID)"

FWD_ON='{"forwarding":{"to_own_devices":true,"allowed_devices":[]},"up_kbps":0,"down_kbps":0}'
api PATCH "/devices/$DEVICE_A_ID" "$FWD_ON" >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "$FWD_ON" >/dev/null

section "профили и клиентские конфиги"
PROFILE_A=$(api GET "/devices/$DEVICE_A_ID/profiles")
PROFILE_B=$(api GET "/devices/$DEVICE_B_ID/profiles")
A_IP=$(jq -r '.[0].addresses[0]' <<<"$PROFILE_A" | cut -d/ -f1)
B_IP=$(jq -r '.[0].addresses[0]' <<<"$PROFILE_B" | cut -d/ -f1)
[ -n "$A_IP" ] && [ "$A_IP" != "null" ] || die "у устройства A нет адреса"
[ -n "$B_IP" ] && [ "$B_IP" != "null" ] || die "у устройства B нет адреса"
PORT_A=$(jq -r '.[0].conf' <<<"$PROFILE_A" | sed -n 's/^Endpoint = .*:\([0-9][0-9]*\)$/\1/p')
PORT_B=$(jq -r '.[0].conf' <<<"$PROFILE_B" | sed -n 's/^Endpoint = .*:\([0-9][0-9]*\)$/\1/p')
[ -n "$PORT_A" ] && [ -n "$PORT_B" ] || die "не удалось определить порт из профиля"
CONF_A="$WORKDIR/awg-a.conf"
CONF_B="$WORKDIR/awg-b.conf"
jq -r '.[0].conf' <<<"$PROFILE_A" |
  sed -e '/^DNS =/d' -e "s|^Endpoint = .*|Endpoint = ${HOST_A}:${PORT_A}|" >"$CONF_A"
jq -r '.[0].conf' <<<"$PROFILE_B" |
  sed -e '/^DNS =/d' -e "s|^Endpoint = .*|Endpoint = ${HOST_B}:${PORT_B}|" >"$CONF_B"
chmod 600 "$CONF_A" "$CONF_B"
note "A=$A_IP -> ${HOST_A}:${PORT_A}"
note "B=$B_IP -> ${HOST_B}:${PORT_B}"

section "сеть стенда"
if S ip link show "$VETH_A" >/dev/null 2>&1 || S ip netns list | grep -qx "$NS_A"; then
  die "остались артефакты предыдущего запуска ($NS_A/$VETH_A); удалите их или запустите cleanup"
fi
S ip netns add "$NS_A"
S ip netns add "$NS_B"
S ip link add "$VETH_A" type veth peer name "$VETH_A_NS"
S ip link add "$VETH_B" type veth peer name "$VETH_B_NS"
S ip link set "$VETH_A_NS" netns "$NS_A"
S ip link set "$VETH_B_NS" netns "$NS_B"
S ip addr add "$HOST_A/24" dev "$VETH_A"
S ip addr add "$HOST_B/24" dev "$VETH_B"
S ip link set "$VETH_A" up
S ip link set "$VETH_B" up
S ip netns exec "$NS_A" ip addr add "$ADDR_A/24" dev "$VETH_A_NS"
S ip netns exec "$NS_B" ip addr add "$ADDR_B/24" dev "$VETH_B_NS"
S ip netns exec "$NS_A" ip link set lo up
S ip netns exec "$NS_B" ip link set lo up
S ip netns exec "$NS_A" ip link set "$VETH_A_NS" up
S ip netns exec "$NS_B" ip link set "$VETH_B_NS" up
S ip netns exec "$NS_A" ip route add default via "$HOST_A"
S ip netns exec "$NS_B" ip route add default via "$HOST_B"
S ip netns exec "$NS_A" awg-quick up "$CONF_A" >/dev/null
S ip netns exec "$NS_B" awg-quick up "$CONF_B" >/dev/null
sleep 3

section "1. baseline без лимитов"
if ping_ok "$NS_A" "$B_IP"; then ok "ping A->B"; else fail "ping A->B"; fi
if ping_ok "$NS_B" "$A_IP"; then ok "ping B->A"; else fail "ping B->A"; fi
BASE_AB=0
BASE_BA=0
if [ "$TRAFFIC" -eq 1 ]; then
  BASE_AB=$(iperf_mbit "$NS_B" "$B_IP" "$NS_A" base-ab)
  BASE_BA=$(iperf_mbit "$NS_A" "$A_IP" "$NS_B" base-ba)
  check_range "iperf A->B" "$BASE_AB" 10 100000
  check_range "iperf B->A" "$BASE_BA" 10 100000
else
  skip "iperf (--no-traffic)"
fi

api PATCH "/devices/$DEVICE_A_ID" "{\"up_kbps\":$UP_LIMIT,\"down_kbps\":0}" >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "{\"up_kbps\":$UP_LIMIT,\"down_kbps\":0}" >/dev/null
sleep 2
api PATCH "/devices/$DEVICE_A_ID" "$FWD_ON" >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "$FWD_ON" >/dev/null
sleep "$WAIT"

ENDPOINTS_BEFORE=$(endpoints)
note "endpoint'ов до PATCH: $ENDPOINTS_BEFORE"
S ip netns exec "$NS_A" ping -i 0.2 -W 1 -c 60 "$B_IP" >"$WORKDIR/ping-patch.log" 2>&1 &
PING_PID=$!
sleep 1
api PATCH "/devices/$DEVICE_A_ID" "{\"up_kbps\":$UP_LIMIT,\"down_kbps\":0}" >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "{\"up_kbps\":$UP_LIMIT,\"down_kbps\":0}" >/dev/null
wait "$PING_PID" >/dev/null 2>&1 || true
LOSS=$(grep -oE '[0-9]+(\.[0-9]+)?% packet loss' "$WORKDIR/ping-patch.log" | sed 's/% packet loss//' | head -1)
ENDPOINTS_AFTER=$(endpoints)
note "endpoint'ов после PATCH: $ENDPOINTS_AFTER"
if awk -v l="${LOSS:-100}" 'BEGIN { exit !(l <= 2) }'; then
  ok "PATCH лимитов без обрыва (потери ${LOSS:-?}%)"
else
  fail "PATCH лимитов: потери ${LOSS:-?}%"
fi
if [ "$ENDPOINTS_AFTER" = "$ENDPOINTS_BEFORE" ] && [ "$ENDPOINTS_AFTER" -ge 2 ]; then
  ok "endpoint'ы сохранены ($ENDPOINTS_AFTER)"
else
  fail "endpoint'ы изменились: было $ENDPOINTS_BEFORE, стало $ENDPOINTS_AFTER"
fi
sleep "$WAIT"

section "2. up-лимит $UP_LIMIT kbit"
if ip link show "ifb-$IFACE" >/dev/null 2>&1; then ok "ifb-$IFACE создан"; else fail "ifb-$IFACE отсутствует"; fi
if ping_ok "$NS_A" "$B_IP"; then ok "ping A->B при up-лимите"; else fail "ping A->B при up-лимите"; fi
if ping_ok "$NS_B" "$A_IP"; then ok "ping B->A при up-лимите"; else fail "ping B->A при up-лимите"; fi
if [ "$TRAFFIC" -eq 1 ]; then
  UP_AB=$(iperf_mbit "$NS_B" "$B_IP" "$NS_A" uplim-ab)
  UP_BA=$(iperf_mbit "$NS_A" "$A_IP" "$NS_B" uplim-ba)
  check_range "iperf A->B при up-лимите" "$UP_AB" "$(awk -v l="$UP_LIMIT" 'BEGIN{printf "%.2f", l*0.6/1000}')" "$(awk -v l="$UP_LIMIT" 'BEGIN{printf "%.2f", l*1.5/1000}')"
  check_range "iperf B->A при up-лимите" "$UP_BA" "$(awk -v l="$UP_LIMIT" 'BEGIN{printf "%.2f", l*0.6/1000}')" "$(awk -v l="$UP_LIMIT" 'BEGIN{printf "%.2f", l*1.5/1000}')"
else
  skip "iperf при up-лимите (--no-traffic)"
fi

section "3. down-only лимит $DOWN_LIMIT kbit"
api PATCH "/devices/$DEVICE_A_ID" "{\"up_kbps\":0,\"down_kbps\":$DOWN_LIMIT}" >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "{\"up_kbps\":0,\"down_kbps\":$DOWN_LIMIT}" >/dev/null
sleep "$WAIT"
if ip link show "ifb-$IFACE" >/dev/null 2>&1; then
  fail "ifb-$IFACE остался при down-only лимите"
else
  ok "ifb-$IFACE удалён при down-only лимите"
fi
if ping_ok "$NS_A" "$B_IP"; then ok "ping A->B при down-лимите"; else fail "ping A->B при down-лимите"; fi
if ping_ok "$NS_B" "$A_IP"; then ok "ping B->A при down-лимите"; else fail "ping B->A при down-лимите"; fi
if [ "$TRAFFIC" -eq 1 ]; then
  DOWN_AB=$(iperf_mbit "$NS_B" "$B_IP" "$NS_A" downlim-ab)
  DOWN_BA=$(iperf_mbit "$NS_A" "$A_IP" "$NS_B" downlim-ba)
  check_range "iperf A->B при down-лимите" "$DOWN_AB" "$(awk -v l="$DOWN_LIMIT" 'BEGIN{printf "%.2f", l*0.6/1000}')" "$(awk -v l="$DOWN_LIMIT" 'BEGIN{printf "%.2f", l*1.5/1000}')"
  check_range "iperf B->A при down-лимите" "$DOWN_BA" "$(awk -v l="$DOWN_LIMIT" 'BEGIN{printf "%.2f", l*0.6/1000}')" "$(awk -v l="$DOWN_LIMIT" 'BEGIN{printf "%.2f", l*1.5/1000}')"
else
  skip "iperf при down-лимите (--no-traffic)"
fi

section "4. изоляция без шейпера"
api PATCH "/devices/$DEVICE_A_ID" '{"up_kbps":0,"down_kbps":0,"forwarding":{"to_own_devices":false,"allowed_devices":[]}}' >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "$FWD_ON" >/dev/null
sleep "$WAIT"
if ping_ok "$NS_A" "$B_IP"; then fail "A->B прошёл, хотя forwarding у A выключен"; else ok "A->B заблокирован"; fi
if ping_ok "$NS_B" "$A_IP"; then ok "B->A разрешён (stateful-ответы)"; else fail "B->A не работает, хотя forwarding у B включён"; fi

section "5. изоляция при активном IFB"
api PATCH "/devices/$DEVICE_A_ID" "{\"up_kbps\":$UP_LIMIT,\"down_kbps\":0,\"forwarding\":{\"to_own_devices\":false,\"allowed_devices\":[]}}" >/dev/null
sleep "$WAIT"
if ip link show "ifb-$IFACE" >/dev/null 2>&1; then ok "ifb-$IFACE активен"; else fail "ifb-$IFACE отсутствует при up-лимите"; fi
if ping_ok "$NS_A" "$B_IP"; then fail "A->B прошёл при IFB, хотя forwarding у A выключен"; else ok "A->B заблокирован при IFB"; fi
if ping_ok "$NS_B" "$A_IP"; then ok "B->A разрешён при IFB"; else fail "B->A не работает при IFB"; fi

section "6. восстановление"
api PATCH "/devices/$DEVICE_A_ID" "$FWD_ON" >/dev/null
api PATCH "/devices/$DEVICE_B_ID" "$FWD_ON" >/dev/null
sleep "$WAIT"
if ping_ok "$NS_A" "$B_IP"; then ok "ping A->B после восстановления"; else fail "ping A->B после восстановления"; fi
if ping_ok "$NS_B" "$A_IP"; then ok "ping B->A после восстановления"; else fail "ping B->A после восстановления"; fi
QDISC=$(S tc qdisc show dev "$IFACE" 2>/dev/null | head -1)
if [[ "$QDISC" == *noqueue* ]]; then ok "tc снят (noqueue)"; else fail "tc остался: $QDISC"; fi
if ip link show "ifb-$IFACE" >/dev/null 2>&1; then fail "ifb-$IFACE остался"; else ok "ifb-$IFACE отсутствует"; fi

section "итог"
printf '  пройдено: %d, провалов: %d, пропущено: %d\n' "$PASSED" "$FAILED" "$SKIPPED"
[ "$FAILED" -eq 0 ] || exit 1
