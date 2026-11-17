#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly SCRIPT_DIR REPO_ROOT

URL="${AWG_PUBLIC_URL:-https://panel.localhost}"
HTTP_URL=""
CACERT=""
SELF_SIGNED=0
STATIC=0
NO_STATIC=0
LOCAL=0
HSTS_CHECK=1
TIMEOUT=10
LOCAL_HTTP_PORT=8088
LOCAL_HTTPS_PORT=8443
TRAEFIK_IMAGE="traefik:v3.3"
FAILED=0
WARNED=0
SKIPPED=0
WORKDIR=""
CONTAINER=""

usage() {
  cat <<'EOF'
Проверка TLS/ACME, HTTP/2, HTTP/3 и health (production-блокер №5).

Использование:
  scripts/verify-tls.sh                            # проверка https://panel.localhost (или AWG_PUBLIC_URL)
  scripts/verify-tls.sh --url https://panel.example.org
  scripts/verify-tls.sh --static                   # только аудит docker/traefik.yml и docker-compose.yml
  scripts/verify-tls.sh --local                    # Traefik с self-signed на localhost, без домена
  scripts/verify-tls.sh --local --no-hsts-check

Опции:
  --url URL            базовый HTTPS URL (по умолчанию $AWG_PUBLIC_URL или https://panel.localhost)
  --http-url URL       URL для проверки редиректа (по умолчанию http://<host>)
  --cacert FILE        CA для проверки самоподписанного сертификата
  --self-signed        не проверять цепочку сертификата curl-ом (данные всё равно печатаются)
  --static             только статический аудит конфигурации Traefik/compose
  --no-static          пропустить статический аудит (для --local/--url)
  --local              поднять Traefik с self-signed сертификатом и проверить его
  --no-hsts-check      не считать отсутствие HSTS ошибкой
  --timeout SEC        таймаут curl (по умолчанию 10)
  --local-http-port N  порт HTTP в --local (по умолчанию 8088)
  --local-https-port N порт HTTPS в --local (по умолчанию 8443)
  -h, --help           эта справка

--local требует docker и образ traefik; поднимает контейнер с --network host на
портах 8088/tcp, 8443/tcp, 8443/udp, проверяет редирект, HTTP/2, TLS, HTTP/3.
Backend http://127.0.0.1:8080 (admin) опционален: без него health пропускается.
HSTS задаётся в labels compose (middleware frontend-hsts и admin-api-sec); при
проверке контейнера без этих labels используйте --no-hsts-check.
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

cleanup() {
  if [ -n "$CONTAINER" ] && have docker; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --url)
        [ $# -ge 2 ] || die "--url требует значение"
        URL="$2"
        shift
        ;;
      --http-url)
        [ $# -ge 2 ] || die "--http-url требует значение"
        HTTP_URL="$2"
        shift
        ;;
      --cacert)
        [ $# -ge 2 ] || die "--cacert требует файл"
        CACERT="$2"
        shift
        ;;
      --self-signed) SELF_SIGNED=1 ;;
      --static) STATIC=1 ;;
      --no-static) NO_STATIC=1 ;;
      --local) LOCAL=1 ;;
      --no-hsts-check) HSTS_CHECK=0 ;;
      --timeout)
        [ $# -ge 2 ] || die "--timeout требует значение"
        TIMEOUT="$2"
        shift
        ;;
      --local-http-port)
        [ $# -ge 2 ] || die "--local-http-port требует значение"
        LOCAL_HTTP_PORT="$2"
        shift
        ;;
      --local-https-port)
        [ $# -ge 2 ] || die "--local-https-port требует значение"
        LOCAL_HTTPS_PORT="$2"
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

  URL="${URL%/}"
  case "$URL" in
    https://*) ;;
    *) die "нужен https URL, получено: $URL" ;;
  esac
}

url_host() {
  local base="$1" rest authority
  rest="${base#*://}"
  authority="${rest%%/*}"
  printf '%s' "${authority%%:*}"
}

url_port() {
  local base="$1" rest authority
  rest="${base#*://}"
  authority="${rest%%/*}"
  if [ "$authority" = "${authority%%:*}" ]; then
    printf '443'
  else
    printf '%s' "${authority##*:}"
  fi
}

default_http_url() {
  local host
  host=$(url_host "$URL")
  printf 'http://%s/' "$host"
}

