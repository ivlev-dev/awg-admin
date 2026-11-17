import { createComponent } from "@ivlev-dev/silent-core";

import { DefaultDevicesService } from "@/application/devices/service";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultUsersService } from "@/application/users/service";
import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { AuthRepository } from "@/domain/auth/repository";
import type { DevicesRepository } from "@/domain/devices/repository";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { UsersRepository } from "@/domain/users/repository";
import type { Device, Group, Role, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { setLocale } from "@/i18n";
import { ClientsPage } from "./ClientsPage";
import { ClientsPageVM, clientsFiltersStorage } from "./ClientsPage.vm";

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

const GROUP: Group = {
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
    {
      interface_id: "i2",
      interface_name: "wg1",
      public_key: "bbbbbbbbbbbb",
      addresses: ["10.0.1.2"],
    },
  ],
  addresses: ["10.0.0.2", "10.0.1.2"],
};

const PHONE: Device = {
  ...DEVICE,
  id: "d2",
  name: "phone",
  addresses: ["10.0.0.3"],
  peers: [],
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
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
  };
}

function makeSession(user: User): Session {
  const session = new Session(fakeAuth(user), new MemoryTokenStore());
  session.user = user;
  return session;
}

function devicesHarness(initial: Device[]): {
  repository: DevicesRepository;
  devices: Device[];
} {
  const devices = initial.map((device) => ({ ...device }));
  const repository: DevicesRepository = {
    listDevices: vi.fn(async () => [...devices]),
    getDevice: vi.fn(async (id: string) => {
      const device = devices.find((item) => item.id === id);
      if (!device) throw new Error(`404: устройство ${id} не найдено`);
      return device;
    }),
    createDevice: vi.fn(async (input) => {
      const created: Device = {
        id: `d${devices.length + 1}`,
        user_id: input.user_id ?? "",
        group_id: input.group_id ?? "",
        name: input.name,
        down_kbps: input.down_kbps,
        up_kbps: input.up_kbps,
        forwarding: input.forwarding ?? { to_own_devices: false, allowed_devices: [] },
        revoked: false,
        created_at: "2021-01-01T00:00:00Z",
        peers: [],
        addresses: [],
      };
      devices.push(created);
      return created;
    }),
    updateDevice: vi.fn(async (id, input) => {
      const index = devices.findIndex((item) => item.id === id);
      const current = devices[index];
      if (!current) throw new Error(`404: устройство ${id} не найдено`);
      const updated: Device = {
        ...current,
        ...input,
        forwarding: input.forwarding ?? current.forwarding,
      };
      devices[index] = updated;
      return updated;
    }),
    deleteDevice: vi.fn(async (id: string) => {
      const index = devices.findIndex((item) => item.id === id);
      if (index >= 0) devices.splice(index, 1);
    }),
    listProfiles: vi.fn(async () => []),
    getProfile: vi.fn(async () => {
      throw new Error("profile is not used in this test");
    }),
    deviceStats: vi.fn(async (id: string) => ({
      device_id: id,
      today: { rx: 0, tx: 0 },
      month: { rx: 0, tx: 0 },
    })),
    listShares: vi.fn(async () => []),
    createShare: vi.fn(async () => {
      throw new Error("share is not used in this test");
    }),
    revokeShare: vi.fn(async () => undefined),
  };
  return { repository, devices };
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

function usersHarness(users: User[]): UsersRepository {
  return {
    listUsers: vi.fn(async () => [...users]),
    createUser: vi.fn(async () => OWNER),
    updateUser: vi.fn(async () => OWNER),
    deleteUser: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    listPending: vi.fn(async () => []),
    approveUser: vi.fn(async () => OWNER),
    rejectUser: vi.fn(async () => OWNER),
  };
}

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

function setup(role: Role = "admin", seed: Device[] = [DEVICE]) {
  const user = role === "admin" ? ADMIN : OWNER;
  const devices = devicesHarness(seed);
  const groups = groupsHarness([GROUP]);
  const users = usersHarness([ADMIN, OWNER]);
  const session = makeSession(user);
  window.history.replaceState(null, "", "/clients");
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new ClientsPageVM(
    new DefaultDevicesService(devices.repository),
    new DefaultGroupsService(groups),
    new DefaultUsersService(users),
    session,
    router,
    toasts,
  );
  return { vm, devices, groups, users, session, router, toasts };
}

describe("ClientsPageVM", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    setLocale("ru");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("загружает устройства, группы и пользователей для администратора", async () => {
    const { vm, devices, groups, users } = setup("admin");

    await vm.load();

    expect(devices.repository.listDevices).toHaveBeenCalledTimes(1);
    expect(groups.listGroups).toHaveBeenCalledTimes(1);
    expect(users.listUsers).toHaveBeenCalledTimes(1);
    expect(vm.devices).toHaveLength(1);
    expect(vm.groups).toEqual([GROUP]);
    expect(vm.users).toHaveLength(2);
    expect(vm.loading).toBe(false);
    expect(vm.countLabel).toBe("Найдено 1 из 1");
  });

  it("не запрашивает группы и пользователей для обычного пользователя", async () => {
    const { vm, groups, users } = setup("user");

    await vm.load();

    expect(groups.listGroups).not.toHaveBeenCalled();
    expect(users.listUsers).not.toHaveBeenCalled();
    expect(vm.groups).toEqual([]);
    expect(vm.users).toEqual([]);
    expect(vm.isAdmin).toBe(false);
  });

  it("показывает ошибку загрузки и сбрасывает состояние загрузки", async () => {
    const { vm, devices, toasts } = setup("admin");
    vi.mocked(devices.repository.listDevices).mockRejectedValueOnce(new Error("Сервис недоступен"));

    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.devices).toEqual([]);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сервис недоступен",
    });
  });

  it("подставляет сообщение по умолчанию для неизвестной ошибки", async () => {
    const { vm, devices, toasts } = setup("admin");
    vi.mocked(devices.repository.listDevices).mockRejectedValueOnce("boom");

    await vm.load();

    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Не удалось загрузить клиентов",
    });
  });

  it("создаёт устройство и перезагружает список", async () => {
    const { vm, devices, toasts } = setup("admin");
    await vm.load();

    vm.openCreate();
    vm.formName = " Pixel ";
    vm.setFormUser(OWNER.id);
    vm.setFormGroup(GROUP.id);
    vm.formDown = "1500";
    vm.formUp = "750";
    vm.formForwarding = true;

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith({
      user_id: "u2",
      group_id: "g1",
      name: "Pixel",
      down_kbps: 1500,
      up_kbps: 750,
      forwarding: { to_own_devices: true, allowed_devices: [] },
    });
    expect(devices.repository.listDevices).toHaveBeenCalledTimes(2);
    expect(vm.devices).toHaveLength(2);
    expect(vm.createOpen).toBe(false);
    expect(vm.submitting).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Устройство «Pixel» создано",
    });
  });

  it("создаёт устройство для собственного аккаунта обычного пользователя", async () => {
    const { vm, devices, toasts } = setup("user");
    await vm.load();

    vm.openCreate();
    expect(vm.formUserId).toBe(OWNER.id);
    vm.formName = "Phone";

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: OWNER.id,
        group_id: GROUP.id,
        name: "Phone",
      }),
    );
    expect(toasts.items.at(-1)).toMatchObject({ kind: "success" });
  });

  it("показывает ошибку создания и оставляет форму открытой", async () => {
    const { vm, devices, toasts } = setup("admin");
    await vm.load();
    vi.mocked(devices.repository.createDevice).mockRejectedValueOnce(
      new Error("Имя устройства уже занято"),
    );

    vm.openCreate();
    vm.formName = "Pixel";
    vm.setFormUser(OWNER.id);

    await vm.create();

    expect(vm.createOpen).toBe(true);
    expect(vm.submitting).toBe(false);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Имя устройства уже занято",
    });
  });

  it("не отправляет форму без имени устройства", async () => {
    const { vm, devices } = setup("admin");
    await vm.load();

    vm.openCreate();
    vm.formName = "   ";

    expect(vm.canCreate).toBe(false);
    await vm.create();
    expect(devices.repository.createDevice).not.toHaveBeenCalled();
  });

  it("открывает карточку устройства через роутер", () => {
    const { vm, router } = setup("admin");

    vm.openDevice("d1");

    expect(router.path).toBe("/clients/d1");
  });

  it("фильтрует устройства по запросу и группе", async () => {
    const { vm } = setup("admin", [DEVICE, PHONE]);
    await vm.load();

    vm.groupFilter = "g1";
    vm.query = "10.0.1.2";
    vm.appliedQuery = "10.0.1.2";
    expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d1"]);
    expect(vm.hasActiveFilters).toBe(true);

    vm.query = "missing";
    vm.appliedQuery = "missing";
    expect(vm.filteredDevices).toEqual([]);
  });

  it("восстанавливает поиск и группу из storage", () => {
    localStorage.setItem(
      clientsFiltersStorage.key,
      JSON.stringify({ query: "phone", groupFilter: "g1" }),
    );

    const { vm } = setup("admin", [DEVICE, PHONE]);

    expect(vm.query).toBe("phone");
    expect(vm.appliedQuery).toBe("phone");
    expect(vm.groupFilter).toBe("g1");
  });

  it("не применяет сохранённую группу для обычного пользователя", async () => {
    localStorage.setItem(
      clientsFiltersStorage.key,
      JSON.stringify({ query: "", groupFilter: "g1" }),
    );

    const { vm } = setup("user", [DEVICE, PHONE]);
    await vm.load();

    expect(vm.groupFilter).toBe("");
    expect(vm.filteredDevices).toHaveLength(2);
  });

  it("применяет поиск после debounce и сохраняет запрос сразу", async () => {
    vi.useFakeTimers();
    try {
      const { vm } = setup("admin", [DEVICE, PHONE]);
      await vm.load();

      vm.setQuery({ target: { value: "phone" } } as unknown as Event);

      expect(vm.query).toBe("phone");
      expect(vm.filteredDevices).toHaveLength(2);
      expect(localStorage.getItem(clientsFiltersStorage.key)).toBe(
        JSON.stringify({ query: "phone", groupFilter: "" }),
      );

      vi.advanceTimersByTime(249);
      expect(vm.filteredDevices).toHaveLength(2);

      vi.advanceTimersByTime(1);
      expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("сбрасывает фильтры и очищает storage", async () => {
    const { vm } = setup("admin", [DEVICE, PHONE]);
    await vm.load();

    vm.setQuery({ target: { value: "phone" } } as unknown as Event);
    vm.setGroupFilter("g1");
    expect(localStorage.getItem(clientsFiltersStorage.key)).not.toBeNull();

    vm.resetFilters();

    expect(vm.query).toBe("");
    expect(vm.appliedQuery).toBe("");
    expect(vm.groupFilter).toBe("");
    expect(vm.hasActiveFilters).toBe(false);
    expect(localStorage.getItem(clientsFiltersStorage.key)).toBeNull();
    expect(vm.filteredDevices).toHaveLength(2);
  });

  it("подставляет логин, имя группы и пиров", async () => {
    const { vm } = setup("admin");
    await vm.load();

    expect(vm.userLogin("u2")).toBe("owner");
    expect(vm.userLogin("unknown")).toBe("—");
    expect(vm.groupName(null)).toBe("Без группы");
    expect(vm.groupName("g1")).toBe("Main");
    expect(vm.groupName("g9")).toBe("g9");
    expect(vm.peersLabel(DEVICE)).toBe("2 пира");
    expect(vm.interfaceNames(DEVICE)).toBe("wg0, wg1");
  });

  it("переключает язык заголовка и таблицы", async () => {
    const devices = devicesHarness([DEVICE]);
    const container = createAppContainer();
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultGroupsService, () => new DefaultGroupsService(groupsHarness([GROUP])));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersHarness([ADMIN, OWNER])));
    container.bind(Session, () => makeSession(ADMIN));
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(ClientsPage, {}, { container });
    await result.ready;

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Клиенты");
      expect(result.node.textContent).toContain("Устройства AmneziaWG");
      expect(result.node.textContent).toContain("Владелец");
    });

    setLocale("en");

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Clients");
      expect(result.node.textContent).toContain("AmneziaWG devices");
      expect(result.node.textContent).toContain("Owner");
    });
    expect(result.node.textContent).not.toContain("Устройства AmneziaWG");

    result.dispose();
  });

  it("помечает таблицу клиентов для мобильных карточек", async () => {
    const devices = devicesHarness([DEVICE]);
    const container = createAppContainer();
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultGroupsService, () => new DefaultGroupsService(groupsHarness([GROUP])));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersHarness([ADMIN, OWNER])));
    container.bind(Session, () => makeSession(ADMIN));
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(ClientsPage, {}, { container });
    await result.ready;

    const root = result.node as ParentNode;

    await vi.waitFor(() => {
      expect(root.querySelector("table.table--clients")).not.toBeNull();
    });

    const table = root.querySelector("table.table--clients");
    expect(table?.classList.contains("table--cards")).toBe(true);
    expect(root.querySelector(".table-wrap--cards")).not.toBeNull();

    const labels = Array.from(root.querySelectorAll("td[data-label]")).map((cell) =>
      cell.getAttribute("data-label"),
    );
    expect(labels).toContain("Устройство");
    expect(labels).toContain("Владелец");
    expect(labels).toContain("Статус");
    expect(root.querySelector("td[data-label='Владелец'] .cell-stack")).not.toBeNull();
    expect(root.querySelector("tbody tr td.cell-actions button")).not.toBeNull();

    result.dispose();
  });

  it("резолвится контейнером без ручных привязок", async () => {
    const container = createAppContainer();

    const vm = await container.resolve(ClientsPageVM);

    expect(vm).toBeInstanceOf(ClientsPageVM);
    expect(await container.resolve(ClientsPageVM)).toBe(vm);
  });
});
