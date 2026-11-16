import { createComponent } from "@ivlev-dev/silent-core";

import { DefaultDevicesService } from "@/application/devices/service";
import { DefaultGroupsService } from "@/application/groups/service";
import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { AuthRepository } from "@/domain/auth/repository";
import type { DevicesRepository } from "@/domain/devices/repository";
import type { CreateShareInput, DeviceStats } from "@/domain/devices/types";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { Device, Group, Profile, Role, ShareLink, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { ClientDetails } from "./ClientDetails";
import { ClientDetailsVM } from "./ClientDetails.vm";

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

const GROUP: Group = {
  id: "g1",
  name: "Main",
  description: "",
  base_cidr: "10.0.0.0/24",
  forwarding_default: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
  interfaces: 1,
  devices: 2,
};

const DEVICE: Device = {
  id: "d1",
  user_id: "u2",
  group_id: "g1",
  name: "laptop",
  down_kbps: 1000,
  up_kbps: 500,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-01-01T00:00:00Z",
  peers: [
    {
      interface_id: "i1",
      interface_name: "wg0",
      public_key: "aaaaaaaaaaaa",
      addresses: ["10.0.0.2"],
    },
  ],
  addresses: ["10.0.0.2"],
};

const SIBLING: Device = {
  id: "d2",
  user_id: "u2",
  group_id: "g1",
  name: "phone",
  down_kbps: 0,
  up_kbps: 0,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-02-01T00:00:00Z",
  peers: [],
  addresses: ["10.0.0.3"],
};

const TABLET: Device = {
  id: "d3",
  user_id: "u2",
  group_id: "g1",
  name: "tablet",
  down_kbps: 0,
  up_kbps: 0,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-03-01T00:00:00Z",
  peers: [],
  addresses: ["10.0.0.4"],
};

const REVOKED: Device = {
  id: "d4",
  user_id: "u2",
  group_id: "g1",
  name: "old-laptop",
  down_kbps: 0,
  up_kbps: 0,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: true,
  created_at: "2019-01-01T00:00:00Z",
  peers: [],
  addresses: ["10.0.0.5"],
};

const FOREIGN: Device = {
  id: "d5",
  user_id: "u9",
  group_id: "g1",
  name: "stranger",
  down_kbps: 0,
  up_kbps: 0,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-04-01T00:00:00Z",
  peers: [],
  addresses: ["10.0.0.6"],
};

const PROFILE_1: Profile = {
  interface_id: "i1",
  interface_name: "wg0",
  node_id: "n1",
  endpoint: "vpn.example.com:51820",
  addresses: ["10.0.0.2"],
  conf: "[Interface]\nPrivateKey = key",
  vpn_link: "vpn://profile-1",
};

const PROFILE_2: Profile = {
  interface_id: "i2",
  interface_name: "wg1",
  node_id: "n1",
  endpoint: "vpn.example.com:51821",
  addresses: ["10.0.1.2"],
  conf: "[Interface]\nPrivateKey = key-2",
  vpn_link: "vpn://profile-2",
};

const SHARE: ShareLink = {
  token: "share-1",
  device_id: "d1",
  interface_id: "i1",
  format: "conf",
  expires_at: "2021-01-01T00:00:00Z",
  created_at: "2020-12-31T00:00:00Z",
  url: "https://example.com/share-1",
};

const STATS: DeviceStats = {
  device_id: "d1",
  today: { rx: 1024, tx: 2048 },
  month: { rx: 1048576, tx: 2097152 },
};

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

function makeSession(user: User): Session {
  const session = new Session(fakeAuth(user), new MemoryTokenStore());
  session.user = user;
  return session;
}

interface DevicesState {
  devices: Device[];
  profiles: Profile[];
  shares: ShareLink[];
  stats: DeviceStats;
}

function devicesHarness(): {
  repository: DevicesRepository;
  state: DevicesState;
} {
  const state: DevicesState = {
    devices: [{ ...DEVICE }, { ...SIBLING }],
    profiles: [{ ...PROFILE_1 }, { ...PROFILE_2 }],
    shares: [{ ...SHARE }],
    stats: { ...STATS },
  };

  const repository: DevicesRepository = {
    listDevices: vi.fn(async () => state.devices.map((device) => ({ ...device }))),
    getDevice: vi.fn(async (id: string) => {
      const device = state.devices.find((item) => item.id === id);
      if (!device) throw new Error(`404: устройство ${id} не найдено`);
      return { ...device };
    }),
    createDevice: vi.fn(async () => {
      throw new Error("createDevice is not used in this test");
    }),
    updateDevice: vi.fn(async (id, input) => {
      const index = state.devices.findIndex((item) => item.id === id);
      const current = state.devices[index];
      if (!current) throw new Error(`404: устройство ${id} не найдено`);
      const updated: Device = {
        ...current,
        ...input,
        forwarding: input.forwarding ?? current.forwarding,
      };
      state.devices[index] = updated;
      return { ...updated };
    }),
    deleteDevice: vi.fn(async (id: string) => {
      const index = state.devices.findIndex((item) => item.id === id);
      if (index >= 0) state.devices.splice(index, 1);
    }),
    listProfiles: vi.fn(async () => state.profiles.map((profile) => ({ ...profile }))),
    getProfile: vi.fn(async (_id: string, interfaceId: string) => {
      const profile = state.profiles.find((item) => item.interface_id === interfaceId);
      if (!profile) throw new Error(`404: профиль ${interfaceId} не найден`);
      return { ...profile };
    }),
    deviceStats: vi.fn(async () => ({ ...state.stats })),
    listShares: vi.fn(async () => state.shares.map((share) => ({ ...share }))),
    createShare: vi.fn(async (id: string, input: CreateShareInput) => {
      const share: ShareLink = {
        token: `share-${state.shares.length + 1}`,
        device_id: id,
        interface_id: input.interfaceId,
        format: input.format,
        expires_at: "2021-02-01T00:00:00Z",
        created_at: "2021-01-01T00:00:00Z",
        url: `https://example.com/share-${state.shares.length + 1}`,
      };
      state.shares = [share, ...state.shares];
      return { ...share };
    }),
    revokeShare: vi.fn(async (token: string) => {
      state.shares = state.shares.filter((share) => share.token !== token);
    }),
  };

  return { repository, state };
}

function groupsHarness(groups: Group[]): GroupsRepository {
  return {
    listGroups: vi.fn(async () => [...groups]),
    createGroup: vi.fn(async () => GROUP),
    updateGroup: vi.fn(async () => GROUP),
    deleteGroup: vi.fn(async () => undefined),
    listPools: vi.fn(async () => []),
    createPool: vi.fn(async () => {
      throw new Error("pool is not used in this test");
    }),
    updatePool: vi.fn(async () => {
      throw new Error("pool is not used in this test");
    }),
    deletePool: vi.fn(async () => undefined),
  };
}

function setup(role: Role = "admin") {
  const user = role === "admin" ? ADMIN : OWNER;
  const devices = devicesHarness();
  const groups = groupsHarness([GROUP]);
  const devicesService = new DefaultDevicesService(devices.repository);
  const groupsService = new DefaultGroupsService(groups);
  const session = makeSession(user);
  window.history.replaceState(null, "", "/clients/d1");
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new ClientDetailsVM(devicesService, groupsService, session, router, toasts);
  return {
    vm,
    repository: devices.repository,
    state: devices.state,
    devicesService,
    groupsService,
    groups,
    session,
    router,
    toasts,
  };
}

describe("ClientDetailsVM", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("загружает устройство, профили, ссылки, статистику и группы", async () => {
    const { vm, repository, groups } = setup("admin");

    await vm.load();

    expect(repository.getDevice).toHaveBeenCalledWith("d1");
    expect(repository.listProfiles).toHaveBeenCalledWith("d1");
    expect(repository.listShares).toHaveBeenCalledWith("d1");
    expect(repository.deviceStats).toHaveBeenCalledWith("d1");
    expect(repository.listDevices).toHaveBeenCalledTimes(1);
    expect(groups.listGroups).toHaveBeenCalledTimes(1);

    expect(vm.device?.name).toBe("laptop");
    expect(vm.profiles.map((profile) => profile.interface_id)).toEqual(["i1", "i2"]);
    expect(vm.activeProfileId).toBe("i1");
    expect(vm.activeProfile?.vpn_link).toBe("vpn://profile-1");
    expect(vm.shares).toHaveLength(1);
    expect(vm.stats?.device_id).toBe("d1");
    expect(vm.groups).toEqual([GROUP]);
    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
  });

  it("заполняет форму и показывает связанные значения", async () => {
    const { vm } = setup("admin");

    await vm.load();

    expect(vm.editName).toBe("laptop");
    expect(vm.editDown).toBe("1000");
    expect(vm.editUp).toBe("500");
    expect(vm.forwardingMode).toBe("off");
    expect(vm.forwardingSelected).toEqual([]);
    expect(vm.forwardingSymmetric).toBe(true);
    expect(vm.groupLabel).toBe("Main");
    expect(vm.downLabel).toBe("1 Мбит/с");
    expect(vm.upLabel).toBe("500 Кбит/с");
    expect(vm.forwardingLabel).toBe("Выключено");
    expect(vm.todayRx).toBe("1.0 КБ");
    expect(vm.todayTx).toBe("2.0 КБ");
    expect(vm.monthRx).toBe("1.0 МБ");
    expect(vm.monthTx).toBe("2.0 МБ");
    expect(vm.addresses).toEqual(["10.0.0.2"]);
    expect(vm.peers).toHaveLength(1);
    expect(vm.otherDevices.map((device) => device.id)).toEqual(["d2"]);
  });

  it("не запрашивает группы и показывает группу пользователя для обычного клиента", async () => {
    const { vm, groups } = setup("user");

    await vm.load();

    expect(groups.listGroups).not.toHaveBeenCalled();
    expect(vm.groups).toEqual([]);
    expect(vm.isAdmin).toBe(false);
    expect(vm.groupLabel).toBe("Ваша группа");
  });

  it("переключает активный профиль", async () => {
    const { vm } = setup("admin");
    await vm.load();

    vm.selectProfile("i2");

    expect(vm.activeProfileId).toBe("i2");
    expect(vm.activeProfile?.interface_name).toBe("wg1");
    expect(vm.interfaceName("i2")).toBe("wg1");
    expect(vm.interfaceName("i9")).toBe("i9");
  });

  it("получает отдельный профиль через DevicesService", async () => {
    const { devicesService, repository } = setup("admin");

    await expect(devicesService.getProfile("d1", "i2")).resolves.toEqual(PROFILE_2);
    expect(repository.getProfile).toHaveBeenCalledWith("d1", "i2");
    await expect(devicesService.getProfile("d1", "missing")).rejects.toThrow(
      "404: профиль missing не найден",
    );
  });

  it("показывает ошибку загрузки с сообщением 404", async () => {
    const { vm, repository, toasts } = setup("admin");
    vi.mocked(repository.getDevice).mockRejectedValueOnce(
      new Error("404: устройство d1 не найдено"),
    );

    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.device).toBeNull();
    expect(vm.error).toBe("404: устройство d1 не найдено");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "404: устройство d1 не найдено",
    });
  });

  it("подставляет сообщение по умолчанию, если сервис вернул не Error", async () => {
    const { vm, repository, toasts } = setup("admin");
    vi.mocked(repository.deviceStats).mockRejectedValueOnce({ status: 500 });

    await vm.load();

    expect(vm.error).toBe("Не удалось загрузить устройство");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Не удалось загрузить устройство",
    });
  });

  it("не загружает данные без идентификатора устройства", async () => {
    const { repository, groupsService } = setup("admin");
    window.history.replaceState(null, "", "/clients");
    const vm = new ClientDetailsVM(
      new DefaultDevicesService(repository),
      groupsService,
      makeSession(ADMIN),
      new Router(),
      new ToastStore(),
    );

    await vm.load();

    expect(vm.loading).toBe(false);
    expect(repository.getDevice).not.toHaveBeenCalled();
  });

  it("сохраняет имя, лимиты и режим «Все мои устройства»", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();

    vm.editName = "  renamed  ";
    vm.editDown = "2000";
    vm.editUp = "1000";
    vm.setForwardingMode("all");

    await vm.save();

    expect(repository.updateDevice).toHaveBeenCalledWith("d1", {
      name: "renamed",
      down_kbps: 2000,
      up_kbps: 1000,
      forwarding: { to_own_devices: true, allowed_devices: [] },
    });
    expect(vm.device?.name).toBe("renamed");
    expect(vm.editName).toBe("renamed");
    expect(vm.forwardingMode).toBe("all");
    expect(vm.forwardingLabel).toBe("Все свои устройства");
    expect(vm.forwardingRows.find((row) => row.id === "d1")?.mode).toBe("all");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Настройки сохранены",
    });
  });

  it("сохраняет режим «Только выбранные» со списком устройств", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();

    vm.setForwardingMode("selected");
    vm.toggleForwardingSelected("d2");

    await vm.save();

    expect(repository.updateDevice).toHaveBeenCalledWith("d1", {
      name: "laptop",
      down_kbps: 1000,
      up_kbps: 500,
      forwarding: { to_own_devices: false, allowed_devices: ["d2"] },
    });
    expect(vm.forwardingSelected).toEqual(["d2"]);
    expect(vm.forwardingLabel).toBe("Выбрано 1");
    const row = vm.forwardingRows.find((item) => item.id === "d1");
    expect(row?.mode).toBe("selected");
    expect(row?.allowed).toEqual(["d2"]);
  });

  it("сохраняет «Выключено» и очищает прежний список", async () => {
    const { vm, repository, state } = setup("admin");
    state.devices[0] = {
      ...DEVICE,
      forwarding: { to_own_devices: false, allowed_devices: ["d2"] },
    };
    await vm.load();
    expect(vm.forwardingMode).toBe("selected");
    expect(vm.forwardingSelected).toEqual(["d2"]);

    vm.setForwardingMode("off");

    await vm.save();

    expect(repository.updateDevice).toHaveBeenCalledWith("d1", {
      name: "laptop",
      down_kbps: 1000,
      up_kbps: 500,
      forwarding: { to_own_devices: false, allowed_devices: [] },
    });
    expect(vm.forwardingLabel).toBe("Выключено");
  });

  it("блокирует сохранение пустого списка и не даёт выбрать само устройство", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();

    vm.setForwardingMode("selected");

    expect(vm.forwardingError).toBe("Выберите хотя бы одно устройство или другой режим");
    expect(vm.canSave).toBe(false);

    await vm.save();

    expect(repository.updateDevice).not.toHaveBeenCalled();

    vm.toggleForwardingSelected("d1");
    expect(vm.forwardingSelected).toEqual([]);
    expect(vm.otherDevices.map((device) => device.id)).toEqual(["d2"]);

    vm.toggleForwardingSelected("d2");
    expect(vm.forwardingError).toBeNull();
    expect(vm.canSave).toBe(true);
  });

  it("строит матрицу только из активных устройств того же пользователя", async () => {
    const { vm, state } = setup("admin");
    state.devices.push({ ...REVOKED }, { ...FOREIGN });

    await vm.load();

    expect(vm.forwardingRows.map((row) => row.id)).toEqual(["d1", "d2"]);
    expect(vm.forwardingRows.every((row) => row.mode === "off")).toBe(true);
    expect(vm.isForwardingCellDisabled("d1", "d1")).toBe(true);
    expect(vm.isForwardingCellDisabled("d1", "d2")).toBe(true);
    expect(vm.otherDevices.map((device) => device.id)).toEqual(["d2"]);
    expect(vm.forwardingPairs).toEqual([
      {
        aId: "d1",
        bId: "d2",
        label: "laptop ↔ phone",
        allowed: false,
        detail: "запрещено",
        disabled: false,
      },
    ]);
    expect(vm.forwardingPairTitle("d1", "d2")).toBe("laptop ↔ phone: запрещено");
  });

  it("не переключает ячейки в режимах «Выключено» и «Все мои устройства»", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();

    await vm.toggleForwardingCell("d1", "d2");

    expect(repository.updateDevice).not.toHaveBeenCalled();

    await vm.setForwardingRowMode("d1", "all");

    expect(repository.updateDevice).toHaveBeenCalledWith("d1", {
      forwarding: { to_own_devices: true, allowed_devices: [] },
    });
    expect(vm.forwardingBulk).toBe(true);
    expect(vm.isForwardingCellChecked("d1", "d2")).toBe(true);
    expect(vm.isForwardingCellDisabled("d1", "d2")).toBe(true);
    expect(vm.forwardingPairs[0]?.disabled).toBe(true);

    vi.mocked(repository.updateDevice).mockClear();

    await vm.toggleForwardingCell("d1", "d2");

    expect(repository.updateDevice).not.toHaveBeenCalled();
  });

  it("симметрично включает пару и сохраняет обе строки", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();
    await vm.setForwardingRowMode("d1", "selected");
    await vm.setForwardingRowMode("d2", "selected");
    vi.mocked(repository.updateDevice).mockClear();

    await vm.toggleForwardingCell("d1", "d2");

    expect(repository.updateDevice).toHaveBeenCalledTimes(2);
    expect(repository.updateDevice).toHaveBeenNthCalledWith(1, "d1", {
      forwarding: { to_own_devices: false, allowed_devices: ["d2"] },
    });
    expect(repository.updateDevice).toHaveBeenNthCalledWith(2, "d2", {
      forwarding: { to_own_devices: false, allowed_devices: ["d1"] },
    });
    expect(vm.isForwardingCellChecked("d1", "d2")).toBe(true);
    expect(vm.isForwardingCellChecked("d2", "d1")).toBe(true);
    expect(vm.forwardingPairs[0]).toMatchObject({ allowed: true, detail: "разрешено" });
    expect(vm.forwardingPairTitle("d1", "d2")).toBe("laptop ↔ phone: разрешено");
  });

  it("при выключенной симметрии меняет только направление", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();
    await vm.setForwardingRowMode("d1", "selected");
    await vm.setForwardingRowMode("d2", "selected");
    vi.mocked(repository.updateDevice).mockClear();

    vm.setForwardingSymmetric({ target: { checked: false } } as unknown as Event);

    await vm.toggleForwardingCell("d1", "d2");

    expect(repository.updateDevice).toHaveBeenCalledTimes(1);
    expect(repository.updateDevice).toHaveBeenCalledWith("d1", {
      forwarding: { to_own_devices: false, allowed_devices: ["d2"] },
    });
    expect(vm.isForwardingCellChecked("d1", "d2")).toBe(true);
    expect(vm.isForwardingCellChecked("d2", "d1")).toBe(false);
  });

  it("откатывает строки при ошибке сохранения", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();
    await vm.setForwardingRowMode("d1", "selected");
    await vm.setForwardingRowMode("d2", "selected");
    vi.mocked(repository.updateDevice).mockClear();
    vi.mocked(repository.updateDevice).mockRejectedValueOnce(new Error("Сервис недоступен"));

    await vm.toggleForwardingCell("d1", "d2");

    expect(vm.isForwardingCellChecked("d1", "d2")).toBe(false);
    expect(vm.isForwardingCellChecked("d2", "d1")).toBe(false);
    expect(vm.forwardingRows.find((row) => row.id === "d1")?.allowed).toEqual([]);
    expect(vm.forwardingRows.find((row) => row.id === "d2")?.allowed).toEqual([]);
    expect(vm.forwardingBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сервис недоступен",
    });
  });

  it("сохраняет несколько строк и не трогает остальные устройства", async () => {
    const { vm, repository, state } = setup("admin");
    state.devices = [
      { ...DEVICE, forwarding: { to_own_devices: false, allowed_devices: ["d2"] } },
      { ...SIBLING, forwarding: { to_own_devices: false, allowed_devices: ["d1", "d3"] } },
      { ...TABLET, forwarding: { to_own_devices: false, allowed_devices: ["d2"] } },
    ];

    await vm.load();

    expect(vm.forwardingRows.map((row) => row.mode)).toEqual(["selected", "selected", "selected"]);
    expect(vm.isForwardingCellChecked("d1", "d2")).toBe(true);
    expect(vm.isForwardingCellChecked("d2", "d3")).toBe(true);
    expect(vm.isForwardingCellChecked("d1", "d3")).toBe(false);

    vi.mocked(repository.updateDevice).mockClear();

    await vm.toggleForwardingCell("d1", "d3");

    expect(repository.updateDevice).toHaveBeenCalledTimes(2);
    expect(repository.updateDevice).toHaveBeenNthCalledWith(1, "d1", {
      forwarding: { to_own_devices: false, allowed_devices: ["d2", "d3"] },
    });
    expect(repository.updateDevice).toHaveBeenNthCalledWith(2, "d3", {
      forwarding: { to_own_devices: false, allowed_devices: ["d1", "d2"] },
    });

    expect(state.devices.find((device) => device.id === "d2")?.forwarding).toEqual({
      to_own_devices: false,
      allowed_devices: ["d1", "d3"],
    });
    expect(vm.forwardingRows.find((row) => row.id === "d1")?.allowed).toEqual(["d2", "d3"]);
    expect(vm.forwardingRows.find((row) => row.id === "d3")?.allowed).toEqual(["d1", "d2"]);
    expect(vm.isForwardingCellChecked("d1", "d2")).toBe(true);
    expect(vm.isForwardingCellChecked("d2", "d3")).toBe(true);
    expect(vm.isForwardingCellChecked("d1", "d3")).toBe(true);
    expect(vm.isForwardingCellChecked("d3", "d1")).toBe(true);

    await vm.toggleForwardingCell("d1", "d3");

    expect(vm.forwardingRows.find((row) => row.id === "d1")?.allowed).toEqual(["d2"]);
    expect(vm.forwardingRows.find((row) => row.id === "d3")?.allowed).toEqual(["d2"]);
    expect(vm.isForwardingCellChecked("d1", "d3")).toBe(false);
  });

  it("включает пару из списка пар и переводит строки в «Только выбранные»", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();

    await vm.toggleForwardingPair("d1", "d2");

    expect(repository.updateDevice).toHaveBeenCalledTimes(2);
    expect(repository.updateDevice).toHaveBeenNthCalledWith(1, "d1", {
      forwarding: { to_own_devices: false, allowed_devices: ["d2"] },
    });
    expect(repository.updateDevice).toHaveBeenNthCalledWith(2, "d2", {
      forwarding: { to_own_devices: false, allowed_devices: ["d1"] },
    });
    expect(vm.forwardingRows.map((row) => row.mode)).toEqual(["selected", "selected"]);
    expect(vm.forwardingPairs[0]?.allowed).toBe(true);
  });

  it("не даёт точечно менять пару для строки «Все мои устройства»", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();
    await vm.setForwardingRowMode("d1", "all");
    vi.mocked(repository.updateDevice).mockClear();

    await vm.toggleForwardingPair("d1", "d2");

    expect(repository.updateDevice).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Отключите режим «Все мои устройства», чтобы настроить пару точечно",
    });
  });

  it("показывает ошибку сохранения", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();
    vi.mocked(repository.updateDevice).mockRejectedValueOnce(new Error("Сервис недоступен"));

    vm.editName = "renamed";

    await vm.save();

    expect(vm.saving).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сервис недоступен",
    });
  });

  it("отзывает устройство и возвращает к списку", async () => {
    const { vm, repository, router, toasts } = setup("admin");
    await vm.load();
    vi.stubGlobal("confirm", vi.fn(() => true));

    await vm.revoke();

    expect(repository.updateDevice).toHaveBeenCalledWith("d1", { revoked: true });
    expect(router.path).toBe("/clients");
    expect(vm.actionBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Устройство отозвано",
    });
  });

  it("удаляет устройство после подтверждения", async () => {
    const { vm, repository, router, toasts } = setup("admin");
    await vm.load();
    vi.stubGlobal("confirm", vi.fn(() => true));

    await vm.remove();

    expect(repository.deleteDevice).toHaveBeenCalledWith("d1");
    expect(router.path).toBe("/clients");
    expect(vm.actionBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Устройство удалено",
    });
  });

  it("не удаляет устройство без подтверждения", async () => {
    const { vm, repository } = setup("admin");
    await vm.load();
    vi.stubGlobal("confirm", vi.fn(() => false));

    await vm.remove();

    expect(repository.deleteDevice).not.toHaveBeenCalled();
  });

  it("показывает ошибку удаления", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.mocked(repository.deleteDevice).mockRejectedValueOnce(new Error("Сервис недоступен"));

    await vm.remove();

    expect(vm.actionBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сервис недоступен",
    });
  });

  it("создаёт временную ссылку", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();

    vm.setShareFormat("vpn");
    vm.setShareTtl("604800");

    await vm.createShare();

    expect(repository.createShare).toHaveBeenCalledWith("d1", {
      interfaceId: "i1",
      format: "vpn",
      ttlSecs: 604800,
    });
    expect(vm.shares).toHaveLength(2);
    expect(vm.shares[0]?.url).toBe("https://example.com/share-2");
    expect(vm.shareBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Временная ссылка создана",
    });
  });

  it("показывает ошибку создания ссылки", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();
    vi.mocked(repository.createShare).mockRejectedValueOnce(new Error("Сервис недоступен"));

    await vm.createShare();

    expect(vm.shares).toHaveLength(1);
    expect(vm.shareBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сервис недоступен",
    });
  });

  it("отзывает временную ссылку", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();

    await vm.revokeShare(SHARE.token);

    expect(repository.revokeShare).toHaveBeenCalledWith(SHARE.token);
    expect(vm.shares).toEqual([]);
    expect(vm.shareBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Ссылка отозвана",
    });
  });

  it("показывает ошибку отзыва ссылки", async () => {
    const { vm, repository, toasts } = setup("admin");
    await vm.load();
    vi.mocked(repository.revokeShare).mockRejectedValueOnce(new Error("Сервис недоступен"));

    await vm.revokeShare(SHARE.token);

    expect(vm.shares).toHaveLength(1);
    expect(vm.shareBusy).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сервис недоступен",
    });
  });

  it("резолвит VM через DI и монтирует представление с внедрёнными зависимостями", async () => {
    const { devicesService, groupsService, session, router, toasts } = setup("admin");
    const container = createAppContainer();
    container.bind(DefaultDevicesService, () => devicesService);
    container.bind(DefaultGroupsService, () => groupsService);
    container.bind(Session, () => session);
    container.bind(Router, () => router);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(ClientDetails, {}, { container });
    await result.ready;
    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("laptop");
    });

    expect(result.node.textContent).toContain("Матрица forwarding");
    expect(result.node.textContent).toContain("Симметрично");
    expect(result.node.textContent).toContain("Только выбранные");
    const root = result.node as Element;
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="forwarding-mode"]'));
    expect(radios).toHaveLength(3);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["off"]);
    const modes = Array.from(root.querySelectorAll<HTMLSelectElement>(".matrix-mode"));
    expect(modes).toHaveLength(2);
    expect(modes.every((select) => select.value === "off")).toBe(true);
    expect(root.querySelectorAll(".matrix-table input[type=checkbox]").length).toBeGreaterThan(0);

    result.dispose();
  });
});
