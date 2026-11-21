#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${AWG_BASE_URL:-http://127.0.0.1:8080}"
LOGIN="${AWG_LOADTEST_LOGIN:-admin}"
PASSWORD="${AWG_LOADTEST_PASSWORD:?задайте AWG_LOADTEST_PASSWORD}"
DURATION="${DURATION:-30s}"
CONNECTIONS="${CONNECTIONS:-50}"
THREADS="${THREADS:-4}"

for tool in curl jq wrk; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "не найден $tool" >&2
    exit 1
  fi
done

login_payload=$(jq -n --arg login "$LOGIN" --arg password "$PASSWORD" \
  '{login: $login, password: $password}')

response=$(curl -fsS -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  --data "$login_payload")

token=$(printf '%s' "$response" | jq -r '.access_token // empty')
if [ -z "$token" ]; then
  echo "логин не вернул access_token: $response" >&2
  exit 1
fi

# JWT uses base64url + dots; reject anything else before embedding it in Lua.
if ! printf '%s' "$token" | grep -Eq '^[A-Za-z0-9._-]+$'; then
  echo "access_token содержит недопустимые символы" >&2
  exit 1
fi

# The token must never appear in argv (/proc/<pid>/cmdline is world-readable).
# wrk reads headers from a Lua script, so keep it in a 0600 temp file and
# remove it on exit.
wrk_script=$(mktemp "${TMPDIR:-/tmp}/awg-loadtest-XXXXXX.lua")
chmod 600 "$wrk_script"
cleanup() {
  rm -f "$wrk_script"
}
trap cleanup EXIT INT TERM

cat >"$wrk_script" <<EOF
wrk.method = "GET"
wrk.headers["Authorization"] = "Bearer $token"
wrk.headers["Accept"] = "application/json"
EOF

endpoints=(
  "/api/v1/health"
  "/api/v1/devices"
  "/api/v1/interfaces"
  "/api/v1/nodes"
  "/api/v1/stats/overview"
  "/api/v1/stats/series?window=24h"
  "/api/v1/audit?limit=50"
)

printf 'target: %s\nthreads: %s, connections: %s, duration: %s\n\n' \
  "$BASE_URL" "$THREADS" "$CONNECTIONS" "$DURATION"

for path in "${endpoints[@]}"; do
  printf '== %s ==\n' "$path"
  wrk -t"$THREADS" -c"$CONNECTIONS" -d"$DURATION" \
    -s "$wrk_script" \
    "$BASE_URL$path"
  printf '\n'
done
