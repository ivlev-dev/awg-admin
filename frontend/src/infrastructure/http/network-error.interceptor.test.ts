import type { AuthSessionState } from "@/application/auth/session-state";
import type { TokenStore } from "../storage";
import { AuthRequestInterceptor } from "./auth-request.interceptor";
import { AuthResponseInterceptor } from "./auth-response.interceptor";
import { HttpAuthRepository } from "./auth.repository";
import { HttpClient } from "./client";
import { ApiError } from "./errors";
import { InterceptorRegistry } from "./interceptor-registry";
import { NetworkErrorInterceptor } from "./network-error.interceptor";
import { HttpTransport } from "./transport";

function memoryTokens(): TokenStore {
  return {
    access: () => "token",
    refresh: () => "refresh",
    set: () => undefined,
    clear: () => undefined,
  };
}

function harness(notify: (error: ApiError) => void, cooldownMs = 5000): HttpClient {
  const tokens = memoryTokens();
  const transport = new HttpTransport({ baseUrl: "/api/v1", timeoutMs: 1_000 });
  const auth = new HttpAuthRepository(transport, tokens);
  const session: AuthSessionState = { clear: () => undefined };
  const registry = new InterceptorRegistry(
    new AuthRequestInterceptor(tokens),
    new AuthResponseInterceptor(auth, tokens, session),
  );
  registry.addResponse(new NetworkErrorInterceptor(notify, cooldownMs));
  return new HttpClient(transport, registry);
}

function mockResponse(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body ?? null),
    text: vi.fn().mockResolvedValue(body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NetworkErrorInterceptor", () => {
  it("notifies about a network_error without changing the thrown error", async () => {
    const notify = vi.fn();
    const client = harness(notify);
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

    await expect(client.get("/users")).rejects.toMatchObject({ code: "network_error" });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
  });

  it("does not notify about ordinary HTTP errors such as 401", async () => {
    const notify = vi.fn();
    const client = harness(notify);
    globalThis.fetch = vi.fn(async () => mockResponse(401)) as unknown as typeof fetch;

    await expect(client.get("/users")).rejects.toMatchObject({ status: 401 });

    expect(notify).not.toHaveBeenCalled();
  });

  it("throttles repeated network notices", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const notify = vi.fn();
    const client = harness(notify, 5000);
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

    await expect(client.get("/users")).rejects.toMatchObject({ code: "network_error" });
    await expect(client.get("/nodes")).rejects.toMatchObject({ code: "network_error" });
    expect(notify).toHaveBeenCalledTimes(1);

    vi.setSystemTime(5000);
    await expect(client.get("/clients")).rejects.toMatchObject({ code: "network_error" });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
