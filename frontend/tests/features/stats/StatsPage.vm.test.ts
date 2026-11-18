import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultDevicesService } from "@/application/devices/service";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultStatsService } from "@/application/stats/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { DevicesRepository } from "@/domain/devices/repository";
import type { DeviceStats } from "@/domain/devices/types";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { StatsRepository } from "@/domain/stats/repository";
import type { Device, Group, InterfaceInfo, Role, StatsPoint, User } from "@/domain/types";
import type { UsersRepository } from "@/domain/users/repository";
import { LiveStats } from "@/infrastructure/stats";
import { LocalTokenStore, type TokenStore } from "@/infrastructure/storage";
import { setLocale } from "@/i18n";
import { StatsPage } from "@/features/stats/StatsPage";
import { StatsVM } from "@/features/stats/StatsPage.vm";

const ADMIN: User = {
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

const OWNER: User = {
  id: "u2",
  login: "owner",
  role: "user",
  tariff_id: null,
  group_id: "g1",
  email: null,
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const GROUP_A: Group = {
  id: "g1",
  name: "Main",
  description: "",
  base_cidr: "10.0.0.0/24",
  forwarding_default: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
  interfaces: 1,
  devices: 1,
};

const GROUP_B: Group = {
  ...GROUP_A,
  id: "g2",
  name: "Second",
};

const INTERFACE: InterfaceInfo = {
  id: "i1",
  group_id: "g1",
  group_name: "Main",
  node_id: "n1",
  node_name: "node-1",
  name: "awg0",
  label: "",
  endpoint_host: "vpn.example.com",
  endpoint_port: 51820,
  listen_port: 51820,
  mtu: 1280,
  public_key: "pub",
  obf: {
    h1: { lo: 1, hi: 2 },
    h2: { lo: 3, hi: 4 },
    h3: { lo: 5, hi: 6 },
    h4: { lo: 7, hi: 8 },
    s1: 1,
    s2: 2,
    s3: 3,
    s4: 4,
    header_protection_key: "key",
    random_trailers: false,
  },
  enabled: true,
  peers: 1,
};

const DEVICE_A: Device = {
  id: "d1",
  user_id: "u2",
  group_id: "g1",
  interface_id: "i1",
  interface_name: "awg0",
  node_id: "n1",
  node_name: "node-1",
  name: "laptop",
  down_kbps: 1000,
  up_kbps: 500,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-01-01T00:00:00Z",
  peers: [],
  addresses: ["10.0.0.2"],
};

const DEVICE_B: Device = {
  ...DEVICE_A,
  id: "d2",
  name: "phone",
  addresses: ["10.0.1.2"],
};

const STATS_A: DeviceStats = {
  device_id: "d1",
  today: { rx: 1024, tx: 2048 },
  month: { rx: 4096, tx: 8192 },
};

const POINTS: StatsPoint[] = [
  { at: "2020-01-01T00:00:00Z", rx: 1024, tx: 2048, rx_bps: 0, tx_bps: 0 },
  { at: "2020-01-01T01:00:00Z", rx: 3072, tx: 0, rx_bps: 2048, tx_bps: 0 },
];

class MemoryTokenStore {
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

  fail(): void {
    this.dispatch("error", new Event("error"));
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
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
}

function statsHarness(points: StatsPoint[]): {
  repository: StatsRepository;
  series: ReturnType<typeof vi.fn>;
} {
  const series = vi.fn(
    async (_scope: string, _id: string | null, _from: number, _to: number) => points,
  );
  return {
    series,
    repository: {
      overview: vi.fn(async () => {
        throw new Error("overview is not used in this test");
      }),
      series,
    },
  };
}

function devicesHarness(): {
  repository: DevicesRepository;
  deviceStats: ReturnType<typeof vi.fn>;
} {
  const deviceStats = vi.fn(async (id: string) => {
    if (id === STATS_A.device_id) return STATS_A;
    throw new Error(`Нет статистики для ${id}`);
  });
  return {
    deviceStats,
    repository: {
      listDevices: vi.fn(async () => [{ ...DEVICE_A }, { ...DEVICE_B }]),
      getDevice: vi.fn(async () => {
        throw new Error("getDevice is not used in this test");
      }),
      createDevice: vi.fn(async () => {
        throw new Error("createDevice is not used in this test");
      }),
      updateDevice: vi.fn(async () => {
        throw new Error("updateDevice is not used in this test");
      }),
      deleteDevice: vi.fn(async () => undefined),
      listProfiles: vi.fn(async () => []),
      getProfile: vi.fn(async () => {
        throw new Error("getProfile is not used in this test");
      }),
      deviceStats,
      listShares: vi.fn(async () => []),
      createShare: vi.fn(async () => {
        throw new Error("createShare is not used in this test");
      }),
      revokeShare: vi.fn(async () => undefined),
      revokeAllShares: vi.fn(async () => 0),
      bulk: vi.fn(async () => ({ done: 0, failed: [] })),
    },
  };
}

function groupsHarness(): GroupsRepository {
  return {
    listGroups: vi.fn(async () => [{ ...GROUP_A }, { ...GROUP_B }]),
    createGroup: vi.fn(async () => GROUP_A),
    updateGroup: vi.fn(async () => GROUP_A),
    deleteGroup: vi.fn(async () => undefined),
    bulk: vi.fn(async (_action, ids) => ({ done: ids.length, failed: [] })),
    listPools: vi.fn(async () => []),
    createPool: vi.fn(async () => {
      throw new Error("createPool is not used in this test");
    }),
    updatePool: vi.fn(async () => {
      throw new Error("updatePool is not used in this test");
    }),
    deletePool: vi.fn(async () => undefined),
  };
}

function interfacesHarness(): InterfacesRepository {
  return {
    listInterfaces: vi.fn(async () => [{ ...INTERFACE }]),
    createInterface: vi.fn(async () => INTERFACE),
    updateInterface: vi.fn(async () => INTERFACE),
    rotateInterface: vi.fn(async () => INTERFACE),
    deleteInterface: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function usersHarness(): UsersRepository {
  return {
    listUsers: vi.fn(async () => [{ ...ADMIN }, { ...OWNER }]),
    createUser: vi.fn(async () => OWNER),
    updateUser: vi.fn(async () => OWNER),
    deleteUser: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    listPending: vi.fn(async () => []),
    approveUser: vi.fn(async () => OWNER),
    rejectUser: vi.fn(async () => OWNER),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function setup(role: Role = "admin") {
  const user = role === "admin" ? ADMIN : OWNER;
  const tokens = new MemoryTokenStore();
  tokens.set("access-token", "refresh-token");
  const session = new Session(fakeAuth(user), tokens);
  session.user = user;
  window.history.replaceState(null, "", "/stats");
  const stats = statsHarness(POINTS);
  const devices = devicesHarness();
  const groups = groupsHarness();
  const interfaces = interfacesHarness();
  const users = usersHarness();
  const liveStats = new LiveStats(tokens);
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new StatsVM(
    new DefaultStatsService(stats.repository),
    new DefaultDevicesService(devices.repository),
    new DefaultGroupsService(groups),
    new DefaultInterfacesService(interfaces),
    new DefaultUsersService(users),
    liveStats,
    session,
    router,
    toasts,
  );
  return {
    vm,
    stats,
    devices,
    groups,
    interfaces,
    users,
    liveStats,
    session,
    router,
    toasts,
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  setLocale("ru");
  vi.unstubAllGlobals();
});

describe("StatsPageVM", () => {
  it("загружает сущности и статистику для администратора", async () => {
    const { vm, stats, users, groups, interfaces } = setup("admin");

    expect(vm.scope).toBe("global");
    await vm.created();

    expect(stats.series).toHaveBeenCalledWith("global", null, expect.any(Number), expect.any(Number));
    expect(users.listUsers).toHaveBeenCalledTimes(1);
    expect(groups.listGroups).toHaveBeenCalledTimes(1);
    expect(interfaces.listInterfaces).toHaveBeenCalledTimes(1);
    expect(vm.users).toHaveLength(2);
    expect(vm.groups).toHaveLength(2);
    expect(vm.interfaces).toHaveLength(1);
    expect(vm.devices.map((device) => device.id)).toEqual(["d1", "d2"]);
    expect(vm.series).toEqual(POINTS);
    expect(vm.points).toBe(2);
    expect(vm.totalRxLabel).toBe("4.0 КБ");
    expect(vm.totalTxLabel).toBe("2.0 КБ");
    expect(vm.currentRxRate).toBe("2.0 КБ/с");
    expect(vm.currentTxRate).toBe("0 B/с");
    expect(vm.seriesLoading).toBe(false);
    expect(vm.entitiesLoading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.entitiesError).toBeNull();
  });

  it("показывает топ устройств и помечает устройства без статистики", async () => {
    const { vm, toasts } = setup("admin");

    await vm.created();

    expect(vm.devicesLoading).toBe(false);
    expect(vm.deviceRows).toHaveLength(2);
    expect(vm.deviceRowsView[0]).toEqual({
      id: "d1",
      name: "laptop",
      addresses: "10.0.0.2",
      todayRx: "1.0 КБ",
      todayTx: "2.0 КБ",
      monthRx: "4.0 КБ",
      monthTx: "8.0 КБ",
      failed: false,
    });
    expect(vm.deviceRowsView[1]).toMatchObject({
      id: "d2",
      failed: true,
      todayRx: "0 B",
      todayTx: "0 B",
      monthRx: "0 B",
      monthTx: "0 B",
    });
    expect(toasts.items).toHaveLength(0);
  });

  it("показывает тост, если статистика недоступна для всех устройств", async () => {
    const { vm, devices, toasts } = setup("admin");
    await vm.loadEntities();
    vi.mocked(devices.deviceStats).mockRejectedValue(new Error("Нет соединения"));

    await vm.loadDeviceStats();

    expect(vm.deviceRows.every((row) => row.failed)).toBe(true);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Не удалось загрузить статистику устройств",
    });
  });

  it("загружает только устройства для обычного пользователя", async () => {
    const { vm, stats, users, groups, interfaces } = setup("user");

    expect(vm.scope).toBe("user");
    await vm.created();

    expect(users.listUsers).not.toHaveBeenCalled();
    expect(groups.listGroups).not.toHaveBeenCalled();
    expect(interfaces.listInterfaces).not.toHaveBeenCalled();
    expect(vm.users).toEqual([]);
    expect(vm.groups).toEqual([]);
    expect(vm.interfaces).toEqual([]);
    expect(vm.devices).toHaveLength(2);
    expect(vm.scopeId).toBe(OWNER.id);
    expect(vm.requiresEntity).toBe(false);
    expect(stats.series).toHaveBeenCalledWith("user", OWNER.id, expect.any(Number), expect.any(Number));
    expect(vm.scopeOptions.map((option) => option.value)).toEqual(["user", "device"]);
    expect(vm.isAdmin).toBe(false);
  });

  it("показывает ошибку загрузки серии и списков", async () => {
    const { vm, stats, users, toasts } = setup("admin");
    vi.mocked(stats.series).mockRejectedValueOnce(new Error("Сервис недоступен"));
    vi.mocked(users.listUsers).mockRejectedValueOnce(new Error("Списки недоступны"));

    await vm.created();

    expect(vm.error).toBe("Сервис недоступен");
    expect(vm.entitiesError).toBe("Списки недоступны");
    expect(vm.seriesLoading).toBe(false);
    expect(vm.entitiesLoading).toBe(false);
    expect(vm.series).toEqual([]);
    expect(toasts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "error", message: "Списки недоступны" }),
        expect.objectContaining({ kind: "error", message: "Сервис недоступен" }),
      ]),
    );
  });

  it("подставляет сообщение по умолчанию для неизвестной ошибки", async () => {
    const { vm, stats, toasts } = setup("admin");
    vi.mocked(stats.series).mockRejectedValueOnce("boom");

    await vm.loadSeries();

    expect(vm.error).toBe("Не удалось загрузить статистику");
    expect(toasts.items.at(-1)).toMatchObject({ kind: "error" });
  });

  it("переключает scope, сущность и диапазон", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();

    vm.setScope("interface");

    expect(vm.scope).toBe("interface");
    expect(vm.entityId).toBe(INTERFACE.id);
    expect(vm.requiresEntity).toBe(true);
    expect(vm.entityLabel).toBe("Интерфейс");
    expect(vm.entityOptions).toEqual([{ id: INTERFACE.id, label: "node-1 · awg0" }]);
    await vi.waitFor(() => {
      expect(stats.series).toHaveBeenLastCalledWith("interface", INTERFACE.id, expect.any(Number), expect.any(Number));
    });

    vm.setEntity(INTERFACE.id);
    expect(vm.entityId).toBe(INTERFACE.id);
    await vi.waitFor(() => {
      expect(stats.series).toHaveBeenLastCalledWith("interface", INTERFACE.id, expect.any(Number), expect.any(Number));
    });

    vm.setRange("7d");
    expect(vm.rangeKey).toBe("7d");
    expect(vm.periodLabel).toBe("7 дней");
    expect(vm.rangeSeconds).toBe(7 * 24 * 3600);
    await vi.waitFor(() => {
      const call = stats.series.mock.calls.at(-1);
      expect(call?.[0]).toBe("interface");
      expect(call?.[1]).toBe(INTERFACE.id);
      const from = typeof call?.[2] === "number" ? call[2] : 0;
      const to = typeof call?.[3] === "number" ? call[3] : 0;
      expect(to - from).toBe(7 * 24 * 3600);
    });

    vm.setEntity("");
    expect(vm.entityId).toBeNull();
  });

  it("игнорирует неизвестную область статистики и повторный диапазон", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();

    vm.setScope("unknown");
    vm.setRange("24h");

    expect(vm.scope).toBe("global");
    expect(stats.series).not.toHaveBeenCalled();
  });

  it("обновляет live-статистику через WebSocket", async () => {
    const { vm, liveStats } = setup("admin");
    await vm.created();

    vm.toggleLive();

    expect(vm.liveEnabled).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toContain("scope=global");
    expect(socket.url).toContain("token=access-token");

    socket.open();
    expect(vm.liveConnected).toBe(true);
    expect(vm.liveBadgeLabel).toBe("LIVE");
    expect(vm.liveBadgeClass).toBe("badge--green");

    socket.message({
      type: "hello",
      today: { rx: 1024, tx: 2048 },
      month: { rx: 4096, tx: 0 },
    });

    expect(vm.liveTodayRx).toBe("1.0 КБ");
    expect(vm.liveTodayTx).toBe("2.0 КБ");
    expect(vm.liveTodayTotal).toBe("3.0 КБ");
    expect(vm.liveMonthTotal).toBe("4.0 КБ");

    socket.message({
      type: "traffic",
      at: "2020-01-01T00:00:00Z",
      items: [
        { device_id: "d1", user_id: "u2", group_id: "g1", interface_id: "i1", rx: 1024, tx: 0 },
      ],
    });

    expect(liveStats.today).toEqual({ rx: 2048, tx: 2048 });
    expect(vm.liveTodayTotal).toBe("4.0 КБ");
    expect(liveStats.history).toHaveLength(1);

    vm.toggleLive();

    expect(vm.liveEnabled).toBe(false);
    expect(vm.liveConnected).toBe(false);
    expect(vm.liveBadgeLabel).toBe("офлайн");
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("показывает ошибку live-соединения", async () => {
    const { vm } = setup("admin");
    await vm.created();

    vm.toggleLive();
    const socket = FakeWebSocket.instances[0]!;
    socket.fail();

    expect(vm.liveError).toBe("Нет соединения со статистикой");
    expect(vm.liveBadgeClass).toBe("badge--amber");
  });

  it("требует выбранную сущность для Live-режима", async () => {
    const { vm, toasts } = setup("admin");
    await vm.created();
    vm.setScope("interface");
    await vi.waitFor(() => expect(vm.entityId).toBe(INTERFACE.id));
    vm.setEntity("");

    vm.toggleLive();

    expect(vm.liveEnabled).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Выберите сущность для Live-режима",
    });
  });

  it("переподключает live при смене scope", async () => {
    const { vm } = setup("admin");
    await vm.created();
    vm.toggleLive();
    const first = FakeWebSocket.instances[0]!;
    first.open();

    vm.setScope("interface");

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.url).toContain("scope=interface");
    expect(FakeWebSocket.instances[1]!.url).toContain(`id=${INTERFACE.id}`);
  });

  it("отключает live при размонтировании", async () => {
    const { vm, liveStats } = setup("admin");
    await vm.created();
    vm.toggleLive();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    vm.unmounted();

    expect(liveStats.connected).toBe(false);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("открывает карточку устройства через роутер", () => {
    const { vm, router } = setup("admin");

    vm.openDevice("d1");

    expect(router.path).toBe("/clients/d1");
    expect(vm.isAdmin).toBe(true);
    expect(vm.selectedScopeLabel).toBe("Все устройства");
  });

  it("не экспортирует CSV без данных", () => {
    const { vm, toasts } = setup("admin");

    vm.exportCsv();

    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Нет данных для экспорта",
    });
  });

  it("переключает язык пустого состояния и диапазонов", async () => {
    const { stats, devices, groups, interfaces, users, liveStats, session, router, toasts } = setup("admin");
    vi.mocked(stats.series).mockResolvedValue([]);
    vi.mocked(devices.repository.listDevices).mockResolvedValue([]);

    const container = createAppContainer();
    container.bind(DefaultStatsService, () => new DefaultStatsService(stats.repository));
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultGroupsService, () => new DefaultGroupsService(groups));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfaces));
    container.bind(DefaultUsersService, () => new DefaultUsersService(users));
    container.bind(LiveStats, () => liveStats);
    container.bind(Session, () => session);
    container.bind(Router, () => router);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(StatsPage, {}, { container });
    await result.ready;

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Нет данных за период");
      expect(result.node.textContent).toContain("24 часа");
    });

    setLocale("en");

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("No data for the period");
      expect(result.node.textContent).toContain("24 hours");
      expect(result.node.textContent).toContain("Statistics scope");
    });
    expect(result.node.textContent).not.toContain("Нет данных за период");

    result.dispose();
  });

  it("рендерит M3-сводку, график и таблицу устройств", async () => {
    const { stats, devices, groups, interfaces, users, liveStats, session, router, toasts } = setup("admin");

    const container = createAppContainer();
    container.bind(DefaultStatsService, () => new DefaultStatsService(stats.repository));
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultGroupsService, () => new DefaultGroupsService(groups));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfaces));
    container.bind(DefaultUsersService, () => new DefaultUsersService(users));
    container.bind(LiveStats, () => liveStats);
    container.bind(Session, () => session);
    container.bind(Router, () => router);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(StatsPage, {}, { container });
    await result.ready;

    const root = result.node as HTMLElement;

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".stat")).toHaveLength(4);
      expect(root.textContent).toContain("Разбивка по устройствам");
      expect(root.textContent).toContain("laptop");
    });

    expect(root.querySelector("h1")?.textContent).toBe("Статистика");
    expect(root.querySelector(".data-toolbar__actions")?.textContent).toContain("Обновить");
    expect(root.querySelector(".card--elevated svg")).not.toBeNull();
    expect(root.querySelector(".chip.is-selected")?.textContent).toContain("24 часа");
    expect(root.querySelectorAll(".table--fixed tbody tr")).toHaveLength(2);
    expect(root.querySelector('[data-label="Устройство"] .cell-avatar')?.textContent).toBe("L");
    expect(root.textContent).toContain("нет данных");

    result.dispose();
  });

  it("резолвится контейнером вместе с LiveStats", async () => {
    const container = createAppContainer();
    const tokens = new MemoryTokenStore();
    tokens.set("di-access", "di-refresh");
    container.bind(LocalTokenStore, () => tokens);

    const vm = await container.resolve(StatsVM);

    expect(vm).toBeInstanceOf(StatsVM);
    expect(await container.resolve(StatsVM)).toBe(vm);

    const live = await container.resolve<LiveStats>(LiveStats);
    live.connect("global");

    expect(FakeWebSocket.instances.at(-1)?.url).toContain("token=di-access");
  });
});

