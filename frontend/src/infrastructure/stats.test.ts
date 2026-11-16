import { vi } from "vitest";
import { LiveStats } from "./stats";
import { LocalTokenStore } from "./storage";

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

describe("LiveStats", () => {
  let store: LocalTokenStore;
  let stats: LiveStats;

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
    stats = new LiveStats(store);
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  it("connects with scope", () => {
    stats.connect("global");
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toContain("scope=global");
    expect(ws.url).toContain("token=access-token");
  });

  it("updates today and month on hello", () => {
    stats.connect("global");
    const ws = FakeWebSocket.instances[0]!;
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

  it("accumulates traffic and limits history to 60", () => {
    stats.connect("global");
    const ws = FakeWebSocket.instances[0]!;
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

  it("disconnect closes socket", () => {
    stats.connect("global");
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    stats.disconnect();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(stats.connected).toBe(false);
  });
});