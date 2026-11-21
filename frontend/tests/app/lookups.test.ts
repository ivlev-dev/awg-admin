import {
  clearLookups,
  invalidate,
  lookupInterfaces,
  lookupOwnerDevices,
  lookupQuotas,
  lookupTariffs,
  lookupUsers,
} from "@/app/lookups";
import type { Page } from "@/domain/page";
import type { Device, InterfaceInfo, Tariff, User } from "@/domain/types";

const INTERFACE: InterfaceInfo = {
  id: "i1",
  group_id: "g1",
  group_name: "Main",
  node_id: "n1",
  node_name: "node-1",
  name: "wg0",
  label: "",
  public_key: "pk",
  endpoint_host: "vpn.example.com",
  endpoint_port: 51820,
  listen_port: 51820,
  mtu: 1420,
  peers: 1,
  enabled: true,
  obf: {
    h1: { lo: 1, hi: 2 },
    h2: { lo: 1, hi: 2 },
    h3: { lo: 1, hi: 2 },
    h4: { lo: 1, hi: 2 },
    s1: 1,
    s2: 2,
    s3: 3,
    s4: 4,
    header_protection_key: "hk",
    random_trailers: true,
  },
};

const USER: User = {
  id: "u1",
  full_name: null,
  role: "user",
  tariff_id: null,
  group_id: null,
  node_id: null,
  email: "user@example.com",
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const DEVICE: Device = {
  id: "d1",
  user_id: USER.id,
  group_id: "g1",
  interface_id: "i1",
  interface_name: "wg0",
  node_id: "n1",
  node_name: "node-1",
  name: "laptop",
  down_kbps: 0,
  up_kbps: 0,
  addresses: ["10.0.0.2"],
  peers: [],
  revoked: false,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  created_at: "2020-01-01T00:00:00Z",
};

function interfacesService() {
  return {
    listInterfaces: vi.fn(async () => [INTERFACE]),
    createInterface: vi.fn(),
    updateInterface: vi.fn(),
    rotateInterface: vi.fn(),
    deleteInterface: vi.fn(),
    bulk: vi.fn(),
  };
}

function usersService() {
  return {
    listUsers: vi.fn(async () => [USER]),
    pageUsers: vi.fn(),
    listPending: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetPassword: vi.fn(),
    approveUser: vi.fn(),
    rejectUser: vi.fn(),
    bulk: vi.fn(),
  };
}

afterEach(() => {
  clearLookups();
  vi.useRealTimers();
});

describe("lookups", () => {
  it("дедуплицирует параллельные вызовы одного справочника", async () => {
    const service = interfacesService();

    const [first, second] = await Promise.all([
      lookupInterfaces(service),
      lookupInterfaces(service),
    ]);

    expect(first).toEqual([INTERFACE]);
    expect(second).toBe(first);
    expect(service.listInterfaces).toHaveBeenCalledTimes(1);
  });

  it("кэширует результат и не повторяет запрос в пределах TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = interfacesService();

    await lookupInterfaces(service);
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    await lookupInterfaces(service);
    expect(service.listInterfaces).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    await lookupInterfaces(service);
    expect(service.listInterfaces).toHaveBeenCalledTimes(2);
  });

  it("invalidate сбрасывает нужный вид и не трогает остальные", async () => {
    const iface = interfacesService();
    const users = usersService();

    await Promise.all([lookupInterfaces(iface), lookupUsers(users)]);
    invalidate("interfaces", iface);
    await Promise.all([lookupInterfaces(iface), lookupUsers(users)]);

    expect(iface.listInterfaces).toHaveBeenCalledTimes(2);
    expect(users.listUsers).toHaveBeenCalledTimes(1);
  });

  it("не кэширует ошибку", async () => {
    const service = interfacesService();
    service.listInterfaces.mockRejectedValueOnce(new Error("boom"));

    await expect(lookupInterfaces(service)).rejects.toThrow("boom");
    await expect(lookupInterfaces(service)).resolves.toEqual([INTERFACE]);
    expect(service.listInterfaces).toHaveBeenCalledTimes(2);
  });

  it("кэш изолирован по экземпляру сервиса", async () => {
    const first = interfacesService();
    const second = interfacesService();

    await lookupInterfaces(first);
    await lookupInterfaces(second);

    expect(first.listInterfaces).toHaveBeenCalledTimes(1);
    expect(second.listInterfaces).toHaveBeenCalledTimes(1);
  });

  it("загружает устройства владельца страницами и кэширует их", async () => {
    const pageDevices = vi.fn(async (params: { limit: number; offset: number }): Promise<Page<Device>> => {
      const all = [DEVICE, { ...DEVICE, id: "d2" }];
      return {
        items: all.slice(params.offset, params.offset + params.limit),
        total: all.length,
        limit: params.limit,
        offset: params.offset,
      };
    });
    const service = { pageDevices };

    const [first, second] = await Promise.all([
      lookupOwnerDevices(service as never, USER.id),
      lookupOwnerDevices(service as never, USER.id),
    ]);

    expect(first.map((device) => device.id)).toEqual(["d1", "d2"]);
    expect(second).toBe(first);
    expect(pageDevices).toHaveBeenCalledTimes(1);
    expect(pageDevices.mock.calls[0]?.[0]).toMatchObject({ userId: USER.id, limit: 200, offset: 0 });
  });
});

describe("lookupQuotas", () => {
  it("шарит список квот между вызовами", async () => {
    const users = vi.fn(async () => [
      {
        user_id: USER.id,
        email: USER.email,
        used_bytes: 0,
        quota_bytes: null,
        exceeded: false,
        percent: null,
      },
    ]);
    const service = { users, me: vi.fn(), forUser: vi.fn() };

    await lookupQuotas(service as never);
    await lookupQuotas(service as never);

    expect(users).toHaveBeenCalledTimes(1);
  });
});

describe("lookupTariffs", () => {
  it("возвращает тарифы из кэша", async () => {
    const tariff: Tariff = {
      id: "t1",
      name: "Basic",
      description: "",
      max_devices: 10,
      device_down_kbps: 0,
      device_up_kbps: 0,
      group_down_kbps: 0,
      group_up_kbps: 0,
      traffic_quota_bytes: null,
      interface_id: null,
      interface_name: null,
      created_at: "2020-01-01T00:00:00Z",
      updated_at: "2020-01-01T00:00:00Z",
    };
    const listTariffs = vi.fn(async () => [tariff]);
    const service = { listTariffs, createTariff: vi.fn(), updateTariff: vi.fn(), deleteTariff: vi.fn(), bulk: vi.fn() };

    await lookupTariffs(service as never);
    await lookupTariffs(service as never);

    expect(listTariffs).toHaveBeenCalledTimes(1);
  });
});
