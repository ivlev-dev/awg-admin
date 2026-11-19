#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="release"
THRESHOLD_MS=50
LOG_FILE="${TMPDIR:-/tmp}/awg-backend-perf-$$.log"
KEEP_LOG=0

usage() {
  cat <<'EOF'
Usage: scripts/check-backend-perf.sh [options]

Runs the ignored awg-clients paging benchmark over 1k and 10k devices and
checks the last 10k page against a latency budget.

Options:
  --release                 build and run in release mode (default, budget 50 ms)
  --debug                   run in debug mode (budget 250 ms)
  --threshold-ms=<ms>       override the latency budget
  --keep-log[=<path>]       keep the cargo output log
  -h, --help                show this help

The check prints machine-readable "devices=10000 ... pages=[...]" output from
backend/crates/clients/tests/paging_flow.rs; the last page (offset 9950) is
parsed and compared with the budget.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --release) PROFILE="release"; THRESHOLD_MS=50 ;;
    --debug) PROFILE="debug"; THRESHOLD_MS=250 ;;
    --threshold-ms=*) THRESHOLD_MS="${arg#*=}" ;;
    --keep-log=*) KEEP_LOG=1; LOG_FILE="${arg#*=}" ;;
    --keep-log) KEEP_LOG=1 ;;
    *) echo "error: unknown option \"$arg\" (try --help)" >&2; exit 2 ;;
  esac
done

if ! [[ "$THRESHOLD_MS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "error: --threshold-ms must be a positive number" >&2
  exit 2
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found" >&2
  exit 1
fi

cleanup() {
  if (( ! KEEP_LOG )); then
    rm -f "$LOG_FILE"
  else
    echo "cargo log: $LOG_FILE"
  fi
}
trap cleanup EXIT

cargo_args=(test -p awg-clients paging -- --ignored --nocapture)
if [[ "$PROFILE" == "release" ]]; then
  cargo_args=(test --release -p awg-clients paging -- --ignored --nocapture)
fi

echo "running: cargo ${cargo_args[*]}"
echo "mode: $PROFILE, budget: ${THRESHOLD_MS} ms"
echo ""

set +e
(cd "$ROOT_DIR" && cargo "${cargo_args[@]}") 2>&1 | tee "$LOG_FILE"
cargo_status=${PIPESTATUS[0]}
set -e

if (( cargo_status != 0 )); then
  echo "error: benchmark failed with exit code $cargo_status" >&2
  exit "$cargo_status"
fi

LINE="$(grep -E '^devices=10000 ' "$LOG_FILE" | tail -n 1 || true)"
if [[ -z "$LINE" ]]; then
  echo "error: could not find the 10k device benchmark output in the cargo log" >&2
  echo "expected a line starting with \"devices=10000 \"" >&2
  exit 1
fi

PAGE_RAW="$(grep -oP '\(9950,\s*\K[0-9.]+(?:ns|µs|ms|s)' <<< "$LINE" | head -n 1 || true)"
if [[ -z "$PAGE_RAW" ]]; then
  echo "error: could not parse the last 10k page timing from: $LINE" >&2
  exit 1
fi

VALUE="${PAGE_RAW%%[^0-9.]*}"
UNIT="${PAGE_RAW#"$VALUE"}"

case "$UNIT" in
  ns) PAGE_MS="$(awk -v v="$VALUE" 'BEGIN { printf "%.6f", v / 1000000 }')" ;;
  µs) PAGE_MS="$(awk -v v="$VALUE" 'BEGIN { printf "%.6f", v / 1000 }')" ;;
  ms) PAGE_MS="$VALUE" ;;
  s) PAGE_MS="$(awk -v v="$VALUE" 'BEGIN { printf "%.6f", v * 1000 }')" ;;
  *) echo "error: unknown duration unit \"$UNIT\" in $PAGE_RAW" >&2; exit 1 ;;
esac

FILTERED_RAW="$(grep -oP 'filtered=\K[0-9.]+(?:ns|µs|ms|s)' <<< "$LINE" | head -n 1 || true)"
echo ""
echo "benchmark line: $LINE"
echo "10k last page (offset 9950): $PAGE_RAW (${PAGE_MS} ms)"
if [[ -n "$FILTERED_RAW" ]]; then
  echo "10k filtered page: $FILTERED_RAW"
fi
echo "budget: ${THRESHOLD_MS} ms"

if ! awk -v actual="$PAGE_MS" -v limit="$THRESHOLD_MS" 'BEGIN { exit !(actual <= limit) }'; then
  echo "error: 10k page took ${PAGE_MS} ms, exceeding the ${THRESHOLD_MS} ms budget" >&2
  exit 1
fi

echo "Backend performance budget passed."
