# Frontend security requirements

## CSP and WebSocket

- SPA and API are served from the same origin; `HttpTransport` uses the relative base URL `/api/v1`.
- The live statistics socket is built from `window.location.host`, so it always targets the same origin:
  `wss://<current-host>/api/v1/ws/stats`. Cross-origin WebSocket endpoints are not used.
- Production nginx should therefore restrict connections to the same origin:

  ```
  Content-Security-Policy: ... connect-src 'self'; ...
  ```

  The current `docker/nginx-headers.conf` still allows `connect-src 'self' ws: wss:`. The broader
  `ws: wss:` scheme sources must be removed outside this package; the frontend itself has no
  cross-origin connection code.

## Backend CORS

The backend is a separate service. It must list explicit origins (scheme + host + port) allowed to
call the API and must not use `*` together with credentials. Because the frontend keeps access and
refresh tokens in `localStorage` and sends them as `Authorization` headers, cookies are not
required for API calls; moving tokens to `HttpOnly` cookies requires a coordinated backend change
and is tracked as a separate task.

## Token storage

Tokens currently live in `localStorage` (`awg.access`, `awg.refresh`). All reads and writes are
wrapped in `try/catch` so private-mode or sandboxed iframes cannot break application boot. Storing
tokens in `HttpOnly; Secure; SameSite` cookies would eliminate XSS token theft and is the preferred
long-term fix, but it cannot be delivered from the frontend alone.
