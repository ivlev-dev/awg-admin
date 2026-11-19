import { InterfacesPageVM } from "@/features/interfaces/InterfacesPage.vm";
import { createAppContainer } from "@/app/di";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService } from "@/application/nodes/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { BulkFailure, BulkResult } from "@/domain/bulk";
import type { InterfaceBulkAction } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { NodesRepository } from "@/domain/nodes/repository";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_options: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);
import type { NodeCreated, NodeRotated } from "@/domain/nodes/types";
import type {
  AuthSession,
  CidrPool,
  Group,
  InterfaceInfo,
  NodeInfo,
  Role,
  User,
} from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";

const ADMIN: User = {
  id: "u1",
  full_name: null,
  role: "admin",
  tariff_id: null,
  group_id: null,
  email: "user@example.com",
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

function user(role: Role, groupId: string | null): User {
  return { ...ADMIN, id: `u-${role}`, email: `u-${role}@example.com`, role, group_id: groupId };
}

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

function makeSession(current: User = ADMIN): Session {
  const authSession: AuthSession = {
    token: "access",
    refresh_token: "refresh",
    expires_in: 3600,
    user: current,
  };
  const auth: AuthRepository = {
    login: vi.fn(async () => authSession),
    refresh: vi.fn(async () => authSession),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => current),
    updateProfile: vi.fn(async () => current),
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
  const session = new Session(auth, new MemoryTokenStore());
  session.user = current;
  session.ready = true;
  return session;
}

const GROUP: Group = {
  id: "g1",
  name: "Офис",
  description: "",
  base_cidr: "10.8.0.0/16",
  forwarding_default: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
  interfaces: 0,
  devices: 0,
};

const NODE: NodeInfo = {
  id: "n1",
  name: "node-1",
  status: "online",
  online: true,
  last_seen: null,
  version: null,
  interfaces: 0,
};

function iface(overrides: Partial<InterfaceInfo> = {}): InterfaceInfo {
  return {
    id: "i1",
    group_id: "g1",
    group_name: "Офис",
    node_id: "n1",
    node_name: "node-1",
    name: "wg0",
    label: "Основной",
    endpoint_host: "vpn.example.com",
    endpoint_port: 443,
    listen_port: 51820,
    mtu: 1420,
    public_key: "pk",
    obf: {
      h1: { lo: 1, hi: 2 },
      h2: { lo: 3, hi: 4 },
      h3: { lo: 5, hi: 6 },
      h4: { lo: 7, hi: 8 },
      s1: 1,
      s2: 2,
      s3: 3,
      s4: 4,
      header_protection_key: "hpk",
      random_trailers: false,
    },
    enabled: true,
    peers: 0,
    ...overrides,
  };
}

class MemoryInterfacesRepository {
  private seq = 0;

  readonly items = new Map<string, InterfaceInfo>();

  listInterfaces = vi.fn(async (): Promise<InterfaceInfo[]> => [...this.items.values()]);

  createInterface = vi.fn(async (input: InterfaceInput): Promise<InterfaceInfo> => {
    const created = iface({
      id: `i${++this.seq}`,
      group_id: input.group_id,
      node_id: input.node_id,
      name: input.name,
      label: input.label,
      endpoint_host: input.endpoint_host,
      endpoint_port: input.endpoint_port,
      listen_port: input.listen_port,
      mtu: input.mtu,
    });
    this.items.set(created.id, created);
    return created;
  });

  updateInterface = vi.fn(async (id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo> => {
    const current = this.items.get(id);
    if (!current) throw new Error("not found");
    const updated: InterfaceInfo = { ...current, ...input };
    this.items.set(id, updated);
    return updated;
  });

  rotateInterface = vi.fn(async (id: string): Promise<InterfaceInfo> => {
    const current = this.items.get(id);
    if (!current) throw new Error("not found");
    const updated: InterfaceInfo = { ...current, public_key: `rotated-${id}` };
    this.items.set(id, updated);
    return updated;
  });

  deleteInterface = vi.fn(async (id: string): Promise<void> => {
    this.items.delete(id);
  });

  bulk = vi.fn(async (action: InterfaceBulkAction, ids: readonly string[]): Promise<BulkResult> => {
    const failed: BulkFailure[] = [];
    let done = 0;
    for (const id of ids) {
      const current = this.items.get(id);
      if (!current) {
        failed.push({ id, error: "not found" });
        continue;
      }
      if (action === "delete") {
        this.items.delete(id);
      } else {
        this.items.set(id, { ...current, enabled: action === "enable" });
      }
      done += 1;
    }
    return { done, failed };
  });
}

class MemoryGroupsRepository {
  readonly groups = new Map<string, Group>();

  listGroups = vi.fn(async (): Promise<Group[]> => [...this.groups.values()]);

  createGroup = vi.fn(async (input: GroupInput): Promise<Group> => ({ ...GROUP, ...input }));

  updateGroup = vi.fn(async (id: string, input: Partial<GroupInput>): Promise<Group> => ({
    ...GROUP,
    id,
    ...input,
  }));

  deleteGroup = vi.fn(async (): Promise<void> => undefined);

  listPools = vi.fn(async (): Promise<CidrPool[]> => []);

  createPool = vi.fn(async (): Promise<CidrPool> => {
    throw new Error("not implemented");
  });

  updatePool = vi.fn(async (): Promise<CidrPool> => {
    throw new Error("not implemented");
  });

  deletePool = vi.fn(async (): Promise<void> => undefined);

  bulk = vi.fn(async (): Promise<BulkResult> => ({ done: 0, failed: [] }));
}

class MemoryNodesRepository {
  readonly items = new Map<string, NodeInfo>();

  listNodes = vi.fn(async (): Promise<NodeInfo[]> => [...this.items.values()]);

  createNode = vi.fn(async (name: string): Promise<NodeCreated> => ({
    node: { id: `n${this.items.size + 1}`, name, created_at: "2020-01-01T00:00:00Z" },
    token: "token",
  }));

  rotateNode = vi.fn(async (id: string): Promise<NodeRotated> => {
    const existing = this.items.get(id);
    if (!existing) throw new Error("not implemented");
    return { node: { ...existing, token_issued_at: "2026-01-01T00:00:00Z" }, token: "rotated" };
  });

  deleteNode = vi.fn(async (): Promise<void> => undefined);

  bulk = vi.fn(async (): Promise<BulkResult> => ({ done: 0, failed: [] }));
}

interface Harness {
  vm: InterfacesPageVM;
  interfacesRepo: MemoryInterfacesRepository;
  groupsRepo: MemoryGroupsRepository;
  nodesRepo: MemoryNodesRepository;
  session: Session;
  toasts: ToastStore;
}

function makeVm(current: User = ADMIN): Harness {
  const interfacesRepo = new MemoryInterfacesRepository();
  const groupsRepo = new MemoryGroupsRepository();
  const nodesRepo = new MemoryNodesRepository();
  const session = makeSession(current);
  const toasts = new ToastStore();
  const vm = new InterfacesPageVM(
    new DefaultInterfacesService(interfacesRepo),
    new DefaultGroupsService(groupsRepo),
    new DefaultNodesService(nodesRepo),
    session,
    toasts,
  );
  return { vm, interfacesRepo, groupsRepo, nodesRepo, session, toasts };
}

function submit(): Event {
  return new Event("submit", { cancelable: true });
}

describe("InterfacesPageVM", () => {
  beforeEach(() => {
    confirmMock.askConfirm.mockClear();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  it("loads interfaces, groups and nodes", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg1", group_name: "Офис" }));
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg0", group_name: "Дом" }));

    await harness.vm.load();

    expect(harness.vm.interfaces).toHaveLength(2);
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i1", "i2"]);
    expect(harness.vm.groups).toHaveLength(1);
    expect(harness.vm.nodes).toHaveLength(1);
    expect(harness.vm.loading).toBe(false);
    expect(harness.vm.error).toBeNull();
  });

  it("sorts visible interfaces by peers and toggles direction", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg0", peers: 5 }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg1", peers: 1 }));
    harness.interfacesRepo.items.set("i3", iface({ id: "i3", name: "wg2", peers: 9 }));

    await harness.vm.load();
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i1", "i2", "i3"]);

    harness.vm.sortBy("peers");
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i2", "i1", "i3"]);
    expect(harness.vm.sortMark("peers")).toBe("▲");

    harness.vm.sortBy("peers");
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i3", "i1", "i2"]);
    expect(harness.vm.sortMark("peers")).toBe("▼");
    expect(harness.vm.sortMark("name")).toBe("");
  });

  it("sorts by status and endpoint with name as tie breaker", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg1", enabled: false, endpoint_host: "b.example.com" }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg2", enabled: true, endpoint_host: "a.example.com" }));
    harness.interfacesRepo.items.set("i3", iface({ id: "i3", name: "wg0", enabled: false, endpoint_host: "c.example.com" }));

    await harness.vm.load();
    harness.vm.sortBy("status");
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i3", "i1", "i2"]);

    harness.vm.sortBy("endpoint");
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i2", "i1", "i3"]);
  });

  it("reports a load error", async () => {
    const harness = makeVm();
    harness.interfacesRepo.listInterfaces.mockRejectedValueOnce(new Error("offline"));

    await harness.vm.load();

    expect(harness.vm.error).toBe("offline");
    expect(harness.vm.loading).toBe(false);
  });

  it("creates an interface and appends it to the list", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.vm.openCreate();
    harness.vm.formName = " wg0 ";
    harness.vm.formLabel = " Основной ";
    harness.vm.formEndpointHost = "vpn.example.com";

    await harness.vm.submitCreate(submit());

    expect(harness.interfacesRepo.createInterface).toHaveBeenCalledWith({
      group_id: "g1",
      node_id: "n1",
      name: "wg0",
      label: "Основной",
      endpoint_host: "vpn.example.com",
      endpoint_port: 443,
      listen_port: 51820,
      mtu: 1420,
    });
    expect(harness.vm.interfaces).toHaveLength(1);
    expect(harness.vm.createOpen).toBe(false);
    expect(harness.toasts.items.some((item) => item.message === "Интерфейс «wg0» создан")).toBe(true);
  });

  it("blocks creation for an invalid endpoint port", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.vm.openCreate();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formEndpointPort = "70000";

    expect(harness.vm.canCreate).toBe(false);
    await harness.vm.submitCreate(submit());

    expect(harness.interfacesRepo.createInterface).not.toHaveBeenCalled();
  });

  it("blocks creation for an invalid listen port", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.vm.openCreate();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formListenPort = "0";

    expect(harness.vm.canCreate).toBe(false);
    await harness.vm.submitCreate(submit());

    expect(harness.interfacesRepo.createInterface).not.toHaveBeenCalled();
  });

  it("blocks creation for an invalid MTU", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.vm.openCreate();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formMtu = "100";

    expect(harness.vm.canCreate).toBe(false);
    await harness.vm.submitCreate(submit());

    expect(harness.interfacesRepo.createInterface).not.toHaveBeenCalled();
  });

  it("shows a service error when creation fails", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.interfacesRepo.createInterface.mockRejectedValueOnce(new Error("name exists"));
    harness.vm.openCreate();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";

    await harness.vm.submitCreate(submit());

    expect(harness.vm.formError).toBe("name exists");
    expect(harness.vm.busy).toBe(false);
    expect(harness.toasts.items.some((item) => item.kind === "error")).toBe(true);
  });

  it("updates an interface through the service", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    harness.vm.editLabel = "Новый";
    harness.vm.editHost = "new.example.com";
    harness.vm.editEndpointPort = "8443";
    harness.vm.editListenPort = "51821";
    harness.vm.editMtu = "1380";
    harness.vm.editEnabled = false;

    await harness.vm.submitEdit(submit());

    expect(harness.interfacesRepo.updateInterface).toHaveBeenCalledWith("i1", {
      label: "Новый",
      endpoint_host: "new.example.com",
      endpoint_port: 8443,
      listen_port: 51821,
      mtu: 1380,
      enabled: false,
    });
    expect(harness.vm.interfaces[0]?.label).toBe("Новый");
    expect(harness.vm.editing).toBeNull();
  });

  it("blocks an update with an invalid MTU", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    harness.vm.editMtu = "9001";

    expect(harness.vm.canSaveEdit).toBe(false);
    await harness.vm.submitEdit(submit());

    expect(harness.interfacesRepo.updateInterface).not.toHaveBeenCalled();
  });

  it("rotates interface keys after confirmation", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();

    await harness.vm.rotate(iface());

    expect(harness.interfacesRepo.rotateInterface).toHaveBeenCalledWith("i1");
    expect(harness.vm.rotated?.public_key).toBe("rotated-i1");
    expect(harness.vm.interfaces[0]?.public_key).toBe("rotated-i1");
    expect(harness.vm.rotatedCopied).toBe(false);
    expect(harness.toasts.items.some((item) => item.message === "Ключи интерфейса перевыпущены")).toBe(true);
  });

  it("does not rotate without confirmation", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    confirmMock.askConfirm.mockResolvedValueOnce(false);

    await harness.vm.rotate(iface());

    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Перевыпустить ключи интерфейса") }),
    );
    expect(harness.interfacesRepo.rotateInterface).not.toHaveBeenCalled();
    expect(harness.vm.rotated).toBeNull();
  });

  it("reports a rotation error", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.interfacesRepo.rotateInterface.mockRejectedValueOnce(new Error("worker offline"));

    await harness.vm.rotate(iface());

    expect(harness.toasts.items.some((item) => item.message === "worker offline")).toBe(true);
    expect(harness.vm.busy).toBe(false);
  });

  it("deletes a confirmed interface", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();

    await harness.vm.remove(iface());

    expect(harness.interfacesRepo.deleteInterface).toHaveBeenCalledWith("i1");
    expect(harness.vm.interfaces).toEqual([]);
    expect(harness.toasts.items.some((item) => item.message === "Интерфейс «wg0» удалён")).toBe(true);
  });

  it("does not delete without confirmation", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    confirmMock.askConfirm.mockResolvedValueOnce(false);

    await harness.vm.remove(iface());

    expect(harness.interfacesRepo.deleteInterface).not.toHaveBeenCalled();
    expect(harness.vm.interfaces).toHaveLength(1);
  });

  it("enables only the selected interfaces that are disabled", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg0", enabled: false }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg1", enabled: true }));
    harness.interfacesRepo.items.set("i3", iface({ id: "i3", name: "wg2", enabled: false }));
    await harness.vm.load();
    const listCalls = harness.interfacesRepo.listInterfaces.mock.calls.length;
    harness.vm.toggleSelected("i1");
    harness.vm.toggleSelected("i2");

    await harness.vm.bulkSetEnabled(true);

    expect(harness.interfacesRepo.bulk).toHaveBeenCalledTimes(1);
    expect(harness.interfacesRepo.bulk).toHaveBeenCalledWith("enable", ["i1"]);
    expect(harness.interfacesRepo.updateInterface).not.toHaveBeenCalled();
    expect(harness.interfacesRepo.listInterfaces.mock.calls.length).toBe(listCalls + 1);
    expect(harness.vm.selectedIds).toEqual([]);
    expect(harness.vm.interfaces.find((item) => item.id === "i1")?.enabled).toBe(true);
    expect(
      harness.toasts.items.some((item) => item.kind === "success" && item.message === "Готово: 1, ошибок: 0"),
    ).toBe(true);
  });

  it("disables only the selected interfaces that are enabled", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg0", enabled: true }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg1", enabled: false }));
    await harness.vm.load();
    harness.vm.toggleSelected("i1");
    harness.vm.toggleSelected("i2");

    await harness.vm.bulkSetEnabled(false);

    expect(harness.interfacesRepo.bulk).toHaveBeenCalledTimes(1);
    expect(harness.interfacesRepo.bulk).toHaveBeenCalledWith("disable", ["i1"]);
    expect(harness.vm.interfaces.find((item) => item.id === "i1")?.enabled).toBe(false);
  });

  it("skips the bulk request when the target state is already set", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", enabled: true }));
    await harness.vm.load();
    harness.vm.toggleSelected("i1");

    await harness.vm.bulkSetEnabled(true);

    expect(harness.interfacesRepo.bulk).not.toHaveBeenCalled();
    expect(harness.vm.selectedIds).toEqual(["i1"]);
  });

  it("deletes all selected interfaces with a single bulk request", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg0" }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg1" }));
    harness.interfacesRepo.items.set("i3", iface({ id: "i3", name: "wg2" }));
    await harness.vm.load();
    const listCalls = harness.interfacesRepo.listInterfaces.mock.calls.length;
    harness.vm.toggleSelected("i1");
    harness.vm.toggleSelected("i2");

    await harness.vm.bulkDelete();

    expect(harness.interfacesRepo.bulk).toHaveBeenCalledTimes(1);
    expect(harness.interfacesRepo.bulk).toHaveBeenCalledWith("delete", ["i1", "i2"]);
    expect(harness.interfacesRepo.deleteInterface).not.toHaveBeenCalled();
    expect(harness.interfacesRepo.listInterfaces.mock.calls.length).toBe(listCalls + 1);
    expect(harness.vm.selectedIds).toEqual([]);
    expect(harness.vm.interfaces.map((item) => item.id)).toEqual(["i3"]);
    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Удалить выбранные записи (2)?" }),
    );
    expect(
      harness.toasts.items.some((item) => item.kind === "success" && item.message === "Готово: 2, ошибок: 0"),
    ).toBe(true);
  });

  it("shows a partial bulk failure from the response", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", enabled: false }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", enabled: false }));
    await harness.vm.load();
    harness.interfacesRepo.bulk.mockResolvedValueOnce({ done: 1, failed: [{ id: "i2", error: "worker offline" }] });
    harness.vm.toggleSelected("i1");
    harness.vm.toggleSelected("i2");

    await harness.vm.bulkSetEnabled(true);

    expect(
      harness.toasts.items.some((item) => item.kind === "error" && item.message === "Готово: 1, ошибок: 1"),
    ).toBe(true);
    expect(harness.vm.selectedIds).toEqual([]);
    expect(harness.vm.bulkBusy).toBe(false);
  });

  it("reports a failed bulk request and still reloads", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1" }));
    await harness.vm.load();
    const listCalls = harness.interfacesRepo.listInterfaces.mock.calls.length;
    harness.interfacesRepo.bulk.mockRejectedValueOnce(new Error("unreachable"));
    harness.vm.toggleSelected("i1");

    await harness.vm.bulkDelete();

    expect(harness.toasts.items.some((item) => item.kind === "error" && item.message === "unreachable")).toBe(true);
    expect(harness.interfacesRepo.listInterfaces.mock.calls.length).toBe(listCalls + 1);
    expect(harness.vm.selectedIds).toEqual([]);
    expect(harness.vm.bulkBusy).toBe(false);
  });

  it("does not bulk delete without confirmation", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface({ id: "i1" }));
    await harness.vm.load();
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    harness.vm.toggleSelected("i1");

    await harness.vm.bulkDelete();

    expect(harness.interfacesRepo.bulk).not.toHaveBeenCalled();
    expect(harness.vm.selectedIds).toEqual(["i1"]);
  });

  it("limits a regular user to the interfaces of the own group", async () => {
    const harness = makeVm(user("user", "g2"));
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", group_id: "g1" }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", group_id: "g2" }));
    await harness.vm.load();

    expect(harness.vm.isAdmin).toBe(false);
    expect(harness.vm.ownGroupId).toBe("g2");
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i2"]);

    harness.vm.openCreate();
    expect(harness.vm.formGroupId).toBe("g2");
  });

  it("lets an admin see every interface and filter by node", async () => {
    const harness = makeVm();
    harness.nodesRepo.items.set("n1", NODE);
    harness.nodesRepo.items.set("n2", { ...NODE, id: "n2", name: "node-2" });
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", node_id: "n1" }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", node_id: "n2" }));
    await harness.vm.load();
    harness.vm.setNodeFilter("n2");

    expect(harness.vm.isAdmin).toBe(true);
    expect(harness.vm.visible.map((item) => item.id)).toEqual(["i2"]);
    expect(harness.vm.filtersActive).toBe(true);

    harness.vm.resetFilters();
    expect(harness.vm.visible).toHaveLength(2);
  });

  it("не показывает и не применяет фильтр группы при скрытом разделе", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.groupsRepo.groups.set("g2", { ...GROUP, id: "g2", name: "Дом" });
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", group_id: "g1" }));
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", group_id: "g2" }));
    await harness.vm.load();

    expect(harness.vm.groupFilterEnabled).toBe(false);
    harness.vm.setGroupFilter("g1");
    expect(harness.vm.groupFilter).toBe("");
    expect(harness.vm.filtersActive).toBe(false);
    expect(harness.vm.visible.map((item) => item.id).sort()).toEqual(["i1", "i2"]);

    harness.vm.groupFilter = "g1";
    expect(harness.vm.visible.map((item) => item.id).sort()).toEqual(["i1", "i2"]);
    expect(harness.vm.filtersActive).toBe(false);
  });

  it("formats the endpoint, peers and obfuscation strings", () => {
    const harness = makeVm();

    expect(harness.vm.endpoint(iface({ endpoint_host: "2001:db8::1", endpoint_port: 443 }))).toBe(
      "[2001:db8::1]:443",
    );
    expect(harness.vm.peersLabel(iface({ peers: 2 }))).toBe("2 пира");
    expect(harness.vm.obfSigned(iface())).toBe("S1 1 · S2 2 · S3 3 · S4 4");
  });

  it("is resolved by the DI container", async () => {
    const container = createAppContainer();
    const vm = await container.resolve(InterfacesPageVM);

    expect(vm).toBeInstanceOf(InterfacesPageVM);
  });
});

