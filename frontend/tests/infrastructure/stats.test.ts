import { vi } from "vitest";

import type { StatsRepository } from "@/domain/stats/repository";
import { createHttpBackend } from "@/infrastructure/http/backend";
import { LiveStats } from "@/infrastructure/stats";
import { LocalTokenStore } from "@/infrastructure/storage";

const TICKET = "a".repeat(64);
const TICKET_USER = "b".repeat(64);

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 0;
  url: string;
  listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(callback);
  }

  dispatch(type: string, event: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", new Event("open"));
  }

  message(data: unknown): void {
    this.dispatch("message", { data: JSON.stringify(data) });
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", new Event("close"));
  }
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

function ticketRepository(
  issue: () => Promise<string>,
): { repository: StatsRepository; createWsTicket: ReturnType<typeof vi.fn> } {
  const createWsTicket = vi.fn(issue);
  const repository: StatsRepository = {
    overview: vi.fn(async () => {
      throw new Error("overview is not used in this test");
    }),
    series: vi.fn(async () => []),
    createWsTicket,
  };
  return { repository, createWsTicket };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function nextSocket(index = 0): Promise<FakeWebSocket> {
  await vi.waitFor(() => {
    expect(FakeWebSocket.instances.length).toBeGreaterThan(index);
  });
  return FakeWebSocket.instances[index]!;
}

describe("LiveStats", () => {
  let store: LocalTokenStore;

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
    store.set("access-token", "refresh-token");
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests a ticket before opening the socket", async () => {
    const { repository, createWsTicket } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const ws = await nextSocket();

    expect(createWsTicket).toHaveBeenCalledTimes(1);
    expect(createWsTicket).toHaveBeenCalledWith("global", null, expect.anything());
    expect(ws.url).toContain(`/api/v1/ws/stats?ticket=${TICKET}`);
  });

  it("passes the scope id to the ticket request", async () => {
    const { repository, createWsTicket } = ticketRepository(async () => TICKET_USER);
    const stats = new LiveStats(store, repository);

    stats.connect("user", "u1");
    const ws = await nextSocket();

    expect(createWsTicket).toHaveBeenCalledWith("user", "u1", expect.anything());
    expect(ws.url).toContain(`ticket=${TICKET_USER}`);
  });

  it("keeps the access token out of the socket URL", async () => {
    const { repository } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const ws = await nextSocket();

    expect(ws.url).not.toContain("token");
    expect(ws.url).not.toContain("access-token");
    expect(ws.url).not.toContain("scope=");
    const url = new URL(ws.url.replace(/^ws/, "http"));
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe("/api/v1/ws/stats");
    expect(url.searchParams.get("ticket")).toBe(TICKET);
  });

  it("does not create a socket while the ticket is pending", async () => {
    const pending = deferred<string>();
    const { repository } = ticketRepository(() => pending.promise);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    await Promise.resolve();

    expect(FakeWebSocket.instances).toHaveLength(0);

    pending.resolve(TICKET);
    const ws = await nextSocket();
    expect(ws.url).toContain(`ticket=${TICKET}`);
  });

  it("updates today and month on hello", async () => {
    const { repository } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const ws = await nextSocket();
    ws.open();
    expect(stats.connected).toBe(true);

    ws.message({
      type: "hello",
      today: { rx: 5, tx: 6 },
      month: { rx: 7, tx: 8 },
    });

    expect(stats.today).toEqual({ rx: 5, tx: 6 });
    expect(stats.month).toEqual({ rx: 7, tx: 8 });
  });

  it("accumulates traffic and limits history to 60", async () => {
    const { repository } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const ws = await nextSocket();
    ws.open();
    ws.message({
      type: "hello",
      today: { rx: 0, tx: 0 },
      month: { rx: 0, tx: 0 },
    });

    const item = {
      device_id: "d1",
      user_id: "u1",
      group_id: "g1",
      interface_id: "i1",
      rx: 1,
      tx: 2,
    };

    for (let i = 0; i < 61; i += 1) {
      ws.message({
        type: "traffic",
        at: new Date().toISOString(),
        items: [item],
      });
    }

    expect(stats.today).toEqual({ rx: 61, tx: 122 });
    expect(stats.month).toEqual({ rx: 61, tx: 122 });
    expect(stats.history).toHaveLength(60);
  });

  it("disconnect closes the socket", async () => {
    const { repository } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const ws = await nextSocket();
    ws.open();
    stats.disconnect();

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(stats.connected).toBe(false);
  });

  it("does not reconnect when connect is called twice for the same scope", async () => {
    const { repository, createWsTicket } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    stats.connect("global");
    await nextSocket();

    expect(createWsTicket).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ignores close events from a replaced socket", async () => {
    const { repository } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const first = await nextSocket(0);
    first.open();

    stats.connect("user", "u1");
    const second = await nextSocket(1);
    const timer = vi.spyOn(window, "setTimeout");

    first.close();

    expect(timer).not.toHaveBeenCalled();
    expect(stats.connected).toBe(false);

    second.open();
    expect(stats.connected).toBe(true);
  });

  it("does not reconnect after an intentional disconnect", async () => {
    const { repository } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const ws = await nextSocket();
    ws.open();
    const timer = vi.spyOn(window, "setTimeout");

    stats.disconnect();
    ws.close();

    expect(timer).not.toHaveBeenCalled();
  });

  it("requests a fresh ticket for every reconnect", async () => {
    vi.useFakeTimers();
    let issued = 0;
    const { repository, createWsTicket } = ticketRepository(async () => {
      issued += 1;
      return issued === 1 ? TICKET : TICKET_USER;
    });
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const first = FakeWebSocket.instances[0]!;
    first.open();

    first.close();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(createWsTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.url).toContain(`ticket=${TICKET_USER}`);
  });

  it("does not use a ticket issued for a superseded scope", async () => {
    const globalTicket = deferred<string>();
    const userTicket = deferred<string>();
    const { repository, createWsTicket } = ticketRepository(() =>
      createWsTicket.mock.calls.length === 1 ? globalTicket.promise : userTicket.promise,
    );
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    const firstSignal = createWsTicket.mock.calls[0]?.[2] as
      | { signal?: AbortSignal }
      | undefined;

    stats.connect("user", "u1");
    const secondSignal = createWsTicket.mock.calls[1]?.[2] as
      | { signal?: AbortSignal }
      | undefined;
    expect(firstSignal?.signal?.aborted).toBe(true);

    globalTicket.resolve(TICKET);
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(0);

    userTicket.resolve(TICKET_USER);
    const ws = await nextSocket();
    expect(ws.url).toContain(`ticket=${TICKET_USER}`);
    expect(secondSignal?.signal?.aborted).toBe(false);
  });

  it("retries with backoff when the ticket request fails", async () => {
    vi.useFakeTimers();
    let issued = 0;
    const { repository, createWsTicket } = ticketRepository(async () => {
      issued += 1;
      if (issued === 1) throw new Error("network down");
      return TICKET;
    });
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    await vi.waitFor(() => expect(createWsTicket).toHaveBeenCalledTimes(1));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(stats.error).toBe("live_stats_unavailable");

    await vi.advanceTimersByTimeAsync(2_000);

    expect(createWsTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("does not request a ticket without an access token", async () => {
    store.clear();
    const { repository, createWsTicket } = ticketRepository(async () => TICKET);
    const stats = new LiveStats(store, repository);

    stats.connect("global");
    await Promise.resolve();

    expect(createWsTicket).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("LiveStats HTTP ticket flow", () => {
  let store: LocalTokenStore;

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
    store.set("access-token", "refresh-token");
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("posts the ticket request with a bearer token before connecting", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockResponse(200, { ticket: TICKET, expires_in: 30 }));
    const backend = createHttpBackend({
      tokens: store,
      config: { baseUrl: "/api/v1", timeoutMs: 1_000 },
      session: { clear: () => store.clear() },
    });
    const stats = new LiveStats(store, backend.repositories.stats);

    stats.connect("group", "g1");
    const ws = await nextSocket();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/ws/ticket");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ scope: "group", id: "g1" }));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-token");
    expect(ws.url).toContain(`ticket=${TICKET}`);
    expect(ws.url).not.toContain("access-token");
  });

  it("requests a new ticket for a second connect", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { ticket: TICKET, expires_in: 30 }))
      .mockResolvedValueOnce(mockResponse(200, { ticket: TICKET_USER, expires_in: 30 }));
    const backend = createHttpBackend({
      tokens: store,
      config: { baseUrl: "/api/v1", timeoutMs: 1_000 },
      session: { clear: () => store.clear() },
    });
    const stats = new LiveStats(store, backend.repositories.stats);

    stats.connect("global");
    await nextSocket(0);
    stats.disconnect();

    stats.connect("global");
    const second = await nextSocket(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.url).toContain(`ticket=${TICKET_USER}`);
  });

  it("rejects a malformed ticket payload", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockResponse(200, { ticket: "short", expires_in: 30 }));
    const backend = createHttpBackend({
      tokens: store,
      config: { baseUrl: "/api/v1", timeoutMs: 1_000 },
      session: { clear: () => store.clear() },
    });
    const stats = new LiveStats(store, backend.repositories.stats);

    stats.connect("global");
    await vi.waitFor(() => expect(stats.error).toBe("live_stats_unavailable"));

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("does not raise a global network toast when the ticket request fails", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const onNetworkError = vi.fn();
    const backend = createHttpBackend({
      tokens: store,
      config: { baseUrl: "/api/v1", timeoutMs: 1_000 },
      session: { clear: () => store.clear() },
      onNetworkError,
    });
    const stats = new LiveStats(store, backend.repositories.stats);

    stats.connect("global");
    await vi.waitFor(() => expect(stats.error).toBe("live_stats_unavailable"));

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(onNetworkError).not.toHaveBeenCalled();
    stats.disconnect();
  });
});
