import { createComponent, flushSync } from "@ivlev-dev/silent-core";

import { DefaultDevicesService } from "@/application/devices/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultUsersService } from "@/application/users/service";
import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { AuthRepository } from "@/domain/auth/repository";
import type { DevicesRepository } from "@/domain/devices/repository";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { UsersRepository } from "@/domain/users/repository";
import type { Device, Group, InterfaceInfo, Role, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { setLocale } from "@/i18n";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { ClientsPageVM, clientsFiltersStorage } from "@/features/clients/ClientsPage.vm";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_options: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);

const ADMIN: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
  node_id: null,
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
  node_id: "n1",
  email: null,
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const MEMBER: User = {
  ...OWNER,
  id: "u3",
  login: "member",
  node_id: "n2",
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

const INTERFACE: InterfaceInfo = {
  id: "i1",
  group_id: "g1",
  group_name: "Main",
  node_id: "n1",
  node_name: "node-1",
  name: "wg0",
  label: "",
  endpoint_host: "vpn.example.com",
  endpoint_port: 51820,
  listen_port: 51820,
  mtu: 1420,
  public_key: "pub-1",
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

const INTERFACE_2: InterfaceInfo = {
  ...INTERFACE,
  id: "i2",
  node_id: "n2",
  node_name: "node-2",
  name: "wg1",
  public_key: "pub-2",
};

const INTERFACE_3: InterfaceInfo = {
  ...INTERFACE,
  id: "i3",
  name: "wg2",
  public_key: "pub-3",
};

const DEVICE: Device = {
  id: "d1",
  user_id: "u2",
  group_id: "g1",
  interface_id: "i1",
  interface_name: "wg0",
  node_id: "n1",
  node_name: "node-1",
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
  interface_id: "i2",
  interface_name: "wg1",
  node_id: "n2",
  node_name: "node-2",
  addresses: ["10.0.0.3"],
  peers: [],
};

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
        interface_id: input.interface_id ?? "",
        interface_name: input.interface_id === "i2" ? "wg1" : "wg0",
        node_id: input.interface_id === "i2" ? "n2" : "n1",
        node_name: input.interface_id === "i2" ? "node-2" : "node-1",
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
    revokeAllShares: vi.fn(async () => 0),
    bulk: vi.fn(async (action, ids) => {
      if (action === "delete") {
        for (const id of ids) {
          const index = devices.findIndex((item) => item.id === id);
          if (index >= 0) devices.splice(index, 1);
        }
      }
      return { done: ids.length, failed: [] };
    }),
  };
  return { repository, devices };
}

