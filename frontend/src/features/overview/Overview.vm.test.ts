import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { StatsService } from "@/application/stats/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { StatsRepository } from "@/domain/stats/repository";
import type { Overview, Role, StatsPoint, User } from "@/domain/types";
import { LiveStats } from "@/infrastructure/stats";
import type { TokenStore } from "@/infrastructure/storage";
import { OverviewVM } from "./Overview.vm";

const ADMIN: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const OWNER: User = {
  id: "u2",
  login: "owner",
  role: "user",
  tariff_id: null,
  group_id: "g1",
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const OVERVIEW: Overview = {
  today: { rx: 1024, tx: 2048 },
  month: { rx: 4096, tx: 8192 },
  nodes_online: 1,
  nodes_total: 2,
  interfaces: 2,
  groups: 1,
  devices: 3,
  users: 2,
  top_devices: [
    {
      device_id: "d1",
      name: "laptop",
      user_id: "u2",
      rx: 1024,
      tx: 2048,
      online: true,
    },
    {
      device_id: "d2",
      name: "phone",
      user_id: "u2",
      rx: 0,
      tx: 1024,
      online: false,
    },
  ],
};

const POINTS: StatsPoint[] = [
  { at: "2020-01-01T00:00:00Z", rx: 1024, tx: 2048 },
  { at: "2020-01-01T01:00:00Z", rx: 0, tx: 1024 },
];

class MemoryTokenStore implements TokenStore {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  access(): string | null {
    return this.accessToken;
  }

  refresh(): string | null {
    return this.refreshToken;
  }

  set(access: string, refresh: string): void {
    this.accessToken = access;
    this.refreshToken = refresh;
  }

  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  readonly url: string;
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(callback);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", new Event("close"));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", new Event("open"));
  }

  message(payload: unknown): void {
    this.dispatch("message", { data: JSON.stringify(payload) });
  }

  private dispatch(type: string, event: unknown): void {
    for (const callback of this.listeners[type] ?? []) callback(event);
  }
}

function fakeAuth(user: User): AuthRepository {
  return {
    login: vi.fn(async () => {
      throw new Error("login is not used in this test");
    }),
    refresh: vi.fn(async () => {
      throw new Error("refresh is not used in this test");
    }),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => user),
    changePassword: vi.fn(async () => undefined),
  };
}

function statsHarness(overview: Overview, points: StatsPoint[]): {
  repository: StatsRepository;
  overview: ReturnType<typeof vi.fn>;
  series: ReturnType<typeof vi.fn>;
} {
  const overviewFn = vi.fn(async () => overview);
  const series = vi.fn(async () => points);
  return {
    overview: overviewFn,
    series,
    repository: {
      overview: overviewFn,
      series,
    },
  };
}

