# Frontend security requirements

## CSP and WebSocket

- SPA and API are served from the same origin; `HttpTransport` uses the relative base URL `/api/v1`.
- The live statistics socket always targets the same origin: the client asks the backend for a
  short-lived ticket (`POST /api/v1/ws/ticket`, normal `Authorization: Bearer` header), then connects to
  `wss://<current-host>/api/v1/ws/stats?ticket=<ticket>` (or `ws:` on plain HTTP). The access token is
  never placed in the WebSocket query string; the ticket is single-use and lives 30 seconds.
- Cross-origin WebSocket endpoints are not used. Production nginx therefore restricts connections to
  the same origin, and the actual header is:

  ```
  Content-Security-Policy: ... connect-src 'self'; ...
  ```

  `docker/nginx-headers.conf` already ships `connect-src 'self'`; `ws:`/`wss:` scheme sources are not
  needed because CSP Level 3 treats `'self'` as covering same-host WebSocket schemes. The frontend itself
  has no cross-origin connection code. The backend still accepts the legacy `?token=` flow only when
  `AWG_ALLOW_WS_TOKEN=true`; the SPA does not use it.

## Backend CORS

The backend is a separate service. It lists explicit origins (scheme + host + port) allowed to call the
API and does not use `*`: an empty `AWG_CORS_ORIGINS` rejects cross-origin browser requests, and a
wildcard in the list is a startup error. Because the frontend keeps access and refresh tokens in
`localStorage` and sends them as `Authorization` headers, cookies are not required for API calls; moving
tokens to `HttpOnly` cookies requires a coordinated backend change and is tracked as a separate task.

## Token storage

Tokens currently live in `localStorage` (`awg.access`, `awg.refresh`). All reads and writes are wrapped
in `try/catch` so private-mode or sandboxed iframes cannot break application boot. The access token is
attached as a Bearer header by the auth interceptor; a `401` triggers a single-flight refresh and one
retry, and a failed refresh clears the session. `logout` and `logout-all` clear the local pair; the
backend additionally revokes refresh sessions, and `logout-all`, password changes and account blocks
raise the per-user access epoch, so previously issued access tokens stop working before their TTL.
Storing tokens in `HttpOnly; Secure; SameSite` cookies would eliminate XSS token theft and is the
preferred long-term fix, but it cannot be delivered from the frontend alone.