static_checks() {
  section "Статика: docker/traefik.yml и docker-compose.yml"

  local traefik="$REPO_ROOT/docker/traefik.yml"
  local compose="$REPO_ROOT/docker-compose.yml"

  if [ ! -f "$traefik" ]; then
    fail "нет $traefik"
    return
  fi
  if [ ! -f "$compose" ]; then
    fail "нет $compose"
    return
  fi

  if grep -q 'http3:' "$traefik"; then
    ok "websecure: http3 включён"
  else
    fail "websecure: http3 не включён"
  fi

  if grep -q 'to: websecure' "$traefik" && grep -q 'permanent: true' "$traefik" && grep -q 'scheme: https' "$traefik"; then
    ok "редирект web -> websecure (301, https)"
  else
    fail "редирект web -> websecure не настроен"
  fi

  if grep -q 'certificatesResolvers:' "$traefik" && grep -q 'letsencrypt:' "$traefik" && grep -q 'tlsChallenge:' "$traefik"; then
    ok "ACME: резолвер letsencrypt с TLS-ALPN-01"
  else
    fail "ACME: резолвер letsencrypt не настроен"
  fi

  if grep -q 'storage: "/letsencrypt/acme.json"' "$traefik"; then
    ok "ACME storage: /letsencrypt/acme.json"
  else
    warn "ACME storage не /letsencrypt/acme.json"
  fi

  if grep -q '"443:443/tcp"' "$compose"; then
    ok "compose публикует 443/tcp"
  else
    fail "compose не публикует 443/tcp"
  fi
  if grep -q '"443:443/udp"' "$compose"; then
    ok "compose публикует 443/udp (HTTP/3)"
  else
    fail "compose не публикует 443/udp (HTTP/3 не заработает)"
  fi
  if grep -q 'address: ":80"' "$traefik"; then
    ok "traefik: entrypoint web слушает :80 (редирект для локальной проверки)"
  else
    fail "traefik: entrypoint web не слушает :80"
  fi

  if grep -qi 'certresolver=letsencrypt' "$compose"; then
    ok "labels: tls.certresolver=letsencrypt"
  else
    fail "labels: tls.certresolver=letsencrypt отсутствует"
  fi

  if grep -q 'Host(' "$compose"; then
    ok "в правилах роутеров есть Host(...): ACME знает, на какие домены выпускать сертификат"
  else
    fail "в правилах роутеров нет Host(...): ACME не выпустит сертификат на домен"
  fi

  if grep -qi 'serverstransport=h2c' "$compose"; then
    ok "labels: serversTransport h2c для admin"
  else
    warn "labels: serversTransport h2c не найден (backend пойдёт по HTTP/1.1; на TLS не влияет)"
  fi

  if grep -qiE 'strict-transport-security|stsSeconds|stsIncludeSubdomains' "$traefik" "$compose"; then
    ok "HSTS задан в конфигурации"
  else
    warn "HSTS (Strict-Transport-Security) не задан ни в traefik.yml, ни в labels"
  fi

  if grep -qi 'awg_domain' "$compose"; then
    ok "AWG_DOMAIN используется в compose"
  else
    warn "AWG_DOMAIN есть в .env.example, но не используется в compose (роутеры на PathPrefix)"
  fi
}

curl_base_args() {
  CURL_ARGS=(-sS --max-time "$TIMEOUT")
  if [ -n "$CACERT" ]; then
    [ -f "$CACERT" ] || die "нет файла CA: $CACERT"
    CURL_ARGS+=(--cacert "$CACERT")
  elif [ "$SELF_SIGNED" -eq 1 ]; then
    CURL_ARGS+=(-k)
  fi
}

check_redirect() {
  local http_url="$1"
  local code location
  code=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{http_code}' "$http_url" 2>/dev/null || true)
  if [ "$code" = "301" ] || [ "$code" = "308" ]; then
    ok "http -> https: код $code"
  else
    fail "http -> https: ожидался 301/308, получено ${code:-нет ответа}"
    return
  fi
  location=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{redirect_url}' "$http_url" 2>/dev/null || true)
  case "$location" in
    https://*) ok "редирект ведёт на $location" ;;
    *) fail "редирект не на https: ${location:-пусто}" ;;
  esac
}

check_http2() {
  local version
  version=$(curl "${CURL_ARGS[@]}" --http2 -o /dev/null -w '%{http_version}' "$URL/" 2>/dev/null || true)
  if [ "$version" = "2" ]; then
    ok "HTTP/2 по TLS (ALPN h2)"
  else
    fail "HTTP/2 не согласован (http_version=${version:-нет ответа})"
  fi
}

