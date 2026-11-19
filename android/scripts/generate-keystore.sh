#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { printf '%s\n' "$*" >&2; }
die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

command -v keytool >/dev/null 2>&1 || die "keytool not found: install JDK 21 and add it to PATH"

KEY_STORE_PATH="${KEY_STORE_PATH:-${ANDROID_KEYSTORE_PATH:-keystore/umbravpn-release.jks}}"
if [[ "$KEY_STORE_PATH" != /* ]]; then
    KEY_STORE_PATH="$ANDROID_DIR/$KEY_STORE_PATH"
fi
KEY_STORE_TYPE="${KEY_STORE_TYPE:-PKCS12}"
KEY_ALIAS="${SIGNING_KEY_ALIAS:-${ANDROID_KEY_ALIAS:-umbravpn}}"
STORE_PASSWORD="${SIGNING_STORE_PASSWORD:-${ANDROID_KEYSTORE_PASSWORD:-}}"
KEY_PASSWORD="${SIGNING_KEY_PASSWORD:-${ANDROID_KEY_PASSWORD:-}}"
KEY_SIZE="${KEY_SIZE:-4096}"
VALIDITY_DAYS="${VALIDITY_DAYS:-10000}"
DNAME="${DNAME:-CN=Umbra VPN, OU=Android, O=Umbra VPN, C=RU}"
FORCE="${FORCE:-0}"
PRINT_BASE64="${PRINT_BASE64:-0}"

case "$KEY_STORE_TYPE" in
    PKCS12 | JKS) ;;
    *) die "KEY_STORE_TYPE must be PKCS12 or JKS, got $KEY_STORE_TYPE" ;;
esac

read_secret() {
    local prompt="$1" value
    read -r -s -p "$prompt: " value
    printf '\n' >&2
    printf '%s' "$value"
}

if [[ -z "$STORE_PASSWORD" ]]; then
    [[ -t 0 ]] || die "SIGNING_STORE_PASSWORD is empty and stdin is not a terminal"
    STORE_PASSWORD="$(read_secret "Store password")"
    CONFIRM_PASSWORD="$(read_secret "Repeat store password")"
    [[ "$STORE_PASSWORD" == "$CONFIRM_PASSWORD" ]] || die "passwords do not match"
    unset CONFIRM_PASSWORD
fi
[[ ${#STORE_PASSWORD} -ge 6 ]] || die "store password must be at least 6 characters"

if [[ -z "$KEY_PASSWORD" ]]; then
    if [[ -t 0 ]]; then
        read -r -s -p "Key password (Enter = store password): " KEY_PASSWORD || true
        printf '\n' >&2
    fi
    [[ -n "$KEY_PASSWORD" ]] || KEY_PASSWORD="$STORE_PASSWORD"
fi

if [[ "$KEY_STORE_TYPE" == "PKCS12" && "$KEY_PASSWORD" != "$STORE_PASSWORD" ]]; then
    die "PKCS12 requires one password for the store and the key; use KEY_STORE_TYPE=JKS for different passwords"
fi

if [[ -e "$KEY_STORE_PATH" && "$FORCE" != "1" ]]; then
    die "keystore already exists: $KEY_STORE_PATH (set FORCE=1 to overwrite)"
fi

mkdir -p "$(dirname "$KEY_STORE_PATH")"
chmod 700 "$(dirname "$KEY_STORE_PATH")"

keytool -genkeypair \
    -keystore "$KEY_STORE_PATH" \
    -storetype "$KEY_STORE_TYPE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize "$KEY_SIZE" \
    -sigalg SHA256withRSA \
    -validity "$VALIDITY_DAYS" \
    -dname "$DNAME" \
    -storepass "$STORE_PASSWORD" \
    -keypass "$KEY_PASSWORD" \
    -noprompt

chmod 600 "$KEY_STORE_PATH"

log "Keystore created: $KEY_STORE_PATH"
log "Alias: $KEY_ALIAS"
log "Type: $KEY_STORE_TYPE, key: RSA $KEY_SIZE bit, validity: $VALIDITY_DAYS days"
keytool -list -v \
    -keystore "$KEY_STORE_PATH" \
    -storepass "$STORE_PASSWORD" \
    -alias "$KEY_ALIAS" 2>/dev/null |
    sed -nE '/Alias name|Creation date|Valid from|SHA256:/p' || true

log ""
log "Local use (android/local.properties, never commit it):"
log "  KEY_STORE_PATH=$KEY_STORE_PATH"
log "  SIGNING_STORE_PASSWORD=<store password>"
log "  SIGNING_KEY_ALIAS=$KEY_ALIAS"
log "  SIGNING_KEY_PASSWORD=<key password>"

if [[ "$PRINT_BASE64" == "1" ]]; then
    base64 -w0 "$KEY_STORE_PATH"
    printf '\n'
else
    log ""
    log "Base64 for the GitHub secret ANDROID_KEYSTORE_BASE64:"
    log "  base64 -w0 \"$KEY_STORE_PATH\""
    log "On macOS use: base64 -i \"$KEY_STORE_PATH\" | tr -d '\\n'"
fi
