import { DefaultAuthService } from "@/application/auth/service";
import { DefaultDevicesService } from "@/application/devices/service";
import { ValidationError } from "@/application/errors";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultImportService } from "@/application/import/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService } from "@/application/nodes/service";
import { DefaultSettingsService } from "@/application/settings/service";
import { DefaultStatsService } from "@/application/stats/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { DevicesRepository } from "@/domain/devices/repository";
import { pageDevicesFromList } from "@/domain/devices/query";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { ImportRepository } from "@/domain/import/repository";
import type {
  ClientsApplyResult,
  ClientsApplyResultWire,
  ClientsPreview,
  ClientsPreviewWire,
  ImportApplyResult,
  ImportInput,
  ImportPreview,
  ImportPreviewWire,
} from "@/domain/import/types";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { SettingsRepository } from "@/domain/settings/repository";
import type { StatsRepository } from "@/domain/stats/repository";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { UsersRepository } from "@/domain/users/repository";
import { pageUsersFromList } from "@/domain/users/query";
import type {
  AuthSession,
  CidrPool,
  Device,
  Group,
  ImportResult,
  InterfaceInfo,
  NodeInfo,
  Overview,
  Settings,
  StatsPoint,
  Tariff,
  User,
} from "@/domain/types";