check_certificate() {
  local host port cert
  host=$(url_host "$URL")
  port=$(url_port "$URL")
  cert="$WORKDIR/cert.pem"

  if ! have openssl; then
    skip "нет openssl: сертификат не разобран"
    return
  fi

  if ! openssl s_client -connect "$host:$port" -servername "$host" </dev/null 2>/dev/null \
    | openssl x509 -outform PEM > "$cert" 2>/dev/null; then
    fail "не удалось получить сертификат с $host:$port"
    return
  fi

  ok "сертификат получен"
  note "$(openssl x509 -in "$cert" -noout -subject)"

  local issuer
  issuer=$(openssl x509 -in "$cert" -noout -issuer)
  note "$issuer"
  if [ "$SELF_SIGNED" -eq 0 ] && [ -z "$CACERT" ]; then
    if printf '%s' "$issuer" | grep -qi "let's encrypt"; then
      ok "issuer: Let's Encrypt"
    else
      warn "issuer не Let's Encrypt — для production ожидается ACME-сертификат"
    fi
  fi

  if openssl x509 -in "$cert" -noout -checkend 0 >/dev/null 2>&1; then
    ok "срок действия не истёк"
  else
    fail "сертификат истёк"
  fi
  if openssl x509 -in "$cert" -noout -checkend 604800 >/dev/null 2>&1; then
    ok "до истечения больше 7 дней"
  else
    warn "сертификат истекает в течение 7 дней"
  fi

  if [ "$SELF_SIGNED" -eq 0 ] && [ -z "$CACERT" ]; then
    local code
    code=$(curl "${CURL_ARGS[@]}" -o /dev/null -w '%{http_code}' "$URL/" 2>/dev/null || true)
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      ok "цепочка сертификата доверенная (curl без -k)"
    else
      fail "curl не доверяет сертификату"
    fi
  else
    if [ -n "$CACERT" ]; then
      if openssl verify -CAfile "$CACERT" "$cert" >/dev/null 2>&1; then
        ok "цепочка проверена по $CACERT"
      else
        fail "сертификат не проходит проверку по $CACERT"
      fi
    else
      note "цепочка не проверяется (--self-signed)"
    fi
  fi

  if openssl x509 -in "$cert" -noout -checkhost "$host" >/dev/null 2>&1 \
    || openssl x509 -in "$cert" -noout -checkip "$host" >/dev/null 2>&1; then
    ok "сертификат выписан на $host"
  else
    warn "SAN/CN не содержит $host"
  fi
}

check_hsts() {
  local headers
  headers=$(curl "${CURL_ARGS[@]}" -sSI "$URL/" 2>/dev/null || true)

  if printf '%s\n' "$headers" | grep -qi '^alt-svc:.*h3'; then
    ok "Alt-Svc анонсирует HTTP/3"
  else
    warn "Alt-Svc без h3: клиенты не узнают про HTTP/3"
  fi

  if [ "$HSTS_CHECK" -eq 0 ]; then
    skip "проверка HSTS отключена (--no-hsts-check)"
    return
  fi
  if printf '%s\n' "$headers" | grep -qi '^strict-transport-security:'; then
    if printf '%s\n' "$headers" | grep -qi 'strict-transport-security:.*max-age='; then
      ok "HSTS присутствует с max-age"
    else
      fail "HSTS есть, но без max-age"
    fi
  else
    fail "HSTS отсутствует (Strict-Transport-Security не отдаётся)"
  fi
}

check_health() {
  local skip_health="$1" body
  if [ "$skip_health" -eq 1 ]; then
    skip "health пропущен: backend admin не отвечает на 127.0.0.1:8080"
    return
  fi
  if ! body=$(curl "${CURL_ARGS[@]}" -fsS "$URL/api/v1/health" 2>/dev/null); then
    fail "GET $URL/api/v1/health недоступен"
    return
  fi
  if printf '%s' "$body" | grep -q '"status":"ok"'; then
    ok "/api/v1/health: status ok"
  else
    fail "/api/v1/health вернул неожиданный ответ: $body"
  fi
}

check_http3() {
  if ! curl -V 2>/dev/null | grep -q 'HTTP3'; then
    skip "curl собран без HTTP/3 (curl -V без HTTP3); проверьте HTTP/3 другим клиентом"
    return
  fi

  local version
  if version=$(curl "${CURL_ARGS[@]}" --http3-only -o /dev/null -w '%{http_version}' "$URL/" 2>/dev/null); then
    if [ "$version" = "3" ]; then
      ok "HTTP/3 по QUIC (http_version=3)"
    else
      fail "HTTP/3 не согласован (http_version=$version)"
    fi
  else
    fail "curl --http3-only не смог подключиться (UDP 443/udp закрыт или h3 выключен)"
  fi
}

check_http3_warning() {
  if ! curl -V 2>/dev/null | grep -q 'HTTP3'; then
    note "curl без HTTP/3: блокер HTTP/3 проверяется клиентом с ngtcp2/nghttp3"
  fi
}

run_live_checks() {
  local http_url="$1" skip_health="$2"
  curl_base_args

  section "Редирект HTTP -> HTTPS"
  check_redirect "$http_url"

  section "TLS и HTTP/2"
  check_http2
  check_certificate

  section "Заголовки безопасности"
  check_hsts

  section "Health"
  check_health "$skip_health"

  section "HTTP/3"
  check_http3
  check_http3_warning
}

