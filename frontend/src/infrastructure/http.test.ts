import { vi } from "vitest";
import { HttpApi, ApiError } from "./http";
import { LocalTokenStore } from "./storage";

function mockResponse(status: number, body?: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body ?? null),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
}

describe("HttpApi", () => {
  let store: LocalTokenStore;
  let api: HttpApi;

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
    api = new HttpApi(store);
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("login saves tokens", async () => {
    const session = {
      token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      user: {
        id: "u1",
        login: "admin",
        role: "admin",
        tariff_id: null,
        group_id: null,
        disabled: false,
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
      },
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, session),
    );

    const result = await api.login({ login: "admin", password: "secret" });

    expect(result).toEqual(session);
    expect(store.access()).toBe("access-1");
    expect(store.refresh()).toBe("refresh-1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends Authorization header", async () => {
    store.set("tok-123", "ref-123");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, { id: "u1" }),
    );

    await api.me();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok-123",
        }),
      }),
    );
  });

  it("refreshes on 401 and retries", async () => {
    store.set("old-access", "old-refresh");
    const meData = { id: "u1", login: "admin" };
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(401))
      .mockResolvedValueOnce(
        mockResponse(200, {
          token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          user: {
            id: "u1",
            login: "admin",
            role: "admin",
            tariff_id: null,
            group_id: null,
            disabled: false,
            created_at: "2020-01-01T00:00:00Z",
            updated_at: "2020-01-01T00:00:00Z",
          },
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, meData));

    const result = await api.me();

    expect(result).toEqual(meData);
    expect(store.access()).toBe("new-access");
    expect(store.refresh()).toBe("new-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws ApiError with code and message from JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(400, { error: { code: "bad_request", message: "nope" } }),
    );

    try {
      await api.me();
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

    const result = await api.series("device", "dev-1", 100, 200);

    expect(result).toEqual([{ at: "2020-01-01T00:00:00Z", rx: 1, tx: 2 }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/stats/series?scope=device&from=100&to=200&id=dev-1",
      expect.anything(),
    );
  });
});