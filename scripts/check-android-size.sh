#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"

MODE="auto"
BUILD=1
ARM64_LIMIT_MIB=12
UNIVERSAL_LIMIT_MIB=95

usage() {
  cat <<'EOF'
Usage: scripts/check-android-size.sh [options]

Builds the fdroid APK and checks its size.

Modes:
  auto      release when the signing environment is complete, debug otherwise (default)
  release   assembleFdroidRelease, checks the arm64 split
  debug     assembleFdroidDebug, checks the universal debug APK

Options:
  --mode=<auto|release|debug>   build mode (default: auto)
  --no-build                    only measure APKs that already exist
  --arm64-limit-mib=<MiB>       release arm64 budget (default: 12)
  --universal-limit-mib=<MiB>   universal debug budget (default: 95)
  -h, --help                    show this help

Release signing requires KEY_STORE_PATH, SIGNING_STORE_PASSWORD,
SIGNING_KEY_ALIAS and SIGNING_KEY_PASSWORD to be set. Without them the
script falls back to the debug build instead of failing.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --mode=*) MODE="${arg#*=}" ;;
    --no-build) BUILD=0 ;;
    --arm64-limit-mib=*) ARM64_LIMIT_MIB="${arg#*=}" ;;
    --universal-limit-mib=*) UNIVERSAL_LIMIT_MIB="${arg#*=}" ;;
    *) echo "error: unknown option \"$arg\" (try --help)" >&2; exit 2 ;;
  esac
done

case "$MODE" in
  auto|release|debug) ;;
  *) echo "error: --mode must be auto, release or debug, got \"$MODE\"" >&2; exit 2 ;;
esac

if ! command -v java >/dev/null 2>&1; then
  echo "error: java not found: install JDK 21" >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f "$ANDROID_DIR/local.properties" ]]; then
  for candidate in "$HOME/android-sdk" "/opt/android-sdk"; do
    if [[ -d "$candidate" ]]; then
      export ANDROID_HOME="$candidate"
      export ANDROID_SDK_ROOT="$candidate"
      break
    fi
  done
fi

signing_ready() {
  [[ -n "${KEY_STORE_PATH:-}" && -f "${KEY_STORE_PATH}" ]] &&
    [[ -n "${SIGNING_STORE_PASSWORD:-}" ]] &&
    [[ -n "${SIGNING_KEY_ALIAS:-}" ]] &&
    [[ -n "${SIGNING_KEY_PASSWORD:-}" ]]
}

if [[ "$MODE" == "auto" ]]; then
  if signing_ready; then
    MODE="release"
  else
    MODE="debug"
    echo "note: release signing is not configured, checking the debug universal APK"
  fi
fi

if [[ "$MODE" == "release" ]] && ! signing_ready; then
  echo "error: release mode requires KEY_STORE_PATH, SIGNING_STORE_PASSWORD, SIGNING_KEY_ALIAS and SIGNING_KEY_PASSWORD" >&2
  exit 2
fi

size_mib() {
  awk -v bytes="$1" 'BEGIN { printf "%.1f", bytes / 1048576 }'
}

size_bytes() {
  wc -c < "$1" | tr -d '[:space:]'
}

APK_DIR=""
APK_PATH=""
LABEL=""
LIMIT_MIB=""

if [[ "$MODE" == "release" ]]; then
  APK_DIR="$ANDROID_DIR/app/build/outputs/apk/fdroid/release"
  LABEL="release arm64"
  LIMIT_MIB="$ARM64_LIMIT_MIB"
  if (( BUILD )); then
    echo "building :app:assembleFdroidRelease"
    (cd "$ANDROID_DIR" && ./gradlew :app:assembleFdroidRelease)
  fi
  APK_PATH="$(find "$APK_DIR" -maxdepth 1 -type f -name '*arm64*.apk' | sort | head -n 1)"
else
  APK_DIR="$ANDROID_DIR/app/build/outputs/apk/fdroid/debug"
  LABEL="debug universal"
  LIMIT_MIB="$UNIVERSAL_LIMIT_MIB"
  if (( BUILD )); then
    echo "building :app:assembleFdroidDebug"
    (cd "$ANDROID_DIR" && ./gradlew :app:assembleFdroidDebug)
  fi
  APK_PATH="$(find "$APK_DIR" -maxdepth 1 -type f -name '*.apk' \
    ! -name '*-arm64*.apk' ! -name '*-armv7*.apk' ! -name '*-x86*.apk' ! -name '*-x64*.apk' \
    | sort | head -n 1)"
fi

if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  echo "error: no APK found in $APK_DIR; run without --no-build or build it first" >&2
  if [[ -d "$APK_DIR" ]]; then
    find "$APK_DIR" -maxdepth 1 -type f -name '*.apk' -print >&2 || true
  fi
  exit 1
fi

echo "APK sizes in $APK_DIR:"
while IFS= read -r apk; do
  [[ -n "$apk" ]] || continue
  echo "  $(size_mib "$(size_bytes "$apk")") MiB  $(basename "$apk")"
done < <(find "$APK_DIR" -maxdepth 1 -type f -name '*.apk' | sort)

ACTUAL_BYTES="$(size_bytes "$APK_PATH")"
ACTUAL_MIB="$(size_mib "$ACTUAL_BYTES")"

echo ""
echo "$LABEL: $ACTUAL_MIB MiB ($ACTUAL_BYTES bytes) / $LIMIT_MIB MiB budget"

if ! awk -v actual="$ACTUAL_BYTES" -v limit="$LIMIT_MIB" 'BEGIN { exit !(actual <= limit * 1048576) }'; then
  echo "error: $LABEL exceeds the $LIMIT_MIB MiB budget by $(awk -v a="$ACTUAL_BYTES" -v l="$LIMIT_MIB" 'BEGIN { printf "%.1f", a / 1048576 - l }') MiB" >&2
  exit 1
fi

echo "Android size budget passed."
