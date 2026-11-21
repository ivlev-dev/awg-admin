import { ApiError } from "@/domain/errors";
import { userMessage } from "@/application/errors";
import type { HttpClient } from "@/infrastructure/http/client";
import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import { HttpGroupsRepository } from "@/infrastructure/http/groups.repository";
import { HttpInterfacesRepository } from "@/infrastructure/http/interfaces.repository";
import { HttpQuotaRepository } from "@/infrastructure/http/quota.repository";
import { HttpStatsRepository } from "@/infrastructure/http/stats.repository";
import { HttpUsersRepository } from "@/infrastructure/http/users.repository";
import {
  readDevice,
  readDevices,
  readGroup,
  readGroups,
  readInterfaceInfo,
  readPool,
  readPools,
  readQuotaState,
  readShareLink,
  readStatsOverview,
  readStatsSeries,
  readUser,
  readUsers,
  readUserQuotas,
} from "@/infrastructure/http/response";

const DEVICE = {
  id: "d1",
  user_id: "u1",
  group_id: "g1",
  interface_id: "i1",
  interface_name: "wg0",
  node_id: "n1",
  node_name: "node-1",
  name: "laptop",
  down_kbps: 100,
  up_kbps: 50,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-01-01T00:00:00Z",
  peers: [],
  addresses: ["10.0.0.2"],
};

const USER = {
  id: "u1",
  full_name: null,
  email: "user@example.com",
  status: "active",
  totp_enabled: false,
  role: "admin",
  tariff_id: null,
  group_id: null,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const INTERFACE = {
  id: "i1",
  group_id: "g1",
  group_name: "main",
  node_id: "n1",
  node_name: "node-1",
  name: "wg0",
  label: "wg0",
  endpoint_host: "vpn.example.com",
  endpoint_port: 51820,
  listen_port: 51820,
  mtu: 1420,
  public_key: "key",
  obf: {
    h1: { lo: 1, hi: 2 },
    h2: { lo: 1, hi: 2 },
    h3: { lo: 1, hi: 2 },
    h4: { lo: 1, hi: 2 },
    s1: 1,
    s2: 2,
    s3: 3,
    s4: 4,
    header_protection_key: "",
    random_trailers: false,
  },
  enabled: true,
  peers: 1,
};

const SHARE = {
  token: "tok",
  device_id: "d1",
  interface_id: "i1",
  format: "conf",
  expires_at: "2020-01-01T00:00:00Z",
  created_at: "2020-01-01T00:00:00Z",
  used_at: null,
  max_uses: null,
  uses: 0,
  remaining_uses: null,
  revoked_at: null,
  state: "active",
  url: "https://example.com/s/tok",
};

const OVERVIEW = {
  today: { rx: 1, tx: 2 },
  month: { rx: 3, tx: 4 },
  rx_bps: 5.5,
  tx_bps: 6.5,
  nodes_online: 1,
  nodes_total: 2,
  interfaces: 3,
  groups: 4,
  devices: 5,
  users: 6,
  top_devices: [
    { device_id: "d1", name: "laptop", user_id: "u1", rx: 7, tx: 8, online: true },
  ],
  unexpected: "игнорируется",
};

const SERIES = [
  { at: "2024-01-01T00:00:00Z", rx: 1, tx: 2, rx_bps: 3.5, tx_bps: 4.5, extra: true },
];

const QUOTA = {
  used_bytes: 10,
  quota_bytes: 100,
  exceeded: false,
  remaining_bytes: 90,
  percent: 10,
  period_start: "2024-01-01T00:00:00Z",
  period_end: "2024-02-01T00:00:00Z",
  reset_at: "2024-02-01T00:00:00Z",
};

const USER_QUOTA = {
  user_id: "u1",
  email: "user@example.com",
  used_bytes: 10,
  quota_bytes: null,
  exceeded: false,
  percent: null,
};

const GROUP = {
  id: "g1",
  name: "main",
  description: "",
  base_cidr: "10.0.0.0/24",
  forwarding_default: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
  interfaces: 0,
  devices: 0,
};

const POOL = {
  id: "p1",
  group_id: "g1",
  name: "pool",
  cidr: "10.0.0.0/25",
  mode: "auto",
  gateway: null,
  enabled: true,
};

function expectInvalidResponse(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) {
      expect(error.code).toBe("invalid_response");
      return error;
    }
    throw error;
  }
  throw new Error("expected ApiError");
}

