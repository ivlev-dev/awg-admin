import { ApiError } from "@/domain/errors";
import { userMessage } from "@/application/errors";
import type { HttpClient } from "@/infrastructure/http/client";
import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import { HttpInterfacesRepository } from "@/infrastructure/http/interfaces.repository";
import { HttpUsersRepository } from "@/infrastructure/http/users.repository";
import {
  readDevice,
  readDevices,
  readInterfaceInfo,
  readShareLink,
  readUser,
  readUsers,
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
});