generate_local_certs() {
  local certs="$WORKDIR/certs"
  mkdir -p "$certs"
  openssl req -x509 -newkey rsa:2048 -nodes -days 14 \
    -keyout "$certs/ca.key" -out "$certs/ca.crt" \
    -subj "/CN=awg-verify-local-ca" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$certs/server.key" -out "$certs/server.csr" \
    -subj "/CN=localhost" >/dev/null 2>&1
  printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$certs/ext.cnf"
  openssl x509 -req -in "$certs/server.csr" -CA "$certs/ca.crt" -CAkey "$certs/ca.key" \
    -CAcreateserial -out "$certs/server.crt" -days 14 -extfile "$certs/ext.cnf" >/dev/null 2>&1
}

write_local_configs() {
  local dir="$WORKDIR/traefik"
  mkdir -p "$dir"
  cat > "$dir/traefik.local.yml" <<EOF
entryPoints:
  web:
    address: ":$LOCAL_HTTP_PORT"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":$LOCAL_HTTPS_PORT"
    http3: {}
    http:
      tls: {}
providers:
  file:
    filename: /etc/traefik/dynamic.local.yml
EOF

  cat > "$dir/dynamic.local.yml" <<'EOF'
http:
  routers:
    local:
      rule: "Host(`localhost`)"
      entryPoints: ["websecure"]
      service: backend
      tls: {}
  services:
    backend:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:8080"
tls:
  certificates:
    - certFile: /certs/server.crt
      keyFile: /certs/server.key
EOF
}

run_local() {
  have docker || die "--local требует docker"
  have openssl || die "--local требует openssl"
  docker info >/dev/null 2>&1 || die "docker daemon недоступен"

  if ! docker image inspect "$TRAEFIK_IMAGE" >/dev/null 2>&1; then
    note "образ $TRAEFIK_IMAGE отсутствует, скачиваю"
    docker pull "$TRAEFIK_IMAGE" >/dev/null || die "не удалось скачать $TRAEFIK_IMAGE"
  fi

  generate_local_certs
  write_local_configs
  CONTAINER="awg-verify-traefik-$$"
  section "Запуск Traefik с self-signed"
  if ! docker run --rm -d --name "$CONTAINER" --network host \
    -v "$WORKDIR/traefik:/etc/traefik:ro" \
    -v "$WORKDIR/certs:/certs:ro" \
    "$TRAEFIK_IMAGE" --configFile=/etc/traefik/traefik.local.yml >/dev/null 2>"$WORKDIR/docker.err"; then
    fail "не удалось запустить контейнер Traefik: $(cat "$WORKDIR/docker.err")"
    return
  fi

  local attempt=0 up=0
  while [ "$attempt" -lt 30 ]; do
    if curl -sk -o /dev/null --max-time 2 "https://localhost:$LOCAL_HTTPS_PORT/" 2>/dev/null; then
      up=1
      break
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done
  if [ "$up" -ne 1 ]; then
    fail "Traefik не поднялся на https://localhost:$LOCAL_HTTPS_PORT"
    docker logs "$CONTAINER" 2>&1 | tail -n 20 | sed 's/^/    /' || true
    return
  fi
  ok "Traefik слушает https://localhost:$LOCAL_HTTPS_PORT (h3: udp/$LOCAL_HTTPS_PORT)"

  URL="https://localhost:$LOCAL_HTTPS_PORT"
  CACERT="$WORKDIR/certs/ca.crt"
  SELF_SIGNED=0

  local skip_health=0
  if ! curl -fsS --max-time 2 http://127.0.0.1:8080/api/v1/health >/dev/null 2>&1; then
    skip_health=1
  fi

  local failed_before="$FAILED"
  if [ "$NO_STATIC" -eq 0 ]; then
    static_checks
  fi
  run_live_checks "http://localhost:$LOCAL_HTTP_PORT/" "$skip_health"
  if [ "$FAILED" -gt "$failed_before" ]; then
    section "Логи Traefik (для диагностики)"
    docker logs "$CONTAINER" 2>&1 | tail -n 25 | sed 's/^/    /' || true
  fi
}

main() {
  parse_args "$@"
  WORKDIR=$(mktemp -d)
  trap cleanup EXIT

  if [ "$LOCAL" -eq 1 ]; then
    run_local
  elif [ "$STATIC" -eq 1 ]; then
    static_checks
  else
    if [ -z "$HTTP_URL" ]; then
      HTTP_URL=$(default_http_url)
    fi
    if [ "$NO_STATIC" -eq 0 ]; then
      static_checks
    fi
    run_live_checks "$HTTP_URL" 0
  fi

  section "Итог"
  printf '  провалено: %s, предупреждений: %s, пропущено: %s\n' "$FAILED" "$WARNED" "$SKIPPED"
  if [ "$FAILED" -gt 0 ]; then
    exit 1
  fi
  ok "проверка завершена без ошибок"
}

main "$@"