describe("runtime-валидация ответов", () => {
  it("принимает корректные DTO", () => {
    expect(readDevice(DEVICE)).toEqual(DEVICE);
    expect(readDevices([DEVICE, DEVICE])).toHaveLength(2);
    expect(readUser(USER)).toEqual(USER);
    expect(readUsers([USER])).toHaveLength(1);
    expect(readInterfaceInfo(INTERFACE)).toEqual(INTERFACE);
    expect(readShareLink(SHARE)).toEqual(SHARE);
    expect(readStatsOverview(OVERVIEW)).toEqual(OVERVIEW);
    expect(readStatsSeries(SERIES)).toEqual(SERIES);
    expect(readQuotaState(QUOTA)).toEqual(QUOTA);
    expect(readUserQuotas([USER_QUOTA])).toEqual([USER_QUOTA]);
    expect(readGroup(GROUP)).toEqual(GROUP);
    expect(readGroups([GROUP, GROUP])).toHaveLength(2);
    expect(readPool(POOL)).toEqual(POOL);
    expect(readPools([POOL])).toEqual([POOL]);
  });

  it("игнорирует лишние поля в ответах статистики, квот и групп", () => {
    expect(readStatsOverview(OVERVIEW)).toMatchObject({ devices: 5, users: 6 });
    expect(readStatsSeries(SERIES)[0]).toMatchObject({ rx: 1, tx: 2 });
    expect(readUserQuotas([{ ...USER_QUOTA, full_name: "Иван" }])[0]).toMatchObject({
      email: "user@example.com",
    });
    expect(readGroup({ ...GROUP, extra: true })).toMatchObject({ name: "main" });
    expect(readPool({ ...POOL, extra: true })).toMatchObject({ mode: "auto" });
  });

  it("отклоняет StatsOverview без обязательных полей", () => {
    const missedTodayRx = expectInvalidResponse(() =>
      readStatsOverview({ ...OVERVIEW, today: { tx: 2 } }),
    );
    expect(missedTodayRx.message).toContain("stats.today.rx");
    expectInvalidResponse(() => readStatsOverview({ ...OVERVIEW, top_devices: null }));
    expectInvalidResponse(() =>
      readStatsOverview({
        ...OVERVIEW,
        top_devices: [{ device_id: "d1", name: "laptop", user_id: "u1", rx: 1, tx: 2, online: "yes" }],
      }),
    );
  });

  it("отклоняет StatsSeries без rx_bps", () => {
    const error = expectInvalidResponse(() =>
      readStatsSeries([{ at: "2024-01-01T00:00:00Z", rx: 1, tx: 2, tx_bps: 3 }]),
    );
    expect(error.message).toContain("stats.series[0].rx_bps");
    expectInvalidResponse(() => readStatsSeries({ points: [] }));
  });

  it("отклоняет квоты без обязательных полей", () => {
    expectInvalidResponse(() => readQuotaState({ ...QUOTA, used_bytes: "10" }));
    expectInvalidResponse(() => readQuotaState({ ...QUOTA, quota_bytes: "100" }));
    expectInvalidResponse(() => readUserQuotas([{ ...USER_QUOTA, email: null }]));
    expectInvalidResponse(() => readUserQuotas([{ ...USER_QUOTA, full_name: 42 }]));
  });

  it("отклоняет Group и Pool с неверными полями", () => {
    expectInvalidResponse(() => readGroup({ ...GROUP, devices: "0" }));
    const poolError = expectInvalidResponse(() => readPool({ ...POOL, mode: "manual" }));
    expect(poolError.message).toContain("pool.mode");
    expectInvalidResponse(() => readPool({ ...POOL, gateway: 10 }));
  });

  it("отклоняет InterfaceInfo без ключа обфускации", () => {
    const obf = { ...INTERFACE.obf, header_protection_key: undefined };
    expectInvalidResponse(() => readInterfaceInfo({ ...INTERFACE, obf }));
  });

  it("отклоняет Device без обязательных полей", () => {
    expectInvalidResponse(() => readDevice({ ...DEVICE, id: 42 }));
    expectInvalidResponse(() => readDevice({ ...DEVICE, peers: null }));
  });

  it("отклоняет User с неверным статусом и ролью", () => {
    expectInvalidResponse(() => readUser({ ...USER, status: "unknown" }));
    expectInvalidResponse(() => readUser({ ...USER, role: "guest" }));
    expectInvalidResponse(() => readUser({ ...USER, email: 7 }));
    expectInvalidResponse(() => readUser({ ...USER, full_name: 7 }));
    expect(readUser({ ...USER, full_name: null })).toMatchObject({ full_name: null });
  });

  it("отклоняет InterfaceInfo без obf и портов", () => {
    expectInvalidResponse(() => readInterfaceInfo({ ...INTERFACE, obf: null }));
    expectInvalidResponse(() => readInterfaceInfo({ ...INTERFACE, endpoint_port: "51820" }));
  });

  it("отклоняет ShareLink с неверным форматом", () => {
    expectInvalidResponse(() => readShareLink({ ...SHARE, format: "json" }));
    expectInvalidResponse(() => readShareLink({ ...SHARE, uses: null }));
  });

  it("показывает локализованный fallback вместо undefined в UI", () => {
    const error = expectInvalidResponse(() => readDevice({}));
    expect(userMessage(error, "Не удалось загрузить устройство")).toBe(
      "Не удалось загрузить устройство",
    );
  });
});

