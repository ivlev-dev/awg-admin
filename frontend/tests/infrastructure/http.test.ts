import { vi } from "vitest";

import { ApiError } from "@/infrastructure/http/errors";
import { LocalTokenStore } from "@/infrastructure/storage";
import { createHttpBackend, type HttpBackend } from "@/infrastructure/http/backend";
import type { User } from "@/domain/types";

function mockResponse(status: number, body?: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body ?? null),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
}

const USER: User = {
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
};

const SESSION = {
  token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: USER,
};

describe("HTTP backend", () => {
  let store: LocalTokenStore;
  let backend: HttpBackend;

  beforeEach(() => {
    const storage = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage;
    globalThis.localStorage.clear();
    store = new LocalTokenStore();
    backend = createHttpBackend({
      tokens: store,
      config: { baseUrl: "/api/v1", timeoutMs: 1_000 },
      session: { clear: () => store.clear() },
    });
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("login saves tokens", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, SESSION),
    );

    const result = await backend.repositories.auth.login({
      login: "admin",
      password: "secret",
    });

    expect(result).toEqual(SESSION);
    expect(store.access()).toBe("access-1");
    expect(store.refresh()).toBe("refresh-1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("registers an account without storing tokens", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(202, { status: "pending_email" }),
    );

    const result = await backend.repositories.auth.register({
      email: "user@example.com",
      login: "user",
      password: "secret123",
    });

    expect(result).toEqual({ status: "pending_email" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "user@example.com",
          login: "user",
          password: "secret123",
        }),
      }),
    );
    expect(store.access()).toBeNull();
  });

  it("verifies an email and resends the verification letter", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { status: "pending_approval" }))
      .mockResolvedValueOnce(mockResponse(202));

    await expect(backend.repositories.auth.verifyEmail("token-1")).resolves.toEqual({
      status: "pending_approval",
    });
    await backend.repositories.auth.resendVerification("user@example.com");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/verify-email",
      expect.objectContaining({ body: JSON.stringify({ token: "token-1" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/resend-verification",
      expect.objectContaining({ body: JSON.stringify({ email: "user@example.com" }) }),
    );
  });

  it("requests and confirms a password reset", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(202, { status: "sent" }))
      .mockResolvedValueOnce(mockResponse(200, { status: "reset" }));

    await expect(backend.repositories.auth.forgotPassword("user@example.com")).resolves.toEqual({
      status: "sent",
    });
    await expect(backend.repositories.auth.resetPassword("token-1", "secret123")).resolves.toEqual({
      status: "reset",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/forgot-password",
      expect.objectContaining({ body: JSON.stringify({ email: "user@example.com" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/reset-password",
      expect.objectContaining({
        body: JSON.stringify({ token: "token-1", password: "secret123" }),
      }),
    );
    expect(store.access()).toBeNull();
  });

  it("sets up, enables and disables TOTP with the access token", async () => {
    store.set("tok-123", "ref-123");
    const setup = {
      secret: "SECRET",
      otpauth_url: "otpauth://totp/test",
      recovery_codes: ["1111"],
    };
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, setup))
      .mockResolvedValueOnce(mockResponse(200, { enabled: true }))
      .mockResolvedValueOnce(mockResponse(200, { enabled: false }));

    await expect(backend.repositories.auth.totpSetup()).resolves.toEqual(setup);
    await expect(backend.repositories.auth.totpEnable("123456")).resolves.toEqual({ enabled: true });
    await expect(backend.repositories.auth.totpDisable("secret", "654321")).resolves.toEqual({
      enabled: false,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/totp/enable",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok-123" }),
        body: JSON.stringify({ code: "123456" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/totp/disable",
      expect.objectContaining({
        body: JSON.stringify({ password: "secret", code: "654321" }),
      }),
    );
  });

  it("lists, revokes sessions and logs out everywhere", async () => {
    store.set("tok-123", "ref-123");
    const info = {
      jti: "jti-1",
      family_id: "fam-1",
      created_at: "2026-11-10T10:00:00Z",
      expires_at: "2099-01-01T00:00:00Z",
      revoked: false,
      used: false,
      user_agent: "Mozilla/5.0 Firefox/121.0",
      ip: "203.0.113.7",
    };
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, [info]))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, revoked: 2 }));

    await expect(backend.repositories.auth.sessions()).resolves.toEqual([info]);
    await expect(backend.repositories.auth.revokeSession("jti-1")).resolves.toBeUndefined();
    await expect(backend.repositories.auth.logoutAll()).resolves.toEqual({
      ok: true,
      revoked: 2,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/sessions",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer tok-123" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/sessions/jti-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer tok-123" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/logout-all",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok-123" }),
      }),
    );
  });

  it("lists, approves and rejects pending users", async () => {
    store.set("tok-123", "ref-123");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, [USER]))
      .mockResolvedValueOnce(mockResponse(200, USER))
      .mockResolvedValueOnce(mockResponse(200, { ...USER, status: "rejected" }));

    await expect(backend.repositories.users.listPending()).resolves.toEqual([USER]);
    await expect(
      backend.repositories.users.approveUser("u1", { tariff_id: "t1", group_id: "g1" }),
    ).resolves.toEqual(USER);
    await expect(backend.repositories.users.rejectUser("u1")).resolves.toEqual({
      ...USER,
      status: "rejected",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/users/pending",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/users/u1/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tariff_id: "t1", group_id: "g1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/users/u1/reject",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends Authorization header", async () => {
    store.set("tok-123", "ref-123");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, USER),
    );

    await backend.repositories.auth.me();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok-123",
        }),
      }),
    );
  });

  it("refreshes on 401 and retries api requests", async () => {
    store.set("old-access", "old-refresh");
    const listData = [USER];
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(401))
      .mockResolvedValueOnce(mockResponse(200, SESSION))
      .mockResolvedValueOnce(mockResponse(200, listData));

    const result = await backend.repositories.users.listUsers();

    expect(result).toEqual(listData);
    expect(store.access()).toBe("access-1");
    expect(store.refresh()).toBe("refresh-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes an expired access token for authenticated auth endpoints", async () => {
    store.set("expired-access", "old-refresh");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(401))
      .mockResolvedValueOnce(mockResponse(200, SESSION))
      .mockResolvedValueOnce(mockResponse(200, USER));

    await expect(backend.repositories.auth.me()).resolves.toEqual(USER);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/refresh");
    expect(store.access()).toBe("access-1");
    expect(store.refresh()).toBe("refresh-1");
  });

  it("does not retry a failed login through refresh", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockResponse(401, { error: { code: "unauthorized", message: "bad credentials" } }),
    );

    await expect(
      backend.repositories.auth.login({ login: "admin", password: "wrong" }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/login");
  });

  it("clears tokens when a retried auth request is rejected again", async () => {
    store.set("expired-access", "old-refresh");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(401))
      .mockResolvedValueOnce(mockResponse(200, SESSION))
      .mockResolvedValueOnce(mockResponse(401));

    await expect(backend.repositories.auth.me()).rejects.toBeInstanceOf(ApiError);

    expect(store.access()).toBeNull();
    expect(store.refresh()).toBeNull();
  });

  it("reports invalid JSON with the response status", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError("invalid")),
      text: vi.fn().mockResolvedValue("<html>not json</html>"),
    } as unknown as Response);

    try {
      await backend.repositories.auth.me();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(200);
      expect((error as ApiError).code).toBe("invalid_response");
    }
  });

  it("throws ApiError with code and message from JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(400, { error: { code: "bad_request", message: "nope" } }),
    );

    try {
      await backend.repositories.auth.me();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.code).toBe("bad_request");
      expect(apiError.message).toBe("nope");
    }
  });

  it("query stats series", async () => {
    store.set("tok", "ref");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, [{ at: "2020-01-01T00:00:00Z", rx: 1, tx: 2 }]),
    );

    const result = await backend.repositories.stats.series("device", "dev-1", 100, 200);

    expect(result).toEqual([{ at: "2020-01-01T00:00:00Z", rx: 1, tx: 2 }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/stats/series?scope=device&from=100&to=200&id=dev-1",
      expect.anything(),
    );
  });
});
