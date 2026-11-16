import type { AuthSessionState } from "@/application/auth/session-state";
import type { AuthSession } from "@/domain/types";
import type { TokenStore } from "../storage";
import { AuthRequestInterceptor } from "./auth-request.interceptor";
import { AuthResponseInterceptor } from "./auth-response.interceptor";
import { HttpAuthRepository } from "./auth.repository";
import { HttpClient } from "./client";
import { ApiError } from "./errors";
import { InterceptorRegistry } from "./interceptor-registry";
import { HttpTransport } from "./transport";

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
    login: "admin",
    role: "admin",
    tariff_id: null,
    group_id: null,
    email: null,
    status: "active",
    totp_enabled: false,
    disabled: false,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  },
};

interface Harness {
  client: HttpClient;
  tokens: MemoryTokens;
  cleared: ReturnType<typeof vi.fn>;
}

function harness(tokens: MemoryTokens): Harness {
  const transport = new HttpTransport({ baseUrl: "/api/v1", timeoutMs: 1_000 });
  const auth = new HttpAuthRepository(transport, tokens);
  const cleared = vi.fn();
  const session: AuthSessionState = { clear: cleared };
  const registry = new InterceptorRegistry(
    new AuthRequestInterceptor(tokens),
    new AuthResponseInterceptor(auth, tokens, session),
  );
  return { client: new HttpClient(transport, registry), tokens, cleared };
}

function installFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(handler);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function authorizationOf(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

describe("HttpClient interceptors", () => {
  it("adds the access token to authorized requests only", async () => {
    const { client, tokens } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(200, []));

    await client.get("/users");
    await client.get("/health", { auth: false });

    expect(authorizationOf(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)).toBe(
      "Bearer tok-1",
    );
    expect(
      authorizationOf(fetchMock.mock.calls[1]?.[1] as RequestInit | undefined),
    ).toBeUndefined();
    expect(tokens.current.access).toBe("tok-1");
  });

  it("refreshes once on a 401 api response and retries with the new token", async () => {
    const { client, tokens } = harness(memoryTokens("old-access", "old-refresh"));
    let usersCalls = 0;
    let retriedWith: string | undefined;
    const fetchMock = installFetch(async (url, init) => {
      if (url === "/api/v1/users") {
        usersCalls += 1;
        if (usersCalls === 1) return mockResponse(401);
        retriedWith = authorizationOf(init);
        return mockResponse(200, [{ id: "u1" }]);
      }
      if (url === "/api/v1/auth/refresh") return mockResponse(200, SESSION);
      return mockResponse(404);
    });

    const result = await client.get<Array<{ id: string }>>("/users");

    expect(result).toEqual([{ id: "u1" }]);
    expect(usersCalls).toBe(2);
    expect(retriedWith).toBe("Bearer new-access");
    expect(tokens.current).toEqual({ access: "new-access", refresh: "new-refresh" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("logs out when the api refresh fails", async () => {
    const { client, tokens, cleared } = harness(memoryTokens("old-access", "old-refresh"));
    let refreshCalls = 0;
    installFetch(async (url) => {
      if (url === "/api/v1/users") return mockResponse(401);
      if (url === "/api/v1/auth/refresh") {
        refreshCalls += 1;
        return mockResponse(401, { error: { code: "unauthorized", message: "expired" } });
      }
      return mockResponse(404);
    });

    await expect(client.get("/users")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(1);
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(tokens.current).toEqual({ access: null, refresh: null });
  });

  it("logs out on a 401 auth request without refreshing", async () => {
    const { client, cleared } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(401));

    await expect(client.get("/auth/me", { source: "auth" })).rejects.toBeInstanceOf(ApiError);

    expect(cleared).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh the refresh endpoint itself", async () => {
    const { client, cleared } = harness(memoryTokens("tok-1", "ref-1"));
    const fetchMock = installFetch(async () => mockResponse(401));

    await expect(
      client.post("/auth/refresh", { refresh_token: "ref-1" }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(cleared).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares a single refresh between parallel 401 responses", async () => {
    const { client, tokens } = harness(memoryTokens("old-access", "old-refresh"));
    const counters = new Map<string, number>();
    let refreshCalls = 0;
    let resolveRefresh: (response: Response) => void = () => undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    installFetch(async (url) => {
      if (url === "/api/v1/auth/refresh") {
        refreshCalls += 1;
        return refreshResponse;
      }
      const count = (counters.get(url) ?? 0) + 1;
      counters.set(url, count);
      if (count === 1) return mockResponse(401);
      return mockResponse(200, { url });
    });

    const first = client.get<{ url: string }>("/users/1");
    const second = client.get<{ url: string }>("/users/2");
    await flush();
    expect(refreshCalls).toBe(1);

    resolveRefresh(mockResponse(200, SESSION));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { url: "/api/v1/users/1" },
      { url: "/api/v1/users/2" },
    ]);
    expect(refreshCalls).toBe(1);
    expect(tokens.current.access).toBe("new-access");
  });

  it("does not refresh a second time after a failed retry", async () => {
    const { client } = harness(memoryTokens("old-access", "old-refresh"));
    let usersCalls = 0;
    let refreshCalls = 0;
    installFetch(async (url) => {
      if (url === "/api/v1/users") {
        usersCalls += 1;
        return mockResponse(401);
      }
      if (url === "/api/v1/auth/refresh") {
        refreshCalls += 1;
        return mockResponse(200, SESSION);
      }
      return mockResponse(404);
    });

    await expect(client.get("/users")).rejects.toBeInstanceOf(ApiError);
    expect(usersCalls).toBe(2);
    expect(refreshCalls).toBe(1);
  });
});