const USER: User = {
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

const SESSION: AuthSession = {
  token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  user: USER,
};

const TARIFF: Tariff = {
  id: "t1",
  name: "Basic",
  description: "",
  max_devices: 2,
  device_down_kbps: 100,
  device_up_kbps: 50,
  group_down_kbps: 200,
  group_up_kbps: 100,
  traffic_quota_bytes: null,
  interface_id: null,
  interface_name: null,
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
  interfaces: 0,
  devices: 0,
};

const POOL: CidrPool = {
  id: "p1",
  group_id: "g1",
  name: "pool",
  cidr: "10.0.1.0/24",
  mode: "auto",
  gateway: null,
  enabled: true,
};

const NODE: NodeInfo = {
  id: "n1",
  name: "node",
  status: "online",
  online: true,
  last_seen: null,
  version: null,
  interfaces: 0,
};

const INTERFACE: InterfaceInfo = {
  id: "i1",
  group_id: "g1",
  group_name: "Main",
  node_id: "n1",
  node_name: "node",
  name: "wg0",
  label: "",
  endpoint_host: "vpn.example.com",
  endpoint_port: 51820,
  listen_port: 51820,
  mtu: 1420,
  public_key: "pk",
  obf: {
    h1: { lo: 100000, hi: 100100 },
    h2: { lo: 1000000, hi: 1000100 },
    h3: { lo: 2000000, hi: 2000100 },
    h4: { lo: 3000000, hi: 3000100 },
    s1: 12,
    s2: 12,
    s3: 12,
    s4: 12,
    header_protection_key: "hpk",
    random_trailers: false,
  },
  enabled: true,
  peers: 0,
};

const DEVICE: Device = {
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
  addresses: [],
};

const SETTINGS: Settings = {
  obfuscation: {
    profile: "http3",
    intensity: "medium",
    browser: "chrome",
    mtu: 1420,
    jc_min: 3,
    jc_max: 4,
    jmin_min: 10,
    jmin_max: 20,
    jmax_extra_min: 0,
    jmax_extra_max: 10,
    s_min: 12,
    s_max: 20,
    hosts: [],
    random_trailers: false,
    disable_cookies: false,
    keepalive_min: 15,
    keepalive_max: 25,
  },
  share_default_ttl_secs: 3600,
};

function makeAuth(): AuthRepository {
  return {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
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

describe("AuthService", () => {
  it("trims credentials and delegates login", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);
    await expect(service.login({ login: " admin ", password: "secret" })).resolves.toBe(SESSION);
    expect(repo.login).toHaveBeenCalledWith({ login: "admin", password: "secret" });
  });

  it("rejects empty credentials", async () => {
    const service = new DefaultAuthService(makeAuth());
    await expect(service.login({ login: " ", password: "secret" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.login({ login: "admin", password: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("does not call logout without a refresh token", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);
    await service.logout(null);
    expect(repo.logout).not.toHaveBeenCalled();
  });

  it("rejects a short new password", async () => {
    const service = new DefaultAuthService(makeAuth());
    await expect(service.changePassword("old", "short")).rejects.toBeInstanceOf(ValidationError);
  });

  it("registers with a normalized email and an optional login", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await expect(
      service.register({ email: " user@example.com ", login: " user ", password: "secret123" }),
    ).resolves.toEqual({ status: "pending_email" });
    expect(repo.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
      login: "user",
    });
  });

  it("omits an empty login on registration", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await service.register({ email: "user@example.com", login: "  ", password: "secret123" });

    expect(repo.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
    });
  });

  it("rejects an invalid email and a short password on registration", async () => {
    const service = new DefaultAuthService(makeAuth());
    await expect(
      service.register({ email: "nope", password: "secret123" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.register({ email: "user@example.com", password: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("verifies an email token", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await expect(service.verifyEmail(" token ")).resolves.toEqual({ status: "pending_approval" });
    expect(repo.verifyEmail).toHaveBeenCalledWith("token");
    await expect(service.verifyEmail(" ")).rejects.toBeInstanceOf(ValidationError);
  });

  it("resends the verification email", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await service.resendVerification(" user@example.com ");
    expect(repo.resendVerification).toHaveBeenCalledWith("user@example.com");
    await expect(service.resendVerification("nope")).rejects.toBeInstanceOf(ValidationError);
  });

  it("requests a password reset link with a normalized email", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await expect(service.forgotPassword(" user@example.com ")).resolves.toEqual({ status: "sent" });
    expect(repo.forgotPassword).toHaveBeenCalledWith("user@example.com");
    await expect(service.forgotPassword("nope")).rejects.toBeInstanceOf(ValidationError);
  });

  it("resets a password with a trimmed token and a valid password", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await expect(service.resetPassword(" token ", "secret123")).resolves.toEqual({
      status: "reset",
    });
    expect(repo.resetPassword).toHaveBeenCalledWith("token", "secret123");
    await expect(service.resetPassword(" ", "secret123")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.resetPassword("token", "short")).rejects.toBeInstanceOf(ValidationError);
  });

  it("passes the TOTP code on login", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await service.login({ login: "admin", password: "secret", totp_code: " 123456 " });

    expect(repo.login).toHaveBeenCalledWith({
      login: "admin",
      password: "secret",
      totp_code: "123456",
    });
  });

  it("delegates TOTP setup, enable and disable", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await expect(service.totpSetup()).resolves.toEqual({
      secret: "",
      otpauth_url: "",
      recovery_codes: [],
    });
    await expect(service.totpEnable(" 123456 ")).resolves.toEqual({ enabled: true });
    await expect(service.totpDisable(" secret ", " 654321 ")).resolves.toEqual({ enabled: false });

    expect(repo.totpEnable).toHaveBeenCalledWith("123456");
    expect(repo.totpDisable).toHaveBeenCalledWith("secret", "654321");
    await expect(service.totpEnable("abc")).rejects.toBeInstanceOf(ValidationError);
  });

  it("delegates listing sessions and logout of all sessions", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await expect(service.sessions()).resolves.toEqual([]);
    await expect(service.logoutAll()).resolves.toEqual({ ok: true, revoked: 0 });

    expect(repo.sessions).toHaveBeenCalledTimes(1);
    expect(repo.logoutAll).toHaveBeenCalledTimes(1);
  });

  it("trims a session jti and rejects an empty one", async () => {
    const repo = makeAuth();
    const service = new DefaultAuthService(repo);

    await service.revokeSession(" jti-1 ");
    expect(repo.revokeSession).toHaveBeenCalledWith("jti-1");

    await expect(service.revokeSession("  ")).rejects.toBeInstanceOf(ValidationError);
    expect(repo.revokeSession).toHaveBeenCalledTimes(1);
  });
});

describe("UsersService", () => {
  function makeUsers(): UsersRepository {
    return {
      listUsers: vi.fn(async () => [USER]),
      pageUsers: vi.fn(async (params) => pageUsersFromList([USER], params)),
      listPending: vi.fn(async () => [USER]),
      createUser: vi.fn(async () => USER),
      updateUser: vi.fn(async () => USER),
      deleteUser: vi.fn(async () => undefined),
      resetPassword: vi.fn(async () => undefined),
      approveUser: vi.fn(async () => USER),
      rejectUser: vi.fn(async () => USER),
      bulk: vi.fn(async () => ({ done: 0, failed: [] })),
    };
  }

  it("validates password on create", async () => {
    const service = new DefaultUsersService(makeUsers());
    await expect(
      service.createUser({
        email: "user@example.com",
        password: "123",
        role: "user",
        tariff_id: null,
        node_id: null,
        group_id: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes emails on create and update", async () => {
    const repo = makeUsers();
    const service = new DefaultUsersService(repo);

    await service.createUser({
      email: " user@example.com ",
      password: "secret123",
      role: "user",
      tariff_id: null,
      node_id: null,
    });
    expect(repo.createUser).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
      role: "user",
      tariff_id: null,
      node_id: null,
    });

    await service.updateUser(" u1 ", { email: " new@example.com " });
    expect(repo.updateUser).toHaveBeenCalledWith("u1", { email: "new@example.com" });

    await expect(
      service.updateUser("u1", { email: "nope" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createUser({
        email: "nope",
        password: "secret123",
        role: "user",
        tariff_id: null,
        node_id: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("delegates update and delete", async () => {
    const repo = makeUsers();
    const service = new DefaultUsersService(repo);
    await service.updateUser(" u1 ", { disabled: true });
    await service.deleteUser(" u1 ");
    expect(repo.updateUser).toHaveBeenCalledWith("u1", { disabled: true });
    expect(repo.deleteUser).toHaveBeenCalledWith("u1");
  });

  it("normalizes ids before a bulk request", async () => {
    const repo = makeUsers();
    const service = new DefaultUsersService(repo);

    await expect(service.bulk("disable", [" u1 ", "u2"])).resolves.toEqual({
      done: 0,
      failed: [],
    });
    expect(repo.bulk).toHaveBeenCalledWith("disable", ["u1", "u2"]);
    await expect(service.bulk("delete", ["  "])).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists pending accounts", async () => {
    const repo = makeUsers();
    const service = new DefaultUsersService(repo);

    await expect(service.listPending()).resolves.toEqual([USER]);
    expect(repo.listPending).toHaveBeenCalledTimes(1);
  });

  it("approves a pending account with a tariff and optional group", async () => {
    const repo = makeUsers();
    const service = new DefaultUsersService(repo);

    await service.approveUser(" u2 ", { tariff_id: " t1 ", group_id: "g1" });

    expect(repo.approveUser).toHaveBeenCalledWith("u2", {
      tariff_id: "t1",
      node_id: null,
      group_id: "g1",
    });
    await expect(
      service.approveUser("u2", { tariff_id: "  " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a pending account", async () => {
    const repo = makeUsers();
    const service = new DefaultUsersService(repo);

    await expect(service.rejectUser(" u2 ")).resolves.toEqual(USER);
    expect(repo.rejectUser).toHaveBeenCalledWith("u2");
    await expect(service.rejectUser(" ")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("TariffsService", () => {
  function makeTariffs(): TariffsRepository {
    return {
      listTariffs: vi.fn(async () => [TARIFF]),
      createTariff: vi.fn(async () => TARIFF),
      updateTariff: vi.fn(async () => TARIFF),
      deleteTariff: vi.fn(async () => undefined),
      bulk: vi.fn(async (_action, ids) => ({ done: ids.length, failed: [] })),
    };
  }

  it("rejects an invalid tariff", async () => {
    const service = new DefaultTariffsService(makeTariffs());
    await expect(
      service.createTariff({
        name: " ",
        description: "",
        max_devices: 1,
        device_down_kbps: 0,
        device_up_kbps: 0,
        group_down_kbps: 0,
        group_up_kbps: 0,
        traffic_quota_bytes: null,
        interface_id: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes a valid tariff", async () => {
    const repo = makeTariffs();
    const service = new DefaultTariffsService(repo);
    await service.createTariff({
      name: " Basic ",
      description: " plan ",
      max_devices: 2,
      device_down_kbps: 100,
      device_up_kbps: 50,
      group_down_kbps: 200,
      group_up_kbps: 100,
      traffic_quota_bytes: null,
      interface_id: " if1 ",
    });
    expect(repo.createTariff).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Basic", description: "plan", interface_id: "if1" }),
    );
  });

  it("sends an interface binding on create and clears it on update", async () => {
    const repo = makeTariffs();
    const service = new DefaultTariffsService(repo);

    await service.updateTariff("t1", { interface_id: "if1" });
    expect(repo.updateTariff).toHaveBeenLastCalledWith("t1", { interface_id: "if1" });

    await service.updateTariff("t1", { interface_id: null });
    expect(repo.updateTariff).toHaveBeenLastCalledWith("t1", { interface_id: null });

    await service.updateTariff("t1", { name: "Basic" });
    expect(repo.updateTariff).toHaveBeenLastCalledWith("t1", { name: "Basic" });
  });

  it("turns a blank interface id into null", async () => {
    const repo = makeTariffs();
    const service = new DefaultTariffsService(repo);

    await service.createTariff({
      name: "Basic",
      description: "",
      max_devices: 2,
      device_down_kbps: 0,
      device_up_kbps: 0,
      group_down_kbps: 0,
      group_up_kbps: 0,
      traffic_quota_bytes: null,
      interface_id: "   ",
    });

    expect(repo.createTariff).toHaveBeenCalledWith(
      expect.objectContaining({ interface_id: null }),
    );
  });
});

describe("GroupsService", () => {
  function makeGroups(): GroupsRepository {
    return {
      listGroups: vi.fn(async () => [GROUP]),
      createGroup: vi.fn(async () => GROUP),
      updateGroup: vi.fn(async () => GROUP),
      deleteGroup: vi.fn(async () => undefined),
      bulk: vi.fn(async (_action, ids) => ({ done: ids.length, failed: [] })),
      listPools: vi.fn(async () => [POOL]),
      createPool: vi.fn(async () => POOL),
      updatePool: vi.fn(async () => POOL),
      deletePool: vi.fn(async () => undefined),
    };
  }

  it("rejects an invalid base CIDR", async () => {
    const service = new DefaultGroupsService(makeGroups());
    await expect(
      service.createGroup({
        name: "Main",
        description: "",
        base_cidr: "10.0.0.0/33",
        forwarding_default: false,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes and delegates a pool", async () => {
    const repo = makeGroups();
    const service = new DefaultGroupsService(repo);
    await service.createPool(" g1 ", {
      name: " pool ",
      cidr: "10.0.1.0/24",
      mode: "auto",
      gateway: null,
    });
    expect(repo.createPool).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ name: "pool", cidr: "10.0.1.0/24" }),
    );
  });
});

describe("NodesService", () => {
  function makeNodes(): NodesRepository {
    return {
      listNodes: vi.fn(async () => [NODE]),
      createNode: vi.fn(async () => ({
        node: { id: "n1", name: "node", created_at: "2020-01-01T00:00:00Z" },
        token: "token",
      })),
      rotateNode: vi.fn(async () => ({ node: NODE, token: "rotated-token" })),
      deleteNode: vi.fn(async () => undefined),
      bulk: vi.fn(async () => ({ done: 0, failed: [] })),
    };
  }

  it("requires a node name", async () => {
    const service = new DefaultNodesService(makeNodes());
    await expect(service.createNode(" ")).rejects.toBeInstanceOf(ValidationError);
  });

  it("trims a node name", async () => {
    const repo = makeNodes();
    const service = new DefaultNodesService(repo);
    await service.createNode(" node ");
    expect(repo.createNode).toHaveBeenCalledWith("node");
  });

  it("validates the node id before rotating", async () => {
    const repo = makeNodes();
    const service = new DefaultNodesService(repo);

    await expect(service.rotateNode(" ")).rejects.toBeInstanceOf(ValidationError);
    await service.rotateNode(" n1 ");
    expect(repo.rotateNode).toHaveBeenCalledWith("n1");
  });
});

describe("InterfacesService", () => {
  function makeInterfaces(): InterfacesRepository {
    return {
      listInterfaces: vi.fn(async () => [INTERFACE]),
      createInterface: vi.fn(async () => INTERFACE),
      updateInterface: vi.fn(async () => INTERFACE),
      rotateInterface: vi.fn(async () => INTERFACE),
      deleteInterface: vi.fn(async () => undefined),
      bulk: vi.fn(async () => ({ done: 0, failed: [] })),
    };
  }

  const input = {
    group_id: "g1",
    node_id: "n1",
    name: "wg0",
    label: "",
    endpoint_host: "vpn.example.com",
    endpoint_port: 51820,
    listen_port: 51820,
    mtu: 1420,
  };

  it("rejects invalid ports and MTU", async () => {
    const service = new DefaultInterfacesService(makeInterfaces());
    await expect(
      service.createInterface({ ...input, endpoint_port: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createInterface({ ...input, mtu: 100 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("delegates rotation", async () => {
    const repo = makeInterfaces();
    const service = new DefaultInterfacesService(repo);
    await service.rotateInterface(" i1 ");
    expect(repo.rotateInterface).toHaveBeenCalledWith("i1");
  });
});

describe("DevicesService", () => {
  function makeDevices(): DevicesRepository {
    return {
      listDevices: vi.fn(async () => [DEVICE]),
      pageDevices: vi.fn(async (params) => pageDevicesFromList([DEVICE], params)),
      getDevice: vi.fn(async () => DEVICE),
      createDevice: vi.fn(async () => DEVICE),
      updateDevice: vi.fn(async () => DEVICE),
      deleteDevice: vi.fn(async () => undefined),
      listProfiles: vi.fn(async () => []),
      getProfile: vi.fn(),
      profileByPeer: vi.fn(),
      addTunnel: vi.fn(),
      renameTunnel: vi.fn(),
      deleteTunnel: vi.fn(),
      deviceStats: vi.fn(async () => ({
        device_id: "d1",
        today: { rx: 1, tx: 2 },
        month: { rx: 3, tx: 4 },
      })),
      listShares: vi.fn(async () => []),
      createShare: vi.fn(async () => ({
        token: "share",
        device_id: "d1",
        interface_id: "i1",
        format: "conf" as const,
        expires_at: "2020-01-02T00:00:00Z",
        created_at: "2020-01-01T00:00:00Z",
        used_at: null,
        max_uses: null,
        uses: 0,
        remaining_uses: null,
        revoked_at: null,
        state: "active" as const,
        url: "https://example.com/s",
      })),
      revokeShare: vi.fn(async () => undefined),
      revokeAllShares: vi.fn(async () => 0),
      bulk: vi.fn(async () => ({ done: 0, failed: [] })),
    };
  }

  it("requires a device name", async () => {
    const service = new DefaultDevicesService(makeDevices());
    await expect(
      service.createDevice({
        user_id: null,
        group_id: "g1",
        name: " ",
        down_kbps: 0,
        up_kbps: 0,
        forwarding: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("passes the interface id when creating a device", async () => {
    const repo = makeDevices();
    const service = new DefaultDevicesService(repo);

    await service.createDevice({
      user_id: "u1",
      group_id: "g1",
      interface_id: "i1",
      name: "laptop",
      down_kbps: 10,
      up_kbps: 5,
      forwarding: null,
    });

    expect(repo.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({ interface_id: "i1", group_id: "g1" }),
    );
  });

  it("rejects a non-positive share TTL", async () => {
    const service = new DefaultDevicesService(makeDevices());
    await expect(
      service.createShare("d1", { interfaceId: "i1", format: "conf", ttlSecs: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes ids before a bulk request", async () => {
    const repo = makeDevices();
    const service = new DefaultDevicesService(repo);

    await expect(service.bulk("revoke_shares", [" d1 ", "d2"])).resolves.toEqual({
      done: 0,
      failed: [],
    });
    expect(repo.bulk).toHaveBeenCalledWith("revoke_shares", ["d1", "d2"]);
    await expect(service.bulk("delete", ["  "])).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps share input to the repository contract", async () => {
    const repo = makeDevices();
    const service = new DefaultDevicesService(repo);
    await service.createShare(" d1 ", { interfaceId: " i1 ", format: "vpn", ttlSecs: 60 });
    expect(repo.createShare).toHaveBeenCalledWith("d1", {
      interfaceId: "i1",
      format: "vpn",
      ttlSecs: 60,
    });
  });

  it("validates and forwards tunnel operations", async () => {
    const repo = makeDevices();
    const service = new DefaultDevicesService(repo);

    await service.addTunnel(" d1 ", " i1 ", " extra ");
    expect(repo.addTunnel).toHaveBeenCalledWith("d1", {
      interfaceId: "i1",
      label: "extra",
    });

    await service.addTunnel("d1", "i1", "   ");
    expect(repo.addTunnel).toHaveBeenLastCalledWith("d1", { interfaceId: "i1" });

    await expect(
      service.addTunnel("d1", "i1", "a".repeat(65)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(service.addTunnel("d1", " ", "extra")).rejects.toBeInstanceOf(
      ValidationError,
    );

    await service.renameTunnel("d1", " p1 ", " renamed ");
    expect(repo.renameTunnel).toHaveBeenCalledWith("d1", "p1", "renamed");
    await expect(service.renameTunnel("d1", "p1", "  ")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      service.renameTunnel("d1", "p1", "a".repeat(65)),
    ).rejects.toBeInstanceOf(ValidationError);

    await service.deleteTunnel(" d1 ", " p1 ");
    expect(repo.deleteTunnel).toHaveBeenCalledWith("d1", "p1");
    await expect(service.deleteTunnel("d1", " ")).rejects.toBeInstanceOf(
      ValidationError,
    );

    await service.profileByPeer(" d1 ", " p1 ");
    expect(repo.profileByPeer).toHaveBeenCalledWith("d1", "p1");
  });
});

describe("StatsService", () => {
  function makeStats(): StatsRepository {
    return {
      overview: vi.fn(async (): Promise<Overview> => ({
        today: { rx: 1, tx: 2 },
        month: { rx: 3, tx: 4 },
        rx_bps: 0,
        tx_bps: 0,
        nodes_online: 1,
        nodes_total: 1,
        interfaces: 1,
        groups: 1,
        devices: 1,
        users: 1,
        top_devices: [],
      })),
      series: vi.fn(async (): Promise<StatsPoint[]> => []),
    };
  }

  it("rejects a reversed interval", async () => {
    const service = new DefaultStatsService(makeStats());
    await expect(service.series("device", null, 200, 100)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("delegates a valid interval", async () => {
    const repo = makeStats();
    const service = new DefaultStatsService(repo);
    await service.series(" device ", "d1", 100, 200);
    expect(repo.series).toHaveBeenCalledWith("device", "d1", 100, 200);
  });
});

describe("SettingsService", () => {
  function makeSettings(): SettingsRepository {
    return {
      getSettings: vi.fn(async () => SETTINGS),
      updateSettings: vi.fn(async () => SETTINGS),
    };
  }

  it("rejects a too small S padding", async () => {
    const service = new DefaultSettingsService(makeSettings());
    await expect(
      service.updateSettings({ obfuscation: { ...SETTINGS.obfuscation, s_min: 11 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("clamps the share TTL", async () => {
    const repo = makeSettings();
    const service = new DefaultSettingsService(repo);
    await service.updateSettings({ share_default_ttl_secs: 1 });
    expect(repo.updateSettings).toHaveBeenCalledWith({ share_default_ttl_secs: 60 });
  });
});

describe("ImportService", () => {
  const PREVIEW: ImportPreview = {
    group: { name: "Main" },
    interfaces: [
      {
        index: 0,
        name: "wg0",
        public_key: "server-pub",
        clients: [
          {
            name: "laptop",
            status: "create",
            address: "10.0.0.2/24",
            reason: null,
            device_id: null,
            changes: [],
          },
        ],
        server_peers: [],
        counts: { create: 1, unchanged: 0, update: 0, duplicate: 0, error: 0 },
        server_peer_counts: { create: 0, duplicate: 0, error: 0 },
      },
    ],
    summary: {
      create: 1,
      unchanged: 0,
      update: 0,
      duplicate: 0,
      error: 0,
      interfaces: 1,
      external: { create: 0, duplicate: 0, error: 0 },
    },
    warnings: [],
  };

  const APPLIED: ImportApplyResult = {
    ...PREVIEW,
    created: {
      group_id: "g1",
      interfaces: [{ id: "i1", name: "wg0", device_ids: ["d1"] }],
    },
  };

  const CLIENTS_PREVIEW: ClientsPreview = {
    interfaces: [
      {
        id: "i1",
        name: "wg0",
        group_id: "g1",
        group_name: "Main",
        node_id: "n1",
        public_key: "server-pub",
        clients: [
          {
            name: "laptop",
            status: "create",
            address: "10.0.0.2/24",
            reason: null,
            device_id: null,
            changes: [],
          },
        ],
        counts: { create: 1, unchanged: 0, update: 0, duplicate: 0, error: 0 },
      },
    ],
    summary: { create: 1, unchanged: 0, update: 0, duplicate: 0, error: 0, interfaces: 1 },
    warnings: [],
  };

  const CLIENTS_APPLIED: ClientsApplyResult = {
    ...CLIENTS_PREVIEW,
    created: { interfaces: [{ id: "i1", device_ids: ["d1"] }] },
  };

  function makeImport(): ImportRepository {
    return {
      preview: vi.fn(async () => PREVIEW),
      apply: vi.fn(async () => APPLIED),
      previewClients: vi.fn(async () => CLIENTS_PREVIEW),
      applyClients: vi.fn(async () => CLIENTS_APPLIED),
      importConfig: vi.fn(async (): Promise<ImportResult> => ({
        group_id: "g1",
        interface_id: "i1",
        imported_devices: 1,
        failed_devices: [],
      })),
    };
  }

  function makeWireImport(wire: ImportPreviewWire): ImportRepository {
    return {
      preview: vi.fn(async (): Promise<ImportPreviewWire> => wire),
      apply: vi.fn(
        async (): Promise<ImportPreviewWire & { created: ImportApplyResult["created"] }> => ({
          ...wire,
          created: { group_id: "g1", interfaces: [] },
        }),
      ),
      previewClients: vi.fn(async (): Promise<ClientsPreviewWire> => CLIENTS_PREVIEW),
      applyClients: vi.fn(async (): Promise<ClientsApplyResultWire> => CLIENTS_APPLIED),
      importConfig: vi.fn(async (): Promise<ImportResult> => ({
        group_id: "g1",
        interface_id: "i1",
        imported_devices: 1,
        failed_devices: [],
      })),
    };
  }

  const input: ImportInput = {
    node_id: "n1",
    group_name: "Main",
    group_description: "",
    base_cidr: "10.0.0.0/24",
    owner_user_id: null,
    interfaces: [
      {
        server_config: "[Interface]\nPrivateKey = key",
        name: "wg0",
        label: "",
        endpoint_host: "vpn.example.com",
        endpoint_port: 51820,
        listen_port: 51820,
        mtu: 1420,
        pools: [{ name: "pool", cidr: "10.0.0.0/25", mode: "auto", gateway: null }],
        clients: [{ name: "laptop", config: "[Peer]" }],
      },
    ],
  };

  const legacyInput = {
    server_config: "[Interface]\nPrivateKey = key",
    node_id: "n1",
    group_name: "Main",
    group_description: "",
    base_cidr: "10.0.0.0/24",
    pools: [{ name: "pool", cidr: "10.0.0.0/25", mode: "auto" as const, gateway: null }],
    interface: {
      name: "wg0",
      endpoint_host: "vpn.example.com",
      endpoint_port: 51820,
      listen_port: 51820,
      mtu: 1420,
    },
    clients: [{ name: "laptop", config: "[Peer]" }],
    owner_user_id: null,
  };

  it("rejects an invalid base CIDR", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({ ...input, base_cidr: "bad" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an invalid pool CIDR", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({
        ...input,
        interfaces: [
          {
            ...input.interfaces[0]!,
            pools: [{ ...input.interfaces[0]!.pools[0]!, cidr: "bad" }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a pool outside the base CIDR", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({
        ...input,
        interfaces: [
          {
            ...input.interfaces[0]!,
            pools: [{ ...input.interfaces[0]!.pools[0]!, cidr: "192.168.0.0/24" }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects duplicate interface names", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({
        ...input,
        interfaces: [input.interfaces[0]!, { ...input.interfaces[0]!, name: "WG0" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects duplicate pool names", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({
        ...input,
        interfaces: [
          {
            ...input.interfaces[0]!,
            pools: [
              { ...input.interfaces[0]!.pools[0]!, name: "pool" },
              { ...input.interfaces[0]!.pools[0]!, name: "Pool", cidr: "10.0.0.128/25" },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects overlapping pools", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({
        ...input,
        interfaces: [
          {
            ...input.interfaces[0]!,
            pools: [
              { ...input.interfaces[0]!.pools[0]!, name: "a", cidr: "10.0.0.0/24" },
              { ...input.interfaces[0]!.pools[0]!, name: "b", cidr: "10.0.0.128/25" },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a server config without [Interface] and PrivateKey", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.preview({
        ...input,
        interfaces: [{ ...input.interfaces[0]!, server_config: "PrivateKey = key" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("delegates a valid preview", async () => {
    const repo = makeImport();
    const service = new DefaultImportService(repo);
    const result = await service.preview({
      ...input,
      group_name: "  Main  ",
      interfaces: [{ ...input.interfaces[0]!, name: " wg0 " }],
    });
    expect(repo.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: "n1",
        group_name: "Main",
        base_cidr: "10.0.0.0/24",
        interfaces: [expect.objectContaining({ name: "wg0" })],
      }),
    );
    expect(result).toEqual(PREVIEW);
  });

  it("delegates a valid apply", async () => {
    const repo = makeImport();
    const service = new DefaultImportService(repo);
    const result = await service.apply(input);
    expect(repo.apply).toHaveBeenCalledWith(
      expect.objectContaining({ owner_user_id: null, interfaces: expect.any(Array) }),
    );
    expect(result).toEqual(APPLIED);
  });

  it("rejects an empty clients list", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.previewClients({ interface_id: null, owner_user_id: null, clients: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty client configs", async () => {
    const service = new DefaultImportService(makeImport());
    await expect(
      service.applyClients({
        interface_id: null,
        owner_user_id: null,
        clients: [{ name: "laptop", config: "   " }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes a clients import and delegates", async () => {
    const repo = makeImport();
    const service = new DefaultImportService(repo);
    const result = await service.previewClients({
      interface_id: "  i1  ",
      owner_user_id: "  ",
      clients: [{ name: " laptop ", config: "[Peer]" }],
    });
    expect(repo.previewClients).toHaveBeenCalledWith({
      interface_id: "i1",
      owner_user_id: null,
      clients: [{ name: "laptop", config: "[Peer]" }],
    });
    expect(result).toEqual(CLIENTS_PREVIEW);
  });

  it("delegates a clients apply with automatic matching", async () => {
    const repo = makeImport();
    const service = new DefaultImportService(repo);
    const result = await service.applyClients({
      interface_id: null,
      owner_user_id: "u1",
      clients: [{ name: "laptop", config: "[Peer]" }],
    });
    expect(repo.applyClients).toHaveBeenCalledWith({
      interface_id: null,
      owner_user_id: "u1",
      clients: [{ name: "laptop", config: "[Peer]" }],
    });
    expect(result).toEqual(CLIENTS_APPLIED);
  });

  it("delegates a legacy import", async () => {
    const repo = makeImport();
    const service = new DefaultImportService(repo);
    await service.importConfig(legacyInput);
    expect(repo.importConfig).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "n1", base_cidr: "10.0.0.0/24" }),
    );
  });

  it("нормализует серверные пиры и счётчики external", async () => {
    const repo = makeWireImport({
      group: { name: "Main" },
      interfaces: [
        {
          index: 0,
          name: "wg0",
          public_key: "server-pub",
          clients: [{ name: "laptop", status: "create", address: "10.0.0.2/24" }],
          server_peers: [
            { public_key: "peer-a", status: "create", address: "10.0.0.9/24" },
            { public_key: "peer-b", status: "duplicate", address: null, reason: "exists" },
            { public_key: "peer-c", status: "error", address: null, reason: "no address" },
            { public_key: null, status: "create", address: null },
          ],
        },
      ],
      summary: { create: 1, duplicate: 0, error: 0, interfaces: 1 },
      warnings: [],
    });

    const result = await new DefaultImportService(repo).preview(input);

    expect(result.interfaces[0]?.server_peers).toEqual([
      { public_key: "peer-a", status: "create", address: "10.0.0.9/24", reason: null },
      { public_key: "peer-b", status: "duplicate", address: null, reason: "exists" },
      { public_key: "peer-c", status: "error", address: null, reason: "no address" },
    ]);
    expect(result.interfaces[0]?.server_peer_counts).toEqual({
      create: 1,
      duplicate: 1,
      error: 1,
    });
    expect(result.summary.external).toEqual({ create: 1, duplicate: 1, error: 1 });
    expect(result.summary.unchanged).toBe(0);
    expect(result.summary.update).toBe(0);
    expect(result.interfaces[0]?.clients[0]?.device_id).toBeNull();
    expect(result.interfaces[0]?.clients[0]?.changes).toEqual([]);
  });

  it("сохраняет diff unchanged/update с изменениями", async () => {
    const repo = makeWireImport({
      group: { name: "Main" },
      interfaces: [
        {
          index: 0,
          name: "wg0",
          public_key: "server-pub",
          clients: [
            { name: "phone", status: "unchanged", address: "10.0.0.3/24", device_id: "d3" },
            {
              name: "laptop",
              status: "update",
              address: "10.0.0.4/24",
              device_id: "d4",
              changes: [
                { field: "address", from: "10.0.0.2/24", to: "10.0.0.4/24" },
                { field: "preshared_key", from: "old", to: "new" },
                { field: "name", from: "old-laptop", to: "laptop" },
                { field: "unknown", from: null, to: null },
              ],
            },
          ],
          counts: { create: 0, unchanged: 1, update: 1, duplicate: 0, error: 0 },
        },
      ],
      summary: { create: 0, unchanged: 1, update: 1, duplicate: 0, error: 0, interfaces: 1 },
      warnings: [],
    });

    const result = await new DefaultImportService(repo).preview(input);

    expect(result.summary).toEqual({
      create: 0,
      unchanged: 1,
      update: 1,
      duplicate: 0,
      error: 0,
      interfaces: 1,
      external: { create: 0, duplicate: 0, error: 0 },
    });
    expect(result.interfaces[0]?.clients[1]).toEqual({
      name: "laptop",
      status: "update",
      address: "10.0.0.4/24",
      reason: null,
      device_id: "d4",
      changes: [
        { field: "address", from: "10.0.0.2/24", to: "10.0.0.4/24" },
        { field: "preshared_key", from: "old", to: "new" },
        { field: "name", from: "old-laptop", to: "laptop" },
      ],
    });
  });

  it("поддерживает ответ без новых полей", async () => {
    const repo = makeWireImport({
      group: { name: "Main" },
      interfaces: [
        {
          index: 0,
          name: "wg0",
          public_key: "server-pub",
          clients: [
            { name: "laptop", status: "create", address: "10.0.0.2/24", reason: null },
            { name: "phone", status: "duplicate", address: "10.0.0.3/24", reason: "exists" },
            { name: "tablet", status: "error", address: null, reason: "bad key" },
          ],
          counts: { create: 1, duplicate: 1, error: 1 },
        },
      ],
      summary: { create: 1, duplicate: 1, error: 1, interfaces: 1 },
    });

    const result = await new DefaultImportService(repo).preview(input);

    expect(result.interfaces[0]?.server_peers).toEqual([]);
    expect(result.interfaces[0]?.server_peer_counts).toEqual({
      create: 0,
      duplicate: 0,
      error: 0,
    });
    expect(result.interfaces[0]?.counts).toEqual({
      create: 1,
      unchanged: 0,
      update: 0,
      duplicate: 1,
      error: 1,
    });
    expect(result.summary).toEqual({
      create: 1,
      unchanged: 0,
      update: 0,
      duplicate: 1,
      error: 1,
      interfaces: 1,
      external: { create: 0, duplicate: 0, error: 0 },
    });
    expect(result.warnings).toEqual([]);
    expect(result.interfaces[0]?.clients.map((client) => client.status)).toEqual([
      "create",
      "duplicate",
      "error",
    ]);
  });

  it("нормализует применение клиентов с обновлениями", async () => {
    const repo = makeWireImport({
      group: { name: "Main" },
    });
    vi.mocked(repo.previewClients).mockResolvedValueOnce({
      interfaces: [
        {
          id: "i1",
          name: "wg0",
          group_id: "g1",
          group_name: "Main",
          node_id: "n1",
          public_key: "server-pub",
          clients: [
            {
              name: "laptop",
              status: "update",
              address: "10.0.0.4/24",
              device_id: "d4",
              changes: [{ field: "preshared_key", from: "old", to: "new" }],
            },
          ],
        },
      ],
    });
    vi.mocked(repo.applyClients).mockResolvedValueOnce({
      interfaces: [
        {
          id: "i1",
          name: "wg0",
          group_id: "g1",
          group_name: "Main",
          node_id: "n1",
          public_key: "server-pub",
          clients: [
            {
              name: "laptop",
              status: "update",
              address: "10.0.0.4/24",
              device_id: "d4",
              changes: [{ field: "preshared_key", from: "old", to: "new" }],
            },
          ],
        },
      ],
      created: { interfaces: [{ id: "i1", device_ids: [] }] },
    });

    const service = new DefaultImportService(repo);
    const preview = await service.previewClients({
      interface_id: "i1",
      owner_user_id: null,
      clients: [{ name: "laptop", config: "[Peer]" }],
    });
    const applied = await service.applyClients({
      interface_id: "i1",
      owner_user_id: null,
      clients: [{ name: "laptop", config: "[Peer]" }],
    });

    expect(preview.summary).toEqual({
      create: 0,
      unchanged: 0,
      update: 1,
      duplicate: 0,
      error: 0,
      interfaces: 1,
    });
    expect(preview.interfaces[0]?.clients[0]?.changes).toEqual([
      { field: "preshared_key", from: "old", to: "new" },
    ]);
    expect(applied.summary.update).toBe(1);
    expect(applied.interfaces[0]?.clients[0]?.device_id).toBe("d4");
    expect(applied.created).toEqual({ interfaces: [{ id: "i1", device_ids: [] }] });
  });
});