describe("InterfacesPageVM inline validation", () => {
  beforeEach(() => {
    confirmMock.askConfirm.mockReset();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  async function readyVm(): Promise<Harness> {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.vm.openCreate();
    return harness;
  }

  it("reports an empty interface name", async () => {
    const harness = await readyVm();
    harness.vm.formName = "";

    expect(harness.vm.nameError).toBe("Имя: латиница, цифры, _ и -");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("reports a name longer than 15 characters", async () => {
    const harness = await readyVm();
    harness.vm.formName = "abcdefghijklmnop";

    expect(harness.vm.nameError).toBe("Имя — не более 15 символов");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("reports a name with characters outside the allowed set", async () => {
    const harness = await readyVm();
    harness.vm.formName = "awg 0";

    expect(harness.vm.nameError).toBe("Имя: латиница, цифры, _ и -");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("accepts a valid name with spaces around it", async () => {
    const harness = await readyVm();
    harness.vm.formName = " wg0_1-a ";

    expect(harness.vm.nameError).toBeNull();
  });

  it("reports an empty endpoint host", async () => {
    const harness = await readyVm();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "   ";

    expect(harness.vm.endpointHostError).toBe("Укажите host без пробелов");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("reports an endpoint host with inner spaces", async () => {
    const harness = await readyVm();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn example.com";

    expect(harness.vm.endpointHostError).toBe("Укажите host без пробелов");
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["0", "70000", "", "-1", "1.5"])("reports the endpoint port %s", async (value) => {
    const harness = await readyVm();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formEndpointPort = value;

    expect(harness.vm.endpointPortError).toBe("Порт — целое число от 1 до 65535");
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["0", "70000", "", "abc"])("reports the listen port %s", async (value) => {
    const harness = await readyVm();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formListenPort = value;

    expect(harness.vm.listenPortError).toBe("Порт — целое число от 1 до 65535");
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["100", "10000", ""])("reports the MTU %s", async (value) => {
    const harness = await readyVm();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formMtu = value;

    expect(harness.vm.mtuError).toBe("MTU — от 576 до 9000");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("has no errors for valid create values", async () => {
    const harness = await readyVm();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    harness.vm.formEndpointPort = "443";
    harness.vm.formListenPort = "51820";
    harness.vm.formMtu = "1420";

    expect(harness.vm.nameError).toBeNull();
    expect(harness.vm.endpointHostError).toBeNull();
    expect(harness.vm.endpointPortError).toBeNull();
    expect(harness.vm.listenPortError).toBeNull();
    expect(harness.vm.mtuError).toBeNull();
    expect(harness.vm.canCreate).toBe(true);
  });

  it("reports edit field errors and blocks the save", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    harness.vm.editHost = "";
    harness.vm.editEndpointPort = "0";
    harness.vm.editListenPort = "70000";
    harness.vm.editMtu = "10000";

    expect(harness.vm.editHostError).toBe("Укажите host без пробелов");
    expect(harness.vm.editEndpointPortError).toBe("Порт — целое число от 1 до 65535");
    expect(harness.vm.editListenPortError).toBe("Порт — целое число от 1 до 65535");
    expect(harness.vm.editMtuError).toBe("MTU — от 576 до 9000");
    expect(harness.vm.canSaveEdit).toBe(false);
  });

  it("has no edit errors for valid values", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());

    expect(harness.vm.editHostError).toBeNull();
    expect(harness.vm.editEndpointPortError).toBeNull();
    expect(harness.vm.editListenPortError).toBeNull();
    expect(harness.vm.editMtuError).toBeNull();
    expect(harness.vm.canSaveEdit).toBe(true);
  });

  it("keeps errors hidden until the field is touched or the form is submitted", async () => {
    const harness = await readyVm();
    harness.vm.formName = "";

    expect(harness.vm.showCreateError("name")).toBe(false);

    harness.vm.markTouched("name");
    expect(harness.vm.showCreateError("name")).toBe(true);

    harness.vm.closeCreate();
    harness.vm.openCreate();
    expect(harness.vm.showCreateError("name")).toBe(false);

    await harness.vm.submitCreate(submit());
    expect(harness.vm.showCreateError("name")).toBe(true);
  });

  it("marks every field once and resets the touched set when the create form opens", async () => {
    const harness = await readyVm();
    harness.vm.markTouched("name");
    harness.vm.markTouched("name");
    harness.vm.markTouched("mtu");

    expect(harness.vm.touchedFields).toEqual(["name", "mtu"]);
    expect(harness.vm.isTouched("name")).toBe(true);
    expect(harness.vm.isTouched("endpointHost")).toBe(false);

    harness.vm.closeCreate();
    expect(harness.vm.touchedFields).toEqual([]);

    harness.vm.markTouched("endpointPort");
    harness.vm.openCreate();
    expect(harness.vm.touchedFields).toEqual([]);
  });

  it("resets the touched set when the edit form opens and closes", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    harness.vm.markTouched("edit.host");

    expect(harness.vm.showEditError("host")).toBe(true);

    harness.vm.closeEdit();
    expect(harness.vm.touchedFields).toEqual([]);
    expect(harness.vm.editing).toBeNull();

    harness.vm.openEdit(iface());
    expect(harness.vm.touchedFields).toEqual([]);
    expect(harness.vm.showEditError("host")).toBe(false);
  });

  it("keeps canCreate in sync with the absence of errors", async () => {
    const harness = await readyVm();

    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";
    expect(harness.vm.canCreate).toBe(true);

    harness.vm.formMtu = "100";
    expect(harness.vm.canCreate).toBe(false);

    harness.vm.formMtu = "1420";
    expect(harness.vm.canCreate).toBe(true);
  });

  it("keeps canSaveEdit in sync with the absence of errors", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());

    expect(harness.vm.canSaveEdit).toBe(true);

    harness.vm.editHost = "";
    expect(harness.vm.canSaveEdit).toBe(false);

    harness.vm.editHost = "vpn.example.com";
    harness.vm.editListenPort = "70000";
    expect(harness.vm.canSaveEdit).toBe(false);

    harness.vm.editListenPort = "51820";
    expect(harness.vm.canSaveEdit).toBe(true);
  });
});

describe("InterfacesPageVM discard guard", () => {
  beforeEach(() => {
    confirmMock.askConfirm.mockReset();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  it.each<[string, (vm: InterfacesPageVM) => void]>([
    ["name", (vm) => { vm.formName = "wg1"; }],
    ["label", (vm) => { vm.formLabel = "Основной"; }],
    ["host", (vm) => { vm.formEndpointHost = "vpn.example.com"; }],
    ["endpoint port", (vm) => { vm.formEndpointPort = "8443"; }],
    ["listen port", (vm) => { vm.formListenPort = "51821"; }],
    ["mtu", (vm) => { vm.formMtu = "1380"; }],
  ])("tracks create changes of %s", (_field, mutate) => {
    const harness = makeVm();
    harness.vm.openCreate();
    expect(harness.vm.createDirty).toBe(false);

    mutate(harness.vm);

    expect(harness.vm.createDirty).toBe(true);
  });

  it("tracks edit changes of every field", () => {
    const harness = makeVm();
    harness.vm.openEdit(iface());
    expect(harness.vm.editDirty).toBe(false);

    harness.vm.editLabel = "Новый";
    expect(harness.vm.editDirty).toBe(true);
  });

  it("closes an untouched create form without confirmation", async () => {
    const harness = makeVm();
    harness.vm.openCreate();

    await harness.vm.closeCreate();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(harness.vm.createOpen).toBe(false);
  });

  it("asks before discarding the create form", async () => {
    const harness = makeVm();
    harness.vm.openCreate();
    harness.vm.formName = "wg1";

    await harness.vm.closeCreate();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Отменить создание?",
      message: "Введённые данные не сохранятся.",
      confirmLabel: "Не создавать",
      tone: "danger",
    });
    expect(harness.vm.createOpen).toBe(false);
  });

  it("keeps the create form open when the discard is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const harness = makeVm();
    harness.vm.openCreate();
    harness.vm.formName = "wg1";

    await harness.vm.closeCreate();

    expect(harness.vm.createOpen).toBe(true);
    expect(harness.vm.formName).toBe("wg1");
    expect(harness.vm.createDirty).toBe(true);
  });

  it("asks before discarding the edit form", async () => {
    const harness = makeVm();
    harness.vm.openEdit(iface());
    harness.vm.editHost = "new.example.com";

    await harness.vm.closeEdit();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Отменить изменения?",
      message: "Несохранённые изменения будут потеряны.",
      confirmLabel: "Не сохранять",
      tone: "danger",
    });
    expect(harness.vm.editing).toBeNull();
  });

  it("keeps the edit form open when the discard is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const harness = makeVm();
    harness.vm.openEdit(iface());
    harness.vm.editHost = "new.example.com";

    await harness.vm.closeEdit();

    expect(harness.vm.editing).not.toBeNull();
    expect(harness.vm.editHost).toBe("new.example.com");
    expect(harness.vm.editDirty).toBe(true);
  });

  it("does not ask while the create request is running", async () => {
    const harness = makeVm();
    harness.vm.openCreate();
    harness.vm.formName = "wg1";
    harness.vm.busy = true;

    await harness.vm.closeCreate();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(harness.vm.createOpen).toBe(true);
  });

  it("resets the create snapshot after a successful creation", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    await harness.vm.load();
    harness.vm.openCreate();
    harness.vm.formName = "wg0";
    harness.vm.formEndpointHost = "vpn.example.com";

    await harness.vm.submitCreate(submit());

    expect(harness.vm.createOpen).toBe(false);
    expect(harness.vm.createDirty).toBe(false);

    harness.vm.formName = "wg0";
    await harness.vm.closeCreate();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
  });

  it("resets the edit snapshot after a successful save", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    harness.vm.editHost = "new.example.com";

    await harness.vm.submitEdit(submit());

    expect(harness.vm.editing).toBeNull();
    expect(harness.vm.editDirty).toBe(false);
  });
});
