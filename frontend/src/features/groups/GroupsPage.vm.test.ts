import { createComponent } from "@ivlev-dev/silent-core";

import { GroupsPageVM } from "./GroupsPage.vm";
import { GroupsPage } from "./GroupsPage";
import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { DefaultGroupsService } from "@/application/groups/service";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { CidrPool, Group } from "@/domain/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    name: "Офис",
    description: "Москва",
    base_cidr: "10.8.0.0/16",
    forwarding_default: false,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    interfaces: 0,
    devices: 0,
    ...overrides,
  };
}

function pool(overrides: Partial<CidrPool> = {}): CidrPool {
  return {
    id: "p1",
    group_id: "g1",
    name: "Пул",
    cidr: "10.8.0.0/24",
    mode: "auto",
    gateway: null,
    enabled: true,
    ...overrides,
  };
}

class MemoryGroupsRepository implements GroupsRepository {
  private seq = 0;

  readonly groups = new Map<string, Group>();
  readonly pools = new Map<string, CidrPool>();

  listGroups = vi.fn(async (): Promise<Group[]> => [...this.groups.values()]);

  createGroup = vi.fn(async (input: GroupInput): Promise<Group> => {
    const created = group({ id: `g${++this.seq}`, ...input });
    this.groups.set(created.id, created);
    return created;
  });

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

function makeVm(repo: MemoryGroupsRepository = new MemoryGroupsRepository()): {
  vm: GroupsPageVM;
  repo: MemoryGroupsRepository;
  router: Router;
  toasts: ToastStore;
} {
  const service = new DefaultGroupsService(repo);
  const router = new Router();
  const toasts = new ToastStore();
  return { vm: new GroupsPageVM(service, router, toasts), repo, router, toasts };
}

function submit(): Event {
  return new Event("submit", { cancelable: true });
}

describe("GroupsPageVM", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/groups");
  });

  it("loads groups through the service", async () => {
    const repo = new MemoryGroupsRepository();
    repo.groups.set("g1", group());
    const { vm } = makeVm(repo);

    await vm.load();

    expect(vm.groups).toHaveLength(1);
    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(repo.listGroups).toHaveBeenCalledTimes(1);
  });

  it("reports a load error and pushes a toast", async () => {
    const repo = new MemoryGroupsRepository();
    repo.listGroups.mockRejectedValueOnce(new Error("boom"));
    const { vm, toasts } = makeVm(repo);

    await vm.load();

    expect(vm.groups).toEqual([]);
    expect(vm.error).toBe("boom");
    expect(toasts.items.some((item) => item.kind === "error" && item.message === "boom")).toBe(true);
  });

  it("creates a group and reloads the list", async () => {
    const repo = new MemoryGroupsRepository();
    const { vm, toasts } = makeVm(repo);
    vm.openCreate();
    vm.formName = " Офис ";
    vm.formDescription = " Москва ";
    vm.formBaseCidr = "10.8.0.0/16 ";

    await vm.save(submit());

    expect(repo.createGroup).toHaveBeenCalledWith({
      name: "Офис",
      description: "Москва",
      base_cidr: "10.8.0.0/16",
      forwarding_default: false,
    });
    expect(vm.groups).toHaveLength(1);
    expect(vm.modalOpen).toBe(false);
    expect(toasts.items.some((item) => item.message === "Группа «Офис» создана")).toBe(true);
  });

  it("updates the edited group", async () => {
    const repo = new MemoryGroupsRepository();
    repo.groups.set("g1", group());
    const { vm } = makeVm(repo);
    vm.openEdit(group());
    vm.formName = "Офис 2";
    vm.formBaseCidr = "10.9.0.0/16";
    vm.formForwarding = true;

    await vm.save(submit());

    expect(repo.updateGroup).toHaveBeenCalledWith("g1", {
      name: "Офис 2",
      description: "Москва",
      base_cidr: "10.9.0.0/16",
      forwarding_default: true,
    });
    expect(vm.groups[0]?.name).toBe("Офис 2");
  });

  it("rejects an invalid base CIDR before calling the service", async () => {
    const { vm, repo } = makeVm();
    vm.openCreate();
    vm.formName = "Офис";
    vm.formBaseCidr = "10.8.0.0/33";

    await vm.save(submit());

    expect(repo.createGroup).not.toHaveBeenCalled();
    expect(vm.formError).toBe("Базовая сеть должна быть в формате CIDR, например 10.8.0.0/16");
  });

  it("requires a group name", async () => {
    const { vm, repo } = makeVm();
    vm.openCreate();
    vm.formBaseCidr = "10.8.0.0/16";

    await vm.save(submit());

    expect(repo.createGroup).not.toHaveBeenCalled();
    expect(vm.formError).toBe("Укажите название группы");
  });

  it("shows a service error when saving fails", async () => {
    const repo = new MemoryGroupsRepository();
    repo.createGroup.mockRejectedValueOnce(new Error("server down"));
    const { vm } = makeVm(repo);
    vm.openCreate();
    vm.formName = "Офис";
    vm.formBaseCidr = "10.8.0.0/16";

    await vm.save(submit());

    expect(vm.formError).toBe("server down");
    expect(vm.saving).toBe(false);
  });

  it("deletes a confirmed group", async () => {
    const repo = new MemoryGroupsRepository();
    repo.groups.set("g1", group());
    const { vm, toasts } = makeVm(repo);
    window.confirm = vi.fn(() => true);

    await vm.remove(group());

    expect(repo.deleteGroup).toHaveBeenCalledWith("g1");
    expect(vm.groups).toEqual([]);
    expect(toasts.items.some((item) => item.message === "Группа «Офис» удалена")).toBe(true);
  });

  it("does not delete when the confirmation is rejected", async () => {
    const repo = new MemoryGroupsRepository();
    const { vm } = makeVm(repo);
    window.confirm = vi.fn(() => false);

    await vm.remove(group());

    expect(repo.deleteGroup).not.toHaveBeenCalled();
  });

  it("explains that interfaces block group deletion", async () => {
    const repo = new MemoryGroupsRepository();
    repo.deleteGroup.mockRejectedValueOnce(new Error("group still has interfaces"));
    const { vm } = makeVm(repo);
    window.confirm = vi.fn(() => true);

    await vm.remove(group());

    expect(vm.error).toBe("Группа «Офис» содержит интерфейсы — сначала отвяжите их от группы.");
  });

  it("opens the group page through the router", () => {
    const { vm, router } = makeVm();

    vm.open(group());

    expect(router.path).toBe("/groups/g1");
  });

  it("is resolved by the DI container", async () => {
    const container = createAppContainer();
    const vm = await container.resolve(GroupsPageVM);

    expect(vm).toBeInstanceOf(GroupsPageVM);
  });

  it("mounts the view with an injected service", async () => {
    const repo = new MemoryGroupsRepository();
    repo.groups.set("g1", group());
    const service = new DefaultGroupsService(repo);
    const container = createAppContainer();
    container.bind(DefaultGroupsService, () => service);
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(GroupsPage, {}, { container });
    await result.ready;

    await vi.waitFor(() => expect(result.node.textContent).toContain("Офис"));
    result.dispose();
  });
});