const PREVIOUS_POINTS: StatsPoint[] = [
  { at: "2019-12-31T00:00:00Z", rx: 2048, tx: 4096, rx_bps: 0, tx_bps: 0 },
];

const ZERO_POINTS: StatsPoint[] = [
  { at: "2019-12-31T00:00:00Z", rx: 0, tx: 0, rx_bps: 0, tx_bps: 0 },
];

describe("StatsVM: диапазон 90 дней и сравнение периодов", () => {
  it("поддерживает диапазон 90 дней", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();

    vm.setRange("90d");

    expect(vm.rangeKey).toBe("90d");
    expect(vm.periodLabel).toBe("90 дней");
    expect(vm.rangeSeconds).toBe(90 * 24 * 3600);
    await vi.waitFor(() => {
      const call = stats.series.mock.calls.at(-1);
      expect(call?.[0]).toBe("global");
      expect(call?.[1]).toBeNull();
      expect((call?.[3] ?? 0) - (call?.[2] ?? 0)).toBe(90 * 24 * 3600);
    });
  });

  it("запрашивает предыдущий период со сдвигом на длину диапазона", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();
    vm.compareEnabled = true;

    await vm.loadSeries();

    const calls = stats.series.mock.calls;
    expect(calls).toHaveLength(2);
    const current = calls[0];
    const previous = calls[1];
    expect(current).toBeDefined();
    expect(previous).toBeDefined();
    if (!current || !previous) return;
    expect(previous[0]).toBe(current[0]);
    expect(previous[1]).toBe(current[1]);
    expect(previous[3]).toBe(current[2] - 1);
    expect(previous[3] - previous[2]).toBe(24 * 3600);
  });

  it("считает проценты и подписи сравнения", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();
    vm.compareEnabled = true;
    vi.mocked(stats.series)
      .mockResolvedValueOnce(POINTS)
      .mockResolvedValueOnce(PREVIOUS_POINTS);

    await vm.loadSeries();

    expect(vm.previousTotals).toEqual({ rx: 2048, tx: 4096 });
    expect(vm.comparison.rx).toEqual({
      current: 4096,
      previous: 2048,
      deltaPercent: 100,
      direction: "up",
    });
    expect(vm.comparison.tx).toEqual({
      current: 2048,
      previous: 4096,
      deltaPercent: -50,
      direction: "down",
    });
    expect(vm.compareRxLabel).toBe("было 2.0 КБ · +100%");
    expect(vm.compareTxLabel).toBe("было 4.0 КБ · \u221250%");
    expect(vm.compareRxClass).toBe("stats-compare__delta--up");
    expect(vm.compareTxClass).toBe("stats-compare__delta--down");
  });

  it("возвращает null при нулевом предыдущем периоде и при равенстве", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();
    vm.compareEnabled = true;
    vi.mocked(stats.series)
      .mockResolvedValueOnce(POINTS)
      .mockResolvedValueOnce(ZERO_POINTS);

    await vm.loadSeries();

    expect(vm.comparison.rx.deltaPercent).toBeNull();
    expect(vm.comparison.rx.direction).toBe("flat");
    expect(vm.compareRxLabel).toBe("нет данных");

    vi.mocked(stats.series)
      .mockResolvedValueOnce(POINTS)
      .mockResolvedValueOnce(POINTS);

    await vm.loadSeries();

    expect(vm.comparison.rx.deltaPercent).toBe(0);
    expect(vm.comparison.rx.direction).toBe("flat");
    expect(vm.compareRxLabel).toBe("было 4.0 КБ · =");
  });

  it("выключение сравнения не ломает график и не запрашивает прошлый период", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vm.compareEnabled = true;
    await vm.loadSeries();
    vi.mocked(stats.series).mockClear();

    vm.toggleCompare();

    expect(vm.compareEnabled).toBe(false);
    expect(vm.previousTotals).toBeNull();
    expect(vm.previousError).toBeNull();

    await vm.loadSeries();

    expect(stats.series).toHaveBeenCalledTimes(1);
    expect(vm.series).toEqual(POINTS);
    expect(vm.error).toBeNull();
  });

  it("ошибка предыдущего периода не заполняет основную ошибку", async () => {
    const { vm, stats, toasts } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();
    vm.compareEnabled = true;
    vi.mocked(stats.series)
      .mockResolvedValueOnce(POINTS)
      .mockRejectedValueOnce(new Error("Нет истории"));

    await vm.loadSeries();

    expect(vm.error).toBeNull();
    expect(vm.series).toEqual(POINTS);
    expect(vm.previousError).toBe("Нет истории");
    expect(vm.previousTotals).toBeNull();
    expect(vm.comparison.rx.deltaPercent).toBeNull();
    expect(toasts.items).toHaveLength(0);
  });

  it("включает сравнение через toggleCompare", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vi.mocked(stats.series).mockClear();

    vm.toggleCompare();

    expect(vm.compareEnabled).toBe(true);
    await vi.waitFor(() => {
      expect(stats.series).toHaveBeenCalledTimes(1);
      expect(vm.previousTotals).toEqual({ rx: 4096, tx: 2048 });
      expect(vm.previousLoading).toBe(false);
      expect(vm.previousError).toBeNull();
    });
  });

  it("перезапрашивает предыдущий период при смене диапазона", async () => {
    const { vm, stats } = setup("admin");
    await vm.created();
    vm.compareEnabled = true;
    await vm.loadSeries();
    vi.mocked(stats.series).mockClear();

    vm.setRange("7d");

    await vi.waitFor(() => {
      expect(stats.series).toHaveBeenCalledTimes(2);
      const previous = stats.series.mock.calls.at(-1);
      expect(previous?.[3]).toBeDefined();
      expect((previous?.[3] ?? 0) - (previous?.[2] ?? 0)).toBe(7 * 24 * 3600);
    });
  });

  it("рендерит кнопку 90 дней и переключатель сравнения", async () => {
    const { stats, devices, groups, interfaces, users, liveStats, session, router, toasts } =
      setup("admin");

    const container = createAppContainer();
    container.bind(DefaultStatsService, () => new DefaultStatsService(stats.repository));
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultGroupsService, () => new DefaultGroupsService(groups));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfaces));
    container.bind(DefaultUsersService, () => new DefaultUsersService(users));
    container.bind(LiveStats, () => liveStats);
    container.bind(Session, () => session);
    container.bind(Router, () => router);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(StatsPage, {}, { container });
    document.body.append(result.node);
    await result.ready;

    const root = document.body;

    expect(root.textContent).toContain("90 дней");
    expect(root.textContent).toContain("Сравнить с прошлым периодом");
    const toggle = root.querySelector<HTMLButtonElement>(".stats-compare__toggle");
    expect(toggle).not.toBeNull();

    toggle?.click();

    await vi.waitFor(() => {
      const current = root.querySelector(".stats-compare__toggle");
      expect(current?.getAttribute("aria-pressed")).toBe("true");
      expect(root.textContent).toContain("было 4.0 КБ");
    });

    result.dispose();
    result.node.parentNode?.removeChild(result.node);
  });
});