describe("репозитории проверяют ответы", () => {
  function clientWith(payload: unknown): HttpClient {
    return {
      get: vi.fn(async () => payload),
      post: vi.fn(async () => payload),
      patch: vi.fn(async () => payload),
      put: vi.fn(async () => payload),
      delete: vi.fn(async () => payload),
    } as unknown as HttpClient;
  }

  it("devices repository отклоняет битый ответ", async () => {
    const repository = new HttpDevicesRepository(clientWith({ id: "d1" }));
    await expect(repository.getDevice("d1")).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(repository.listDevices()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("users repository отклоняет битый ответ", async () => {
    const repository = new HttpUsersRepository(clientWith([{ id: "u1" }]));
    await expect(repository.listUsers()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("interfaces repository отклоняет битый ответ", async () => {
    const repository = new HttpInterfacesRepository(clientWith([{ id: "i1" }]));
    await expect(repository.listInterfaces()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("stats repository проверяет overview и series", async () => {
    const valid = new HttpStatsRepository(clientWith(OVERVIEW));
    await expect(valid.overview()).resolves.toMatchObject({ today: OVERVIEW.today });

    const brokenOverview = new HttpStatsRepository(clientWith({ today: { rx: 1 } }));
    await expect(brokenOverview.overview()).rejects.toMatchObject({
      code: "invalid_response",
    });

    const brokenSeries = new HttpStatsRepository(clientWith([{ at: "2024-01-01T00:00:00Z" }]));
    await expect(brokenSeries.series("global", null, 0, 1)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("quota repository отклоняет битый ответ", async () => {
    const repository = new HttpQuotaRepository(clientWith({ used_bytes: 1 }));
    await expect(repository.me()).rejects.toMatchObject({ code: "invalid_response" });
    await expect(repository.users()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("groups repository проверяет группы и пулы", async () => {
    const valid = new HttpGroupsRepository(clientWith([GROUP]));
    await expect(valid.listGroups()).resolves.toEqual([GROUP]);

    const brokenGroups = new HttpGroupsRepository(clientWith([{ id: "g1" }]));
    await expect(brokenGroups.listGroups()).rejects.toMatchObject({
      code: "invalid_response",
    });

    const brokenPools = new HttpGroupsRepository(clientWith([{ ...POOL, mode: "manual" }]));
    await expect(brokenPools.listPools("g1")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