function setup(role: Role = "admin") {
  const user = role === "admin" ? ADMIN : OWNER;
  const tokens = new MemoryTokenStore();
  tokens.set("access-token", "refresh-token");
  const session = new Session(fakeAuth(user), tokens);
  session.user = user;
  window.history.replaceState(null, "", "/");
  const stats = statsHarness(OVERVIEW, POINTS);
  const liveStats = new LiveStats(tokens);
  const router = new Router();
  const vm = new OverviewVM(
    new StatsService(stats.repository),
    liveStats,
    session,
    router,
  );
  return { vm, stats, liveStats, session, router };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverviewVM", () => {
  it("загружает обзор и серию за сутки для администратора", async () => {
    const { vm, stats } = setup("admin");

    expect(vm.isAdmin).toBe(true);
    vm.created();

    await vi.waitFor(() => expect(vm.loading).toBe(false));

    expect(stats.overview).toHaveBeenCalledTimes(1);
    expect(stats.series).toHaveBeenCalledWith("global", null, expect.any(Number), expect.any(Number));
    const call = stats.series.mock.calls[0];
    expect(Number(call?.[3]) - Number(call?.[2])).toBe(24 * 3600);
    expect(vm.data).toEqual(OVERVIEW);
    expect(vm.error).toBeNull();
    expect(vm.devices).toBe(3);
    expect(vm.nodesOnline).toBe(1);
    expect(vm.nodesTotal).toBe(2);
    expect(vm.todayRx).toBe("1.0 КБ");
    expect(vm.todayTx).toBe("2.0 КБ");
    expect(vm.todayTotal).toBe("3.0 КБ");
    expect(vm.monthRx).toBe("4.0 КБ");
    expect(vm.monthTx).toBe("8.0 КБ");
    expect(vm.monthTotal).toBe("12.0 КБ");
    expect(vm.spark).toEqual([3072, 1024]);
    expect(vm.live).toBe(false);
  });

  it("показывает топ устройств и роли", async () => {
    const { vm } = setup("admin");
    await vm.load();

    expect(vm.topDevices).toEqual(OVERVIEW.top_devices);
    expect(vm.topDevices[0]).toMatchObject({ device_id: "d1", online: true });
    expect(vm.isAdmin).toBe(true);

    const user = setup("user");
    await user.vm.load();
    expect(user.vm.isAdmin).toBe(false);
  });

  it("подключает live-статистику к текущему пользователю для обычной роли", async () => {
    const { vm, stats } = setup("user");

    vm.created();

    expect(vm.isAdmin).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toContain("scope=user");
    expect(socket.url).toContain(`id=${OWNER.id}`);
    expect(socket.url).toContain("token=access-token");

    await vi.waitFor(() => expect(vm.loading).toBe(false));
    expect(stats.series).toHaveBeenCalledWith("user", OWNER.id, expect.any(Number), expect.any(Number));
  });

  it("обновляет показатели из live-статистики", async () => {
    const { vm, liveStats } = setup("admin");
    await vm.load();
    vm.created();
    const socket = FakeWebSocket.instances[0]!;

    socket.open();
    expect(vm.live).toBe(true);

    socket.message({
      type: "hello",
      today: { rx: 2048, tx: 0 },
      month: { rx: 1024, tx: 1024 },
    });

    expect(vm.todayRx).toBe("2.0 КБ");
    expect(vm.todayTx).toBe("0 B");
    expect(vm.todayTotal).toBe("2.0 КБ");
    expect(vm.monthRx).toBe("1.0 КБ");
    expect(vm.monthTx).toBe("1.0 КБ");
    expect(vm.monthTotal).toBe("2.0 КБ");
    expect(vm.spark).toEqual([3072, 1024]);

    socket.message({
      type: "traffic",
      at: "2020-01-01T00:00:00Z",
      items: [
        { device_id: "d1", user_id: "u2", group_id: "g1", interface_id: "i1", rx: 512, tx: 512 },
      ],
    });

    expect(liveStats.history).toHaveLength(1);
    expect(vm.spark).toEqual([1024]);
  });

  it("показывает ошибку загрузки обзора", async () => {
    const { vm, stats } = setup("admin");
    vi.mocked(stats.overview).mockRejectedValueOnce(new Error("Бэкенд недоступен"));

    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.error).toBe("Бэкенд недоступен");
    expect(vm.data).toBeNull();
    expect(vm.todayRx).toBe("0 B");
    expect(vm.devices).toBe(0);
    expect(vm.topDevices).toEqual([]);
  });

  it("подставляет сообщение по умолчанию для неизвестной ошибки", async () => {
    const { vm, stats } = setup("admin");
    vi.mocked(stats.overview).mockRejectedValueOnce("boom");

    await vm.load();

    expect(vm.error).toBe("Не удалось загрузить обзор");
  });

  it("переходит по разделам через роутер", () => {
    const { vm, router } = setup("admin");

    vm.openDevice("d1");
    expect(router.path).toBe("/clients/d1");

    vm.openClients();
    expect(router.path).toBe("/clients");

    vm.openInterfaces();
    expect(router.path).toBe("/interfaces");

    vm.openStats();
    expect(router.path).toBe("/stats");
  });

  it("отключает live при размонтировании", async () => {
    const { vm, liveStats } = setup("admin");
    vm.created();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(vm.live).toBe(true);

    vm.unmounted();

    expect(vm.live).toBe(false);
    expect(liveStats.connected).toBe(false);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    await vi.waitFor(() => expect(vm.loading).toBe(false));
  });

  it("резолвится контейнером без ручных привязок", async () => {
    const container = createAppContainer();

    const vm = await container.resolve(OverviewVM);

    expect(vm).toBeInstanceOf(OverviewVM);
    expect(await container.resolve(OverviewVM)).toBe(vm);
  });
});
