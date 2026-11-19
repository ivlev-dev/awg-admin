import type { AuthSessionState } from "@/application/auth/session-state";
import type { AuthSession } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { AuthRequestInterceptor } from "@/infrastructure/http/auth-request.interceptor";
import { AuthResponseInterceptor } from "@/infrastructure/http/auth-response.interceptor";
import { HttpAuthRepository } from "@/infrastructure/http/auth.repository";
import { HttpClient } from "@/infrastructure/http/client";
import { createIdempotencyKey } from "@/infrastructure/http/idempotency";
import { InterceptorRegistry } from "@/infrastructure/http/interceptor-registry";
import { HttpTransport } from "@/infrastructure/http/transport";

interface MemoryTokens extends TokenStore {
  current: { access: string | null; refresh: string | null };
}

function memoryTokens(access: string | null, refresh: string | null): MemoryTokens {
  const state: { access: string | null; refresh: string | null } = { access, refresh };
  return {
    current: state,
    access: () => state.access,
    refresh: () => state.refresh,
    set: (nextAccess, nextRefresh) => {
      state.access = nextAccess;
      state.refresh = nextRefresh;
    },
    clear: () => {
      state.access = null;
      state.refresh = null;
    },
  };
}

function mockResponse(status: number, body?: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body ?? null),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
}

const SESSION: AuthSession = {
  token: "new-access",
  refresh_token: "new-refresh",
  expires_in: 3600,
  user: {
    id: "u1",
    full_name: null,
    role: "admin",
    tariff_id: null,
    group_id: null,
    email: "user@example.com",
    status: "active",
    totp_enabled: false,
    disabled: false,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  },
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Harness {
  client: HttpClient;
  tokens: MemoryTokens;
}

function harness(tokens: MemoryTokens): Harness {
  const transport = new HttpTransport({ baseUrl: "/api/v1", timeoutMs: 1_000 });
  const auth = new HttpAuthRepository(transport, tokens);
  const session: AuthSessionState = { clear: vi.fn() };
  const registry = new InterceptorRegistry(
    new AuthRequestInterceptor(tokens),
    new AuthResponseInterceptor(auth, tokens, session),
  );
  return { client: new HttpClient(transport, registry), tokens };
}

function installFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(handler);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers as Record<string, string> | undefined) ?? {};
}

function methodOf(init: RequestInit | undefined): string | undefined {
  return init?.method;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpClient Idempotency-Key", () => {
  it("adds a valid UUID v4 header to POST requests", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, { ok: true }));

    await client.post("/users", { email: "user@example.com" });

    const key = headersOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)[
      "Idempotency-Key"
    ];
    expect(key).toMatch(UUID_V4);
  });

  it("generates a separate key for each POST request", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, { ok: true }));

    await client.post("/users", { email: "first@example.com" });
    await client.post("/users", { email: "second@example.com" });

    const first = headersOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)[
      "Idempotency-Key"
    ];
    const second = headersOf(fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)[
      "Idempotency-Key"
    ];
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  it("keeps the same key after a 401 refresh retry", async () => {
    const { client, tokens } = harness(memoryTokens("old-access", "old-refresh"));
    const attemptKeys: string[] = [];
    let usersCalls = 0;
    const fetchMock = installFetch(async (url, init) => {
      if (url === "/api/v1/users" && methodOf(init) === "POST") {
        usersCalls += 1;
        attemptKeys.push(headersOf(init)["Idempotency-Key"] ?? "");
        return usersCalls === 1
          ? mockResponse(401)
          : mockResponse(200, { ok: true });
      }
      if (url === "/api/v1/auth/refresh") return mockResponse(200, SESSION);
      return mockResponse(404);
    });

    await expect(client.post("/users", { email: "user@example.com" })).resolves.toEqual({ ok: true });

    expect(usersCalls).toBe(2);
    expect(attemptKeys).toHaveLength(2);
    expect(attemptKeys[0]).toMatch(UUID_V4);
    expect(attemptKeys[1]).toBe(attemptKeys[0]);
    expect(headersOf(fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)).toEqual(
      expect.objectContaining({ Authorization: "Bearer new-access" }),
    );
    expect(tokens.current).toEqual({ access: "new-access", refresh: "new-refresh" });
  });

  it("does not add the header to auth endpoints", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, {}));

    await client.post("/auth/logout", { refresh_token: "ref-1" });
    await client.post("/api/v1/auth/login", { email: "admin@example.com", password: "secret" });

    expect(headersOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)).not.toHaveProperty(
      "Idempotency-Key",
    );
    expect(headersOf(fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)).not.toHaveProperty(
      "Idempotency-Key",
    );
  });

  it("does not add the header to GET requests", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, []));

    await client.get("/users");

    expect(headersOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)).not.toHaveProperty(
      "Idempotency-Key",
    );
  });

  it("does not add the header to non-POST mutating requests", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, {}));

    await client.patch("/users/u1", { role: "admin" });
    await client.put("/users/u1", { role: "admin" });
    await client.delete("/users/u1");

    for (const call of fetchMock.mock.calls) {
      expect(headersOf(call[1] as RequestInit | undefined)).not.toHaveProperty("Idempotency-Key");
    }
  });

  it("preserves an explicitly provided key", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, { ok: true }));

    await client.post("/users", { email: "user@example.com" }, {
      headers: { "Idempotency-Key": "manual-key-1" },
    });

    expect(
      headersOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)["Idempotency-Key"],
    ).toBe("manual-key-1");
  });

  it("preserves an explicitly provided key with a different case", async () => {
    const { client } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, { ok: true }));

    await client.post("/users", { email: "user@example.com" }, {
      headers: { "idempotency-key": "manual-key-2" },
    });

    const headers = headersOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined);
    expect(headers["idempotency-key"]).toBe("manual-key-2");
    expect(headers).not.toHaveProperty("Idempotency-Key");
  });

  it("falls back to a local generator without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        for (let index = 0; index < array.length; index += 1) array[index] = index;
        return array;
      },
    });

    expect(createIdempotencyKey()).toMatch(UUID_V4);
  });

  it("falls back to Math.random without any crypto support", () => {
    vi.stubGlobal("crypto", undefined);

    const key = createIdempotencyKey();

    expect(key).toMatch(UUID_V4);
    expect(createIdempotencyKey()).not.toBe(key);
  });
});
