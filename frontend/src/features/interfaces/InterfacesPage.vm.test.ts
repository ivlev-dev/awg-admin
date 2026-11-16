import { InterfacesPageVM } from "./InterfacesPage.vm";
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
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { NodeCreated } from "@/domain/nodes/types";
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
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

function user(role: Role, groupId: string | null): User {
  return { ...ADMIN, id: `u-${role}`, login: role, role, group_id: groupId };
}

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
    changePassword: vi.fn(async () => undefined),
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

class MemoryInterfacesRepository implements InterfacesRepository {
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
}

class MemoryGroupsRepository implements GroupsRepository {
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
}

class MemoryNodesRepository implements NodesRepository {
  readonly items = new Map<string, NodeInfo>();

  listNodes = vi.fn(async (): Promise<NodeInfo[]> => [...this.items.values()]);

  createNode = vi.fn(async (name: string): Promise<NodeCreated> => ({
    node: { id: `n${this.items.size + 1}`, name, created_at: "2020-01-01T00:00:00Z" },
    token: "token",
  }));

  deleteNode = vi.fn(async (): Promise<void> => undefined);
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
    window.confirm = vi.fn(() => true);
  });

  it("loads interfaces, groups and nodes", async () => {
    const harness = makeVm();
    harness.groupsRepo.groups.set("g1", GROUP);
    harness.nodesRepo.items.set("n1", NODE);
    harness.interfacesRepo.items.set("i2", iface({ id: "i2", name: "wg1", group_name: "Офис" }));
    harness.interfacesRepo.items.set("i1", iface({ id: "i1", name: "wg0", group_name: "Дом" }));

    await harness.vm.load();

    expect(harness.vm.interfaces.map((item) => item.id)).toEqual(["i1", "i2"]);
    expect(harness.vm.groups).toHaveLength(1);
    expect(harness.vm.nodes).toHaveLength(1);
    expect(harness.vm.loading).toBe(false);
    expect(harness.vm.error).toBeNull();
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
    window.confirm = vi.fn(() => false);

    await harness.vm.rotate(iface());

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
    window.confirm = vi.fn(() => false);

    await harness.vm.remove(iface());

    expect(harness.interfacesRepo.deleteInterface).not.toHaveBeenCalled();
    expect(harness.vm.interfaces).toHaveLength(1);
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