function interfacesHarness(items: InterfaceInfo[]): InterfacesRepository {
  return {
    listInterfaces: vi.fn(async () => [...items]),
    createInterface: vi.fn(async () => INTERFACE),
    updateInterface: vi.fn(async () => INTERFACE),
    rotateInterface: vi.fn(async () => INTERFACE),
    deleteInterface: vi.fn(async () => undefined),
    bulk: vi.fn(async (_action, ids) => ({ done: ids.length, failed: [] })),
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
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
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

function setup(
  role: Role = "admin",
  seed: Device[] = [DEVICE],
  items: InterfaceInfo[] = [INTERFACE, INTERFACE_2],
  accounts: User[] = [ADMIN, OWNER],
) {
  const user = role === "admin" ? ADMIN : OWNER;
  const devices = devicesHarness(seed);
  const interfaces = interfacesHarness(items);
  const users = usersHarness(accounts);
  const session = makeSession(user);
  window.history.replaceState(null, "", "/clients");
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new ClientsPageVM(
    new DefaultDevicesService(devices.repository),
    new DefaultInterfacesService(interfaces),
    new DefaultUsersService(users),
    session,
    router,
    toasts,
  );
  return { vm, devices, interfaces, users, session, router, toasts };
}

describe("ClientsPageVM", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    confirmMock.askConfirm.mockReset();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    setLocale("ru");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("загружает устройства, интерфейсы и пользователей для администратора", async () => {
    const { vm, devices, interfaces, users } = setup("admin");

    await vm.load();

    expect(devices.repository.listDevices).toHaveBeenCalledTimes(1);
    expect(interfaces.listInterfaces).toHaveBeenCalledTimes(1);
    expect(users.listUsers).toHaveBeenCalledTimes(1);
    expect(vm.devices).toHaveLength(1);
    expect(vm.interfaces).toEqual([INTERFACE, INTERFACE_2]);
    expect(vm.interfaceOptions).toEqual([
      { value: "i1", label: "wg0 · node-1" },
      { value: "i2", label: "wg1 · node-2" },
    ]);
    expect(vm.users).toHaveLength(2);
    expect(vm.loading).toBe(false);
    expect(vm.countLabel).toBe("Найдено 1 из 1");
  });

  it("не запрашивает пользователей, но загружает интерфейсы для обычного пользователя", async () => {
    const { vm, interfaces, users } = setup("user");

    await vm.load();

    expect(interfaces.listInterfaces).toHaveBeenCalledTimes(1);
    expect(users.listUsers).not.toHaveBeenCalled();
    expect(vm.interfaces).toHaveLength(2);
    expect(vm.users).toEqual([]);
    expect(vm.isAdmin).toBe(false);
    expect(vm.formInterfaceOptions).toEqual([{ value: "i1", label: "wg0 · node-1" }]);
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
      message: "Не удалось загрузить устройства",
    });
  });

  it("создаёт устройство и перезагружает список", async () => {
    const { vm, devices, toasts } = setup("admin");
    await vm.load();

    vm.openCreate();
    vm.formName = " Pixel ";
    vm.setFormUser(OWNER.id);
    vm.toggleFormInterface(INTERFACE.id);
    vm.setFormDownKbps(1500);
    vm.setFormUpKbps(750);
    vm.formForwarding = true;

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith({
      user_id: "u2",
      group_id: "g1",
      interface_id: "i1",
      interface_ids: ["i1"],
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

  it("хранит лимиты в кбит/с и нормализует значения", async () => {
    const { vm, devices } = setup("admin");
    await vm.load();

    vm.openCreate();
    vm.formName = "Round";
    vm.setFormUser(OWNER.id);
    vm.toggleFormInterface(INTERFACE.id);
    vm.setFormDownKbps(1500.4);
    vm.setFormUpKbps(-10);

    expect(vm.formDownKbps).toBe(1500);
    expect(vm.formUpKbps).toBe(0);

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({ down_kbps: 1500, up_kbps: 0 }),
    );
  });

  it("ограничивает интерфейсы формы нодой выбранного пользователя", async () => {
    const { vm } = setup("admin", [DEVICE], [INTERFACE, INTERFACE_2], [ADMIN, OWNER, MEMBER]);
    await vm.load();

    vm.openCreate();
    expect(vm.formInterfaceOptions).toHaveLength(2);

    vm.setFormUser(OWNER.id);
    expect(vm.formInterfaceOptions).toEqual([{ value: "i1", label: "wg0 · node-1" }]);

    vm.setFormUser(MEMBER.id);
    expect(vm.formInterfaceOptions).toEqual([{ value: "i2", label: "wg1 · node-2" }]);

    vm.setFormUser(ADMIN.id);
    expect(vm.formInterfaceOptions).toHaveLength(2);
  });

  it("показывает все интерфейсы, если нода пользователя не задана", async () => {
    const { vm } = setup("admin", [DEVICE], [INTERFACE, INTERFACE_2], [ADMIN, { ...OWNER, node_id: null }]);
    await vm.load();

    vm.openCreate();
    vm.setFormUser(OWNER.id);

    expect(vm.formInterfaceOptions).toHaveLength(2);
  });

  it("сбрасывает интерфейс другой ноды при смене пользователя", async () => {
    const { vm } = setup("admin", [DEVICE], [INTERFACE, INTERFACE_2], [ADMIN, OWNER, MEMBER]);
    await vm.load();

    vm.openCreate();
    vm.setFormUser(MEMBER.id);
    expect(vm.formInterfaceIds).toEqual([INTERFACE_2.id]);

    vm.setFormUser(OWNER.id);
    expect(vm.formInterfaceIds).toEqual([INTERFACE.id]);
  });

  it("создаёт устройство для собственного аккаунта обычного пользователя", async () => {
    const { vm, devices, toasts } = setup("user");
    await vm.load();

    vm.openCreate();
    expect(vm.formUserId).toBe(OWNER.id);
    expect(vm.formInterfaceIds).toEqual([INTERFACE.id]);
    vm.formName = "Phone";
    vm.toggleFormInterface(INTERFACE.id);

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: OWNER.id,
        group_id: GROUP.id,
        interface_id: INTERFACE.id,
        name: "Phone",
      }),
    );
    expect(toasts.items.at(-1)).toMatchObject({ kind: "success" });
  });

  it("не создаёт устройство без выбранного интерфейса", async () => {
    const { vm, devices, toasts } = setup("admin", [DEVICE], [
      INTERFACE,
      { ...INTERFACE_2, node_id: "n1", node_name: "node-1" },
    ]);
    await vm.load();

    vm.openCreate();
    vm.formName = "Pixel";
    vm.setFormUser(OWNER.id);

    expect(vm.formInterfaceOptions).toHaveLength(2);
    expect(vm.formInterfaceIds).toEqual([]);
    expect(vm.canCreate).toBe(false);
    await vm.create();

    expect(devices.repository.createDevice).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Выберите хотя бы один интерфейс для устройства",
    });
  });

  it("подставляет единственный интерфейс ноды пользователя", async () => {
    const { vm, devices } = setup("admin", [DEVICE], [INTERFACE]);
    await vm.load();

    vm.openCreate();
    vm.formName = "Pixel";
    vm.setFormUser(OWNER.id);

    expect(vm.formInterfaceIds).toEqual([INTERFACE.id]);
    expect(vm.canCreate).toBe(true);

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({ interface_id: INTERFACE.id }),
    );
  });

  it("создаёт устройство сразу на нескольких интерфейсах", async () => {
    const { vm, devices } = setup("admin", [DEVICE], [INTERFACE, INTERFACE_3]);
    await vm.load();

    vm.openCreate();
    vm.formName = "Multi";
    vm.setFormUser(OWNER.id);

    expect(vm.formInterfacesPinned).toBe(false);
    expect(vm.formInterfaceIds).toEqual([]);
    vm.toggleFormInterface(INTERFACE_3.id);
    vm.toggleFormInterface(INTERFACE.id);

    expect(vm.selectedFormInterfaceIds).toEqual(["i1", "i3"]);
    expect(vm.formTunnelsLabel).toBe("Будет создано туннелей: 2");

    await vm.create();

    expect(devices.repository.createDevice).toHaveBeenCalledWith({
      user_id: OWNER.id,
      group_id: GROUP.id,
      interface_id: "i1",
      interface_ids: ["i1", "i3"],
      name: "Multi",
      down_kbps: 0,
      up_kbps: 0,
      forwarding: { to_own_devices: false, allowed_devices: [] },
    });
  });

  it("не создаёт устройство, если снять все интерфейсы", async () => {
    const { vm, devices, toasts } = setup("admin", [DEVICE], [INTERFACE, INTERFACE_3]);
    await vm.load();

    vm.openCreate();
    vm.formName = "Multi";
    vm.setFormUser(OWNER.id);
    vm.toggleFormInterface(INTERFACE.id);
    vm.toggleFormInterface(INTERFACE.id);

    expect(vm.selectedFormInterfaceIds).toEqual([]);
    expect(vm.canCreate).toBe(false);

    await vm.create();

    expect(devices.repository.createDevice).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Выберите хотя бы один интерфейс для устройства",
    });
  });

  it("показывает закреплённый интерфейс выбранным и недоступным", async () => {
    const { vm } = setup("admin", [DEVICE], [INTERFACE]);
    await vm.load();

    vm.openCreate();
    vm.setFormUser(OWNER.id);

    expect(vm.formInterfacesPinned).toBe(true);
    expect(vm.pinnedFormInterfaceId).toBe(INTERFACE.id);
    expect(vm.selectedFormInterfaceIds).toEqual([INTERFACE.id]);

    const option = vm.filteredFormInterfaceOptions[0];
    expect(option).toMatchObject({
      value: INTERFACE.id,
      disabled: true,
      hint: "Закреплён",
    });
    expect(vm.isFormInterfaceSelected(INTERFACE.id)).toBe(true);

    vm.toggleFormInterface(INTERFACE.id);
    expect(vm.selectedFormInterfaceIds).toEqual([INTERFACE.id]);
  });

  it("блокирует интерфейсы другой группы и фильтрует список поиском", async () => {
    const otherGroup: InterfaceInfo = { ...INTERFACE_3, id: "i4", name: "wg3", group_id: "g2" };
    const { vm } = setup("admin", [DEVICE], [INTERFACE, INTERFACE_3, otherGroup]);
    await vm.load();

    vm.openCreate();
    vm.setFormUser(OWNER.id);
    vm.toggleFormInterface(INTERFACE.id);

    expect(vm.formInterfaceGroupId).toBe(GROUP.id);
    expect(vm.isFormInterfaceDisabled(INTERFACE_3.id)).toBe(false);
    expect(vm.isFormInterfaceDisabled(otherGroup.id)).toBe(true);
    expect(vm.formInterfaceHint(otherGroup.id)).toBe("Другая группа");
    vm.toggleFormInterface(otherGroup.id);
    expect(vm.selectedFormInterfaceIds).toEqual([INTERFACE.id]);

    vm.setFormInterfaceQuery({ target: { value: "wg2" } } as unknown as Event);
    expect(vm.filteredFormInterfaceOptions.map((option) => option.value)).toEqual(["i3"]);

    vm.setFormInterfaceQuery({ target: { value: "" } } as unknown as Event);
    expect(vm.filteredFormInterfaceOptions).toHaveLength(3);
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
    vm.toggleFormInterface(INTERFACE.id);

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

  it("отслеживает несохранённые данные формы создания", () => {
    const { vm } = setup("admin");

    vm.openCreate();
    expect(vm.formDirty).toBe(false);

    vm.setFormName({ target: { value: "Pixel" } } as unknown as Event);
    expect(vm.formDirty).toBe(true);

    vm.formDownKbps = 100;
    expect(vm.formDirty).toBe(true);

    vm.setFormDownKbps(0);
    expect(vm.formDirty).toBe(true);

    vm.setFormName({ target: { value: "" } } as unknown as Event);
    expect(vm.formDirty).toBe(false);
  });

  it("закрывает форму создания без подтверждения, если данные не менялись", async () => {
    const { vm } = setup("admin");
    vm.openCreate();

    await vm.closeCreate();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(vm.createOpen).toBe(false);
    expect(vm.formDirty).toBe(false);
  });

  it("оставляет форму открытой при отказе от закрытия", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const { vm } = setup("admin");
    vm.openCreate();
    vm.formName = "Pixel";

    await vm.closeCreate();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Несохранённые данные",
      message: "Закрыть форму? Введённые данные не сохранятся.",
      confirmLabel: "Закрыть без сохранения",
      tone: "danger",
    });
    expect(vm.createOpen).toBe(true);
    expect(vm.formName).toBe("Pixel");
  });

  it("закрывает форму создания после подтверждения и сбрасывает снимок", async () => {
    const { vm } = setup("admin");
    vm.openCreate();
    vm.formName = "Pixel";

    await vm.closeCreate();

    expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);
    expect(vm.createOpen).toBe(false);
    expect(vm.formDirty).toBe(false);
  });

  it("сбрасывает снимок формы после успешного создания", async () => {
    const { vm } = setup("admin");
    await vm.load();
    vm.openCreate();
    vm.formName = "Pixel";
    vm.setFormUser(OWNER.id);
    vm.toggleFormInterface(INTERFACE.id);

    await vm.create();

    expect(vm.createOpen).toBe(false);
    expect(vm.formDirty).toBe(false);
  });

  it("фильтрует устройства по запросу и интерфейсу, учитывая пиры", async () => {
    const { vm } = setup("admin", [DEVICE, PHONE]);
    await vm.load();

    vm.interfaceFilter = "i1";
    vm.query = "10.0.1.2";
    vm.appliedQuery = "10.0.1.2";
    expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d1"]);
    expect(vm.hasActiveFilters).toBe(true);

    vm.query = "";
    vm.appliedQuery = "";
    expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d1"]);

    vm.setInterfaceFilter("i2");
    expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d1", "d2"]);

    vm.query = "10.0.1.2";
    vm.appliedQuery = "10.0.1.2";
    expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d1"]);

    vm.setInterfaceFilter("");
    expect(vm.filteredDevices.map((device) => device.id)).toEqual(["d1"]);

    vm.query = "missing";
    vm.appliedQuery = "missing";
    expect(vm.filteredDevices).toEqual([]);
  });

  it("восстанавливает поиск и интерфейс из storage", () => {
    localStorage.setItem(
      clientsFiltersStorage.key,
      JSON.stringify({ query: "phone", interfaceFilter: "i2" }),
    );

    const { vm } = setup("admin", [DEVICE, PHONE]);

    expect(vm.query).toBe("phone");
    expect(vm.appliedQuery).toBe("phone");
    expect(vm.interfaceFilter).toBe("i2");
  });

  it("не применяет сохранённый интерфейс, если он не выбран", async () => {
    localStorage.setItem(
      clientsFiltersStorage.key,
      JSON.stringify({ query: "", interfaceFilter: "" }),
    );

    const { vm } = setup("user", [DEVICE, PHONE]);
    await vm.load();

    expect(vm.interfaceFilter).toBe("");
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
        JSON.stringify({ query: "phone", interfaceFilter: "" }),
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
    vm.setInterfaceFilter("i2");
    expect(localStorage.getItem(clientsFiltersStorage.key)).not.toBeNull();

    vm.resetFilters();

    expect(vm.query).toBe("");
    expect(vm.appliedQuery).toBe("");
    expect(vm.interfaceFilter).toBe("");
    expect(vm.hasActiveFilters).toBe(false);
    expect(localStorage.getItem(clientsFiltersStorage.key)).toBeNull();
    expect(vm.filteredDevices).toHaveLength(2);
  });

  it("подставляет логин, интерфейс, ноду и пиров", async () => {
    const { vm } = setup("admin");
    await vm.load();

    expect(vm.userEmail("u2")).toBe("owner");
    expect(vm.userEmail("unknown")).toBe("—");
    expect(vm.interfaceSummary(DEVICE)).toBe("wg0 · node-1");
    expect(vm.interfaceSummary({ ...DEVICE, interface_name: "", node_name: "" })).toBe("—");
    expect(vm.interfaceNames(DEVICE)).toBe("wg0, wg1");
    expect(vm.tunnelCount(DEVICE)).toBe(2);
    expect(vm.tunnelsLabel(DEVICE)).toBe("2 туннеля");
    expect(vm.interfaceNameList(DEVICE)).toEqual(["wg0", "wg1"]);
    expect(vm.tunnelCount(PHONE)).toBe(1);
    expect(vm.tunnelsLabel(PHONE)).toBe("1 туннель");
    expect(vm.interfaceNames(PHONE)).toBe("wg1");
  });

  it("переключает язык заголовка и таблицы", async () => {
    const devices = devicesHarness([DEVICE]);
    const container = createAppContainer();
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfacesHarness([INTERFACE, INTERFACE_2])));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersHarness([ADMIN, OWNER])));
    container.bind(Session, () => makeSession(ADMIN));
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(ClientsPage, {}, { container });
    await result.ready;

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Устройства");
      expect(result.node.textContent).toContain("Устройства AmneziaWG");
      expect(result.node.textContent).toContain("Владелец");
    });

    setLocale("en");

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Devices");
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
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfacesHarness([INTERFACE, INTERFACE_2])));
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
    expect(labels).toContain("Интерфейс");
    expect(labels).toContain("Статус");
    expect(root.querySelector("td[data-label='Владелец'] .cell-stack")).not.toBeNull();
    expect(root.querySelector("td[data-label='Интерфейс']")?.textContent).toContain("wg0");
    expect(root.querySelector("td[data-label='Интерфейс']")?.textContent).toContain("node-1");
    expect(root.querySelector("td[data-label='Интерфейс']")?.textContent).toContain("2 туннеля");
    expect(root.querySelectorAll("td[data-label='Интерфейс'] .badge.badge--gray")).toHaveLength(2);
    expect(root.querySelector(".entity-card__sub")?.textContent).toContain("wg0 · node-1");
    expect(root.querySelector(".entity-card__meta")?.textContent).toContain("node-1");
    expect(root.querySelector("tbody tr td.cell-actions button")).not.toBeNull();

    result.dispose();
  });

  it("навигирует по строкам таблицы с клавиатуры", async () => {
    const devices = devicesHarness([DEVICE, PHONE]);
    const container = createAppContainer();
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfacesHarness([INTERFACE, INTERFACE_2])));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersHarness([ADMIN, OWNER])));
    container.bind(Session, () => makeSession(ADMIN));
    const router = new Router();
    container.bind(Router, () => router);
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(ClientsPage, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);

    await vi.waitFor(() => {
      expect(document.body.querySelectorAll("tbody tr[tabindex]").length).toBe(2);
    });

    const rows = Array.from(document.body.querySelectorAll<HTMLTableRowElement>("tbody tr[tabindex]"));
    const first = rows[0];
    const second = rows[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error("rows are not rendered");
    expect(first.getAttribute("data-device")).toBe("d1");
    expect(second.getAttribute("data-device")).toBe("d2");

    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(second);

    second.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(first);

    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(router.path).toBe("/clients/d1");

    second.focus();
    second.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(router.path).toBe("/clients/d2");

    const checkbox = second.querySelector("input");
    expect(checkbox).not.toBeNull();
    checkbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(router.path).toBe("/clients/d2");

    result.dispose();
  });

  it("резолвится контейнером без ручных привязок", async () => {
    const container = createAppContainer();

    const vm = await container.resolve(ClientsPageVM);

    expect(vm).toBeInstanceOf(ClientsPageVM);
    expect(await container.resolve(ClientsPageVM)).toBe(vm);
  });

  it("рендерит закреплённый интерфейс в мультивыборе создания", async () => {
    const devices = devicesHarness([DEVICE]);
    const container = createAppContainer();
    container.bind(DefaultDevicesService, () => new DefaultDevicesService(devices.repository));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfacesHarness([INTERFACE, INTERFACE_2])));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersHarness([ADMIN, OWNER])));
    container.bind(Session, () => makeSession(OWNER));
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(ClientsPage, {}, { container });
    await result.ready;
    const root = result.node as ParentNode;

    await vi.waitFor(() => {
      expect(root.querySelector("[data-device]")).not.toBeNull();
    });

    const newButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Новое устройство"),
    );
    expect(newButton).toBeDefined();
    document.body.appendChild(result.node);
    newButton?.click();
    flushSync();

    await vi.waitFor(() => {
      expect(document.body.querySelector(".interface-checklist")).not.toBeNull();
    });

    const inputs = Array.from(
      document.body.querySelectorAll<HTMLInputElement>(".interface-checklist input[type=checkbox]"),
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.checked).toBe(true);
    expect(inputs[0]?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Закреплён");
    expect(document.body.textContent).toContain("Будет создано туннелей: 1");

    result.dispose();
    document.body.replaceChildren();
  });

  describe("массовые действия", () => {
    it("удаляет выбранных клиентов одним bulk-запросом", async () => {
      const { vm, devices, toasts } = setup("admin", [DEVICE, PHONE]);
      await vm.load();
      vm.selectedIds = [DEVICE.id, PHONE.id];

      await vm.bulkDelete();

      expect(confirmMock.askConfirm).toHaveBeenCalledWith({
        title: "Удаление устройств",
        message: "Удалить выбранные записи (2)?",
        confirmLabel: "Удалить",
        tone: "danger",
      });
      expect(devices.repository.bulk).toHaveBeenCalledTimes(1);
      expect(devices.repository.bulk).toHaveBeenCalledWith("delete", [DEVICE.id, PHONE.id]);
      expect(devices.repository.listDevices).toHaveBeenCalledTimes(2);
      expect(vm.devices).toEqual([]);
      expect(vm.selectedIds).toEqual([]);
      expect(vm.bulkBusy).toBe(false);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "success",
        message: "Готово: 2, ошибок: 0",
      });
    });

    it("отзывает ссылки одним bulk-запросом", async () => {
      const { vm, devices, toasts } = setup("admin", [DEVICE, PHONE]);
      await vm.load();
      vm.selectedIds = [DEVICE.id, PHONE.id];

      await vm.bulkRevokeShares();

      expect(devices.repository.bulk).toHaveBeenCalledTimes(1);
      expect(devices.repository.bulk).toHaveBeenCalledWith("revoke_shares", [
        DEVICE.id,
        PHONE.id,
      ]);
      expect(devices.repository.listShares).not.toHaveBeenCalled();
      expect(devices.repository.revokeAllShares).not.toHaveBeenCalled();
      expect(vm.selectedIds).toEqual([]);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "success",
        message: "Готово: 2, ошибок: 0",
      });
    });

    it("показывает ошибку при частичном сбое, но учитывает выполненные", async () => {
      const { vm, devices, toasts } = setup("admin", [DEVICE, PHONE]);
      await vm.load();
      vi.mocked(devices.repository.bulk).mockResolvedValueOnce({
        done: 1,
        failed: [{ id: PHONE.id, error: "Устройство занято" }],
      });
      vm.selectedIds = [DEVICE.id, PHONE.id];

      await vm.bulkRevokeShares();

      expect(devices.repository.bulk).toHaveBeenCalledTimes(1);
      expect(vm.selectedIds).toEqual([]);
      expect(vm.bulkBusy).toBe(false);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "error",
        message: "Готово: 1, ошибок: 1",
      });
    });

    it("не выполняет массовое удаление при отказе от подтверждения", async () => {
      confirmMock.askConfirm.mockResolvedValueOnce(false);
      const { vm, devices, toasts } = setup("admin", [DEVICE]);
      await vm.load();
      vm.selectedIds = [DEVICE.id];

      await vm.bulkDelete();

      expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);
      expect(devices.repository.bulk).not.toHaveBeenCalled();
      expect(vm.selectedIds).toEqual([DEVICE.id]);
      expect(toasts.items).toEqual([]);
    });

    it("не вызывает bulk без выбранных клиентов", async () => {
      const { vm, devices } = setup("admin", [DEVICE]);
      await vm.load();

      await vm.bulkDelete();
      await vm.bulkRevokeShares();

      expect(devices.repository.bulk).not.toHaveBeenCalled();
    });
  });
});
