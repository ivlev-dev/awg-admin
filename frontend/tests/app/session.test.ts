import { vi } from "vitest";

import { Session } from "@/app/session";
import type { AuthRepository } from "@/domain/auth/repository";
import { ApiError } from "@/domain/errors";
import type { AuthSession, User } from "@/domain/types";
import { HttpAuthRepository } from "@/infrastructure/http/auth.repository";
import { HttpTransport } from "@/infrastructure/http/transport";
import { LocalTokenStore, type TokenStore } from "@/infrastructure/storage";

const USER: User = {
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
};

const SESSION: AuthSession = {
  token: "new-access",
  refresh_token: "new-refresh",
  expires_in: 3600,
  user: USER,
};

function memoryTokens(access: string | null, refresh: string | null): TokenStore {
  let state = { access, refresh };
  let version = 0;
  return {
    access: () => state.access,
    refresh: () => state.refresh,
    set: (nextAccess, nextRefresh) => {
      version += 1;
      state = { access: nextAccess, refresh: nextRefresh };
    },
    clear: () => {
      version += 1;
      state = { access: null, refresh: null };
    },
    generation: () => version,
  };
}

function fakeAuth(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    login: vi.fn(async () => SESSION),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    updateProfile: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
    ...overrides,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Session initialization", () => {
  it("refreshes tokens at boot when only the refresh token is present", async () => {
    const tokens = memoryTokens(null, "stored-refresh");
    const auth = fakeAuth();
    const session = new Session(auth, tokens);

    await session.init();

    expect(auth.refresh).toHaveBeenCalledWith("stored-refresh");
    expect(auth.me).toHaveBeenCalledTimes(1);
    expect(session.user).toEqual(USER);
    expect(session.ready).toBe(true);
  });

  it("clears the session when the boot refresh fails with 401", async () => {
    const tokens = memoryTokens(null, "stored-refresh");
    const auth = fakeAuth({
      refresh: vi.fn(async () =>
        Promise.reject(new ApiError(401, "unauthorized", "expired")),
      ),
    });
    const session = new Session(auth, tokens);

    await session.init();

    expect(session.user).toBeNull();
    expect(tokens.refresh()).toBeNull();
    expect(session.ready).toBe(true);
  });

  it("keeps tokens and reports a network error when /auth/me is unreachable", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    const auth = fakeAuth({
      me: vi.fn(async () =>
        Promise.reject(new ApiError(0, "network_error", "Failed to fetch")),
      ),
    });
    const session = new Session(auth, tokens);

    await session.init();

    expect(session.user).toBeNull();
    expect(session.ready).toBe(true);
    expect(session.error).toBe("Нет связи с сервером. Проверьте соединение и повторите попытку.");
    expect(tokens.access()).toBe("access-1");
    expect(tokens.refresh()).toBe("refresh-1");
  });

  it("clears tokens and the user when /auth/me returns 401", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    const auth = fakeAuth({
      me: vi.fn(async () => Promise.reject(new ApiError(401, "unauthorized", "expired"))),
    });
    const session = new Session(auth, tokens);

    await session.init();

    expect(session.user).toBeNull();
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
  });

  it("clears tokens and reports the block reason for account_disabled", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    const auth = fakeAuth({
      me: vi.fn(async () =>
        Promise.reject(new ApiError(403, "account_disabled", "account is disabled")),
      ),
    });
    const session = new Session(auth, tokens);

    await session.init();

    expect(session.user).toBeNull();
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
    expect(session.error).toBe("Учётная запись отключена");
  });

  it("boots as a guest without tokens", async () => {
    const tokens = memoryTokens(null, null);
    const auth = fakeAuth();
    const session = new Session(auth, tokens);

    await session.init();

    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.me).not.toHaveBeenCalled();
    expect(session.ready).toBe(true);
  });
});

describe("Session reload", () => {
  it("keeps the current user and tokens when the server returns 500", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    const auth = fakeAuth({
      me: vi.fn(async () => Promise.reject(new ApiError(500, "internal", "boom"))),
    });
    const session = new Session(auth, tokens);
    session.user = USER;

    await session.reload();

    expect(session.user).toEqual(USER);
    expect(tokens.access()).toBe("access-1");
    expect(tokens.refresh()).toBe("refresh-1");
    expect(session.error).not.toBeNull();
  });

  it("clears the user and tokens on 401", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    const auth = fakeAuth({
      me: vi.fn(async () => Promise.reject(new ApiError(401, "unauthorized", "expired"))),
    });
    const session = new Session(auth, tokens);
    session.user = USER;

    await session.reload();

    expect(session.user).toBeNull();
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
  });

  it("keeps tokens but clears the user on a network error", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    const auth = fakeAuth({
      me: vi.fn(async () => Promise.reject(new ApiError(0, "network_error", "offline"))),
    });
    const session = new Session(auth, tokens);
    session.user = USER;

    await session.reload();

    expect(session.user).toEqual(USER);
    expect(tokens.access()).toBe("access-1");
  });
});

describe("Session logout", () => {
  it("clears local state synchronously before the network logout resolves", async () => {
    const tokens = memoryTokens("access-1", "refresh-1");
    let releaseLogout: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });
    const auth = fakeAuth({ logout: vi.fn(() => pending) });
    const session = new Session(auth, tokens);
    session.user = USER;

    const loggingOut = session.logout();

    expect(session.user).toBeNull();
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
    expect(session.loggingOut).toBe(true);
    expect(auth.logout).toHaveBeenCalledWith("refresh-1");

    releaseLogout();
    await loggingOut;

    expect(session.loggingOut).toBe(false);
  });

  it("does not restore tokens when an in-flight refresh finishes after logout", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage);

    const tokens = new LocalTokenStore();
    tokens.set("old-access", "old-refresh");
    const transport = new HttpTransport({ baseUrl: "/api/v1", timeoutMs: 1_000 });
    const auth = new HttpAuthRepository(transport, tokens);
    const session = new Session(auth, tokens);
    session.user = USER;

    let releaseRefresh: (response: Response) => void = () => undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === "/api/v1/auth/refresh") return refreshResponse;
      if (url === "/api/v1/auth/logout") return mockResponse(204);
      return mockResponse(404);
    }) as unknown as typeof fetch;

    const refreshing = auth.refresh("old-refresh");
    const loggingOut = session.logout();
    releaseRefresh(mockResponse(200, SESSION));

    await Promise.all([refreshing, loggingOut]);

    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
    expect(session.user).toBeNull();
  });
});
