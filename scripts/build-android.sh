#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
TASK="${1:-:app:assembleFdroidDebug}"

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f "$ANDROID_DIR/local.properties" ]]; then
  for candidate in "$HOME/android-sdk" "/opt/android-sdk"; do
    if [[ -d "$candidate" ]]; then
      export ANDROID_HOME="$candidate"
      export ANDROID_SDK_ROOT="$candidate"
      break
    fi
  done
fi

if ! command -v java >/dev/null 2>&1; then
  echo "java not found: install JDK 21" >&2
  exit 1
fi

cd "$ANDROID_DIR"
./gradlew "$TASK" "${@:2}"

case "$TASK" in
  *assemble*)
    find app/build/outputs/apk -name "*.apk" -maxdepth 4 -print
    ;;
esac
