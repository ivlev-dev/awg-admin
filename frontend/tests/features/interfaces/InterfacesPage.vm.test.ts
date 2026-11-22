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
import type { InterfaceEditForm, InterfaceForm } from "@/features/interfaces/interface.form";

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

type InterfaceFormField =
  | "name"
  | "label"
  | "endpointHost"
  | "endpointPort"
  | "listenPort"
  | "mtu";

type InterfaceEditFormField =
  | "label"
  | "endpointHost"
  | "endpointPort"
  | "listenPort"
  | "mtu";

function fillCreate(form: InterfaceForm, values: Partial<Record<InterfaceFormField, string>>): void {
  for (const [field, value] of Object.entries(values)) {
    if (value !== undefined) {
      form.getFieldProps(field as InterfaceFormField).onInput({ currentTarget: { value } });
    }
  }
}

function fillEdit(form: InterfaceEditForm, values: Partial<Record<InterfaceEditFormField, string>>): void {
  for (const [field, value] of Object.entries(values)) {
    if (value !== undefined) {
      form.getFieldProps(field as InterfaceEditFormField).onInput({ currentTarget: { value } });
    }
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    fillCreate(harness.vm.createForm, {
      name: " wg0 ",
      label: " Основной ",
      endpointHost: "vpn.example.com",
    });
    await settle();

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
    fillCreate(harness.vm.createForm, {
      name: "wg0",
      endpointHost: "vpn.example.com",
      endpointPort: "70000",
    });
    await settle();

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
    fillCreate(harness.vm.createForm, {
      name: "wg0",
      endpointHost: "vpn.example.com",
      listenPort: "0",
    });
    await settle();

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
    fillCreate(harness.vm.createForm, {
      name: "wg0",
      endpointHost: "vpn.example.com",
      mtu: "100",
    });
    await settle();

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
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    await settle();

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
    fillEdit(harness.vm.editForm, {
      label: "Новый",
      endpointHost: "new.example.com",
      endpointPort: "8443",
      listenPort: "51821",
      mtu: "1380",
    });
    harness.vm.editForm.getFieldProps("enabled").onChange({
      currentTarget: { checked: false, type: "checkbox" },
    });
    await settle();

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
    fillEdit(harness.vm.editForm, { mtu: "65536" });
    await settle();

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
    expect(harness.interfacesRepo.listInterfaces.mock.calls.length).toBe(listCalls);
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
    expect(harness.vm.createForm.groupId).toBe("g2");
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

describe("InterfacesPageVM форма создания", () => {
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

  it("требует имя интерфейса", async () => {
    const harness = await readyVm();
    const name = harness.vm.createForm.getFieldProps("name");

    expect(await harness.vm.createForm.validate()).toBe(false);
    expect(name.error).toBe("Имя: латиница, цифры, _ и -");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("отклоняет имя длиннее 15 символов", async () => {
    const harness = await readyVm();
    const name = harness.vm.createForm.getFieldProps("name");
    name.setValue("abcdefghijklmnop");

    expect(await harness.vm.createForm.validate()).toBe(false);
    expect(name.error).toBe("Имя — не более 15 символов");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("отклоняет имя с пробелом внутри", async () => {
    const harness = await readyVm();
    const name = harness.vm.createForm.getFieldProps("name");
    name.onInput({ currentTarget: { value: "awg 0" } });
    await settle();

    expect(name.error).toBe("Имя: латиница, цифры, _ и -");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("принимает имя с пробелами по краям", async () => {
    const harness = await readyVm();
    const name = harness.vm.createForm.getFieldProps("name");
    name.setValue(" wg0_1-a ");

    expect(await harness.vm.createForm.validateField("name")).toBe(true);
    expect(name.error).toBeUndefined();
  });

  it("требует endpoint host", async () => {
    const harness = await readyVm();
    harness.vm.createForm.getFieldProps("name").setValue("wg0");
    const host = harness.vm.createForm.getFieldProps("endpointHost");
    host.setValue("   ");

    expect(await harness.vm.createForm.validate()).toBe(false);
    expect(host.error).toBe("Укажите host без пробелов");
    expect(harness.vm.canCreate).toBe(false);
  });

  it("отклоняет endpoint host с пробелом внутри", async () => {
    const harness = await readyVm();
    harness.vm.createForm.getFieldProps("name").setValue("wg0");
    const host = harness.vm.createForm.getFieldProps("endpointHost");
    host.onInput({ currentTarget: { value: "vpn example.com" } });
    await settle();

    expect(host.error).toBe("Укажите host без пробелов");
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["0", "65536", "-1", "1.5"])(
    "отклоняет endpoint port %s",
    async (value) => {
      const harness = await readyVm();
      fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
      const port = harness.vm.createForm.getFieldProps("endpointPort");
      port.onInput({ currentTarget: { value } });
      await settle();

      expect(port.error).toBe("Порт — целое число от 1 до 65535");
      expect(harness.vm.canCreate).toBe(false);
    },
  );

  it.each(["", "abc"])("ловит нечисловой endpoint port %s", async (value) => {
    const harness = await readyVm();
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    const port = harness.vm.createForm.getFieldProps("endpointPort");
    port.onInput({ currentTarget: { value } });
    await settle();

    expect(port.error).toBeDefined();
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["0", "65536"])("отклоняет listen port %s", async (value) => {
    const harness = await readyVm();
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    const port = harness.vm.createForm.getFieldProps("listenPort");
    port.onInput({ currentTarget: { value } });
    await settle();

    expect(port.error).toBe("Порт — целое число от 1 до 65535");
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["", "abc"])("ловит нечисловой listen port %s", async (value) => {
    const harness = await readyVm();
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    const port = harness.vm.createForm.getFieldProps("listenPort");
    port.onInput({ currentTarget: { value } });
    await settle();

    expect(port.error).toBeDefined();
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["575", "65536"])("отклоняет MTU %s", async (value) => {
    const harness = await readyVm();
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    const mtu = harness.vm.createForm.getFieldProps("mtu");
    mtu.onInput({ currentTarget: { value } });
    await settle();

    expect(mtu.error).toBe("MTU — от 576 до 65535");
    expect(harness.vm.canCreate).toBe(false);
  });

  it.each(["", "abc"])("ловит нечисловой MTU %s", async (value) => {
    const harness = await readyVm();
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    const mtu = harness.vm.createForm.getFieldProps("mtu");
    mtu.onInput({ currentTarget: { value } });
    await settle();

    expect(mtu.error).toBeDefined();
    expect(harness.vm.canCreate).toBe(false);
  });

  it("разрешает создание с корректными значениями", async () => {
    const harness = await readyVm();
    fillCreate(harness.vm.createForm, {
      name: "wg0",
      endpointHost: "vpn.example.com",
      endpointPort: "443",
      listenPort: "51820",
      mtu: "1420",
    });

    expect(await harness.vm.createForm.validate()).toBe(true);
    expect(harness.vm.canCreate).toBe(true);
  });

  it("показывает ошибку только после blur или submit", async () => {
    const harness = await readyVm();
    const name = harness.vm.createForm.getFieldProps("name");
    name.onInput({ currentTarget: { value: "awg 0" } });
    await settle();

    expect(name.error).toBeDefined();
    expect(name.touched).toBe(false);

    name.onBlur();
    expect(name.touched).toBe(true);

    await harness.vm.submitCreate(submit());
    expect(harness.interfacesRepo.createInterface).not.toHaveBeenCalled();
    expect(name.touched).toBe(true);
  });

  it("сбрасывает touched и ошибки при повторном открытии формы", async () => {
    const harness = await readyVm();
    const name = harness.vm.createForm.getFieldProps("name");
    name.onBlur();
    expect(name.touched).toBe(true);

    await harness.vm.closeCreate();
    harness.vm.openCreate();

    expect(name.touched).toBe(false);
    expect(name.error).toBeUndefined();
    expect(harness.vm.createForm.isDirty).toBe(false);
  });

  it("проверяет поля редактирования", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    const form = harness.vm.editForm;
    form.getFieldProps("endpointHost").setValue("");
    form.getFieldProps("endpointPort").setValue(0);
    form.getFieldProps("listenPort").setValue(70000);
    form.getFieldProps("mtu").setValue(65536);

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("endpointHost").error).toBe("Укажите host без пробелов");
    expect(form.getFieldProps("endpointPort").error).toBe("Порт — целое число от 1 до 65535");
    expect(form.getFieldProps("listenPort").error).toBe("Порт — целое число от 1 до 65535");
    expect(form.getFieldProps("mtu").error).toBe("MTU — от 576 до 65535");
    expect(harness.vm.canSaveEdit).toBe(false);
  });

  it("принимает корректные значения редактирования", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());

    expect(await harness.vm.editForm.validate()).toBe(true);
    expect(harness.vm.editForm.getFieldProps("endpointHost").error).toBeUndefined();
    expect(harness.vm.canSaveEdit).toBe(true);
  });
});
describe("InterfacesPageVM discard guard", () => {
  beforeEach(() => {
    confirmMock.askConfirm.mockReset();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  it.each<[string, (vm: InterfacesPageVM) => void]>([
    ["name", (vm) => { vm.createForm.getFieldProps("name").onInput({ currentTarget: { value: "wg1" } }); }],
    ["label", (vm) => { vm.createForm.getFieldProps("label").onInput({ currentTarget: { value: "Основной" } }); }],
    ["host", (vm) => { vm.createForm.getFieldProps("endpointHost").onInput({ currentTarget: { value: "vpn.example.com" } }); }],
    ["endpoint port", (vm) => { vm.createForm.getFieldProps("endpointPort").onInput({ currentTarget: { value: "8443" } }); }],
    ["listen port", (vm) => { vm.createForm.getFieldProps("listenPort").onInput({ currentTarget: { value: "51821" } }); }],
    ["mtu", (vm) => { vm.createForm.getFieldProps("mtu").onInput({ currentTarget: { value: "1380" } }); }],
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

    harness.vm.editForm.getFieldProps("label").onInput({ currentTarget: { value: "Новый" } });
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
    harness.vm.createForm.getFieldProps("name").onInput({ currentTarget: { value: "wg1" } });

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
    harness.vm.createForm.getFieldProps("name").onInput({ currentTarget: { value: "wg1" } });

    await harness.vm.closeCreate();

    expect(harness.vm.createOpen).toBe(true);
    expect(harness.vm.createForm.name).toBe("wg1");
    expect(harness.vm.createDirty).toBe(true);
  });

  it("asks before discarding the edit form", async () => {
    const harness = makeVm();
    harness.vm.openEdit(iface());
    harness.vm.editForm.getFieldProps("endpointHost").onInput({
      currentTarget: { value: "new.example.com" },
    });

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
    harness.vm.editForm.getFieldProps("endpointHost").onInput({
      currentTarget: { value: "new.example.com" },
    });

    await harness.vm.closeEdit();

    expect(harness.vm.editing).not.toBeNull();
    expect(harness.vm.editForm.endpointHost).toBe("new.example.com");
    expect(harness.vm.editDirty).toBe(true);
  });

  it("does not ask while the create request is running", async () => {
    const harness = makeVm();
    harness.vm.openCreate();
    harness.vm.createForm.getFieldProps("name").onInput({ currentTarget: { value: "wg1" } });
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
    fillCreate(harness.vm.createForm, { name: "wg0", endpointHost: "vpn.example.com" });
    await settle();

    await harness.vm.submitCreate(submit());

    expect(harness.vm.createOpen).toBe(false);
    expect(harness.vm.createDirty).toBe(false);

    harness.vm.openCreate();
    await harness.vm.closeCreate();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
  });

  it("resets the edit snapshot after a successful save", async () => {
    const harness = makeVm();
    harness.interfacesRepo.items.set("i1", iface());
    await harness.vm.load();
    harness.vm.openEdit(iface());
    harness.vm.editForm.getFieldProps("endpointHost").onInput({
      currentTarget: { value: "new.example.com" },
    });
    await settle();

    await harness.vm.submitEdit(submit());

    expect(harness.vm.editing).toBeNull();
    expect(harness.vm.editDirty).toBe(false);
  });
});
