import { GroupDetailsVM } from "./GroupDetails.vm";
import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { GroupsService } from "@/application/groups/service";
import { InterfacesService } from "@/application/interfaces/service";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { CidrPool, Group, InterfaceInfo } from "@/domain/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    name: "Офис",
    description: "Москва",
    base_cidr: "10.8.0.0/16",
    forwarding_default: false,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    interfaces: 1,
    devices: 2,
    ...overrides,
  };
}

function pool(overrides: Partial<CidrPool> = {}): CidrPool {
  return {
    id: "p1",
    group_id: "g1",
    name: "Пул",
    cidr: "10.8.1.0/24",
    mode: "auto",
    gateway: null,
    enabled: true,
    ...overrides,
  };
}

function iface(overrides: Partial<InterfaceInfo> = {}): InterfaceInfo {
  return {
    id: "i1",
    group_id: "g1",
    group_name: "Офис",
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

class MemoryGroupsRepository implements GroupsRepository {
  private seq = 0;

  readonly groups = new Map<string, Group>();
  readonly pools = new Map<string, CidrPool>();

  listGroups = vi.fn(async (): Promise<Group[]> => [...this.groups.values()]);

  createGroup = vi.fn(async (input: GroupInput): Promise<Group> => group({ id: `g${++this.seq}`, ...input }));

  updateGroup = vi.fn(async (id: string, input: Partial<GroupInput>): Promise<Group> => {
    const current = this.groups.get(id);
    if (!current) throw new Error("not found");
    const updated: Group = { ...current, ...input };
    this.groups.set(id, updated);
    return updated;
  });

  deleteGroup = vi.fn(async (id: string): Promise<void> => {
    this.groups.delete(id);
  });

  listPools = vi.fn(async (groupId: string): Promise<CidrPool[]> =>
    [...this.pools.values()].filter((item) => item.group_id === groupId),
  );

  createPool = vi.fn(async (groupId: string, input: PoolInput): Promise<CidrPool> => {
    const created = pool({ id: `p${++this.seq}`, group_id: groupId, ...input });
    this.pools.set(created.id, created);
    return created;
  });

  updatePool = vi.fn(
    async (id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool> => {
      const current = this.pools.get(id);
      if (!current) throw new Error("not found");
      const updated: CidrPool = { ...current, ...input };
      this.pools.set(id, updated);
      return updated;
    },
  );

  deletePool = vi.fn(async (id: string): Promise<void> => {
    this.pools.delete(id);
  });
}

class MemoryInterfacesRepository implements InterfacesRepository {
  readonly items = new Map<string, InterfaceInfo>();

  listInterfaces = vi.fn(async (): Promise<InterfaceInfo[]> => [...this.items.values()]);

  createInterface = vi.fn(async (input: InterfaceInput): Promise<InterfaceInfo> => {
    const created = iface({
      id: `i${this.items.size + 1}`,
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
    const updated: InterfaceInfo = { ...current, public_key: "rotated" };
    this.items.set(id, updated);
    return updated;
  });

  deleteInterface = vi.fn(async (id: string): Promise<void> => {
    this.items.delete(id);
  });
}

function makeVm(groupsRepo = new MemoryGroupsRepository()): {
  vm: GroupDetailsVM;
  groupsRepo: MemoryGroupsRepository;
  interfacesRepo: MemoryInterfacesRepository;
  router: Router;
  toasts: ToastStore;
} {
  const interfacesRepo = new MemoryInterfacesRepository();
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new GroupDetailsVM(
    new GroupsService(groupsRepo),
    new InterfacesService(interfacesRepo),
    router,
    toasts,
  );
  return { vm, groupsRepo, interfacesRepo, router, toasts };
}

function submit(): Event {
  return new Event("submit", { cancelable: true });
}

describe("GroupDetailsVM", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/groups/g1");
    window.confirm = vi.fn(() => true);
  });

  it("loads the group, its pools and its interfaces", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    groupsRepo.pools.set("p1", pool());
    groupsRepo.pools.set("p2", pool({ id: "p2", group_id: "g2" }));
    const { vm, interfacesRepo } = makeVm(groupsRepo);
    interfacesRepo.items.set("i1", iface());
    interfacesRepo.items.set("i2", iface({ id: "i2", group_id: "g2" }));

    await vm.load();

    expect(vm.groupId).toBe("g1");
    expect(vm.group?.name).toBe("Офис");
    expect(vm.pools).toHaveLength(1);
    expect(vm.interfaces.map((item) => item.id)).toEqual(["i1"]);
    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
  });

  it("clears state when the group is missing", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    const { vm } = makeVm(groupsRepo);

    await vm.load();

    expect(vm.group).toBeNull();
    expect(vm.pools).toEqual([]);
    expect(vm.interfaces).toEqual([]);
  });

  it("reports a load error", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.listGroups.mockRejectedValueOnce(new Error("boom"));
    const { vm, toasts } = makeVm(groupsRepo);

    await vm.load();

    expect(vm.error).toBe("boom");
    expect(toasts.items.some((item) => item.kind === "error")).toBe(true);
  });

  it("updates the group through the service", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm, toasts } = makeVm(groupsRepo);
    await vm.load();
    vm.openForm();
    vm.formName = "Офис 2";
    vm.formBaseCidr = "10.9.0.0/16";
    vm.formForwarding = true;

    await vm.saveForm(submit());

    expect(groupsRepo.updateGroup).toHaveBeenCalledWith("g1", {
      name: "Офис 2",
      description: "Москва",
      base_cidr: "10.9.0.0/16",
      forwarding_default: true,
    });
    expect(vm.group?.name).toBe("Офис 2");
    expect(vm.formOpen).toBe(false);
    expect(toasts.items.some((item) => item.message === "Группа «Офис 2» обновлена")).toBe(true);
  });

  it("rejects an invalid base CIDR when saving the group", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openForm();
    vm.formBaseCidr = "10.8.0.0";

    await vm.saveForm(submit());

    expect(groupsRepo.updateGroup).not.toHaveBeenCalled();
    expect(vm.formError).toBe("Базовая сеть должна быть в формате CIDR, например 10.8.0.0/16");
  });

  it("surfaces a group update error", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    groupsRepo.updateGroup.mockRejectedValueOnce(new Error("conflict"));
    vm.openForm();

    await vm.saveForm(submit());

    expect(vm.formError).toBe("conflict");
    expect(vm.formSaving).toBe(false);
  });

  it("creates a pool inside the base network", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openPoolForm();
    vm.poolName = " Новый ";
    vm.poolCidr = "10.8.5.0/24";
    vm.poolMode = "rf_only";
    vm.poolGateway = "10.8.0.1";

    await vm.savePool(submit());

    expect(groupsRepo.createPool).toHaveBeenCalledWith("g1", {
      name: "Новый",
      cidr: "10.8.5.0/24",
      mode: "rf_only",
      gateway: "10.8.0.1",
    });
    expect(vm.pools).toHaveLength(1);
    expect(vm.poolOpen).toBe(false);
  });

  it("rejects a pool with an invalid CIDR", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openPoolForm();
    vm.poolName = "Пул";
    vm.poolCidr = "10.8.0.0/40";

    await vm.savePool(submit());

    expect(groupsRepo.createPool).not.toHaveBeenCalled();
    expect(vm.poolError).toBe("CIDR должен быть в формате 10.8.0.0/24");
  });

  it("rejects a pool outside the base network", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openPoolForm();
    vm.poolName = "Пул";
    vm.poolCidr = "10.9.0.0/24";

    await vm.savePool(submit());

    expect(groupsRepo.createPool).not.toHaveBeenCalled();
    expect(vm.poolError).toBe("Диапазон должен находиться внутри базовой сети 10.8.0.0/16");
  });

  it("requires a base network before creating a pool", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group({ base_cidr: "" }));
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openPoolForm();
    vm.poolName = "Пул";
    vm.poolCidr = "10.8.0.0/24";

    await vm.savePool(submit());

    expect(groupsRepo.createPool).not.toHaveBeenCalled();
    expect(vm.poolError).toBe("Сначала задайте базовую сеть группы");
  });

  it("requires a pool name", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openPoolForm();
    vm.poolCidr = "10.8.0.0/24";

    await vm.savePool(submit());

    expect(groupsRepo.createPool).not.toHaveBeenCalled();
    expect(vm.poolError).toBe("Укажите название пула");
  });

  it("updates an existing pool", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    groupsRepo.pools.set("p1", pool());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    vm.openPoolForm(pool());
    vm.poolName = "Пул 2";
    vm.poolEnabled = false;

    await vm.savePool(submit());

    expect(groupsRepo.updatePool).toHaveBeenCalledWith("p1", {
      name: "Пул 2",
      mode: "auto",
      gateway: null,
      enabled: false,
    });
    expect(vm.pools[0]?.name).toBe("Пул 2");
  });

  it("deletes a confirmed pool", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    groupsRepo.pools.set("p1", pool());
    const { vm, toasts } = makeVm(groupsRepo);
    await vm.load();

    await vm.removePool(pool());

    expect(groupsRepo.deletePool).toHaveBeenCalledWith("p1");
    expect(vm.pools).toEqual([]);
    expect(toasts.items.some((item) => item.message === "Пул «Пул» удалён")).toBe(true);
  });

  it("keeps the pool when deletion is not confirmed", async () => {
    const groupsRepo = new MemoryGroupsRepository();
    groupsRepo.groups.set("g1", group());
    groupsRepo.pools.set("p1", pool());
    const { vm } = makeVm(groupsRepo);
    await vm.load();
    window.confirm = vi.fn(() => false);

    await vm.removePool(pool());

    expect(groupsRepo.deletePool).not.toHaveBeenCalled();
    expect(vm.pools).toHaveLength(1);
  });

  it("navigates back and to interfaces", () => {
    const { vm, router } = makeVm();

    vm.openInterfaces();
    expect(router.path).toBe("/interfaces");
    vm.back();
    expect(router.path).toBe("/groups");
  });

  it("is resolved by the DI container", async () => {
    const container = createAppContainer();
    const vm = await container.resolve(GroupDetailsVM);

    expect(vm).toBeInstanceOf(GroupDetailsVM);
  });
});
