import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { GroupsService } from "@/application/groups/service";
import { TariffsService } from "@/application/tariffs/service";
import { UsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { LoginInput } from "@/domain/auth/types";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type {
  AuthSession,
  CidrPool,
  Group,
  Tariff,
  User,
} from "@/domain/types";
import type { UsersRepository } from "@/domain/users/repository";
import type { CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { TokenStore } from "@/infrastructure/storage";
import { UsersPageVM } from "./UsersPage.vm";

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

class StubUsersRepository implements UsersRepository {
  async listUsers(): Promise<User[]> {
    return [ADMIN];
  }

  async createUser(_input: CreateUserInput): Promise<User> {
    return ADMIN;
  }

  async updateUser(_id: string, _input: UpdateUserInput): Promise<User> {
    return ADMIN;
  }

  async deleteUser(_id: string): Promise<void> {}

  async resetPassword(_id: string, _password: string): Promise<void> {}
}

class StubTariffsRepository implements TariffsRepository {
  async listTariffs(): Promise<Tariff[]> {
    return [TARIFF];
  }

  async createTariff(_input: TariffInput): Promise<Tariff> {
    return TARIFF;
  }

  async updateTariff(_id: string, _input: Partial<TariffInput>): Promise<Tariff> {
    return TARIFF;
  }

  async deleteTariff(_id: string): Promise<void> {}
}

class StubGroupsRepository implements GroupsRepository {
  async listGroups(): Promise<Group[]> {
    return [GROUP];
  }

  async createGroup(_input: GroupInput): Promise<Group> {
    return GROUP;
  }

  async updateGroup(_id: string, _input: Partial<GroupInput>): Promise<Group> {
    return GROUP;
  }

  async deleteGroup(_id: string): Promise<void> {}

  async listPools(_groupId: string): Promise<CidrPool[]> {
    return [];
  }

  async createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    return { id: "p1", group_id: groupId, ...input, enabled: true };
  }

  async updatePool(
    id: string,
    input: Partial<PoolInput> & { enabled?: boolean },
  ): Promise<CidrPool> {
    return {
      id,
      group_id: GROUP.id,
      name: "pool",
      cidr: "10.0.1.0/24",
      mode: "auto",
      gateway: null,
      enabled: true,
      ...input,
    };
  }

  async deletePool(_id: string): Promise<void> {}
}

class StubAuthRepository implements AuthRepository {
  async login(_input: LoginInput): Promise<AuthSession> {
    throw new Error("not used");
  }

  async refresh(_refreshToken: string): Promise<AuthSession> {
    throw new Error("not used");
  }

  async logout(_refreshToken: string): Promise<void> {}

  async me(): Promise<User> {
    return ADMIN;
  }

  async changePassword(_current: string | null, _next: string): Promise<void> {}
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

let captured: UsersPageVM | null = null;

function UsersVmProbe(this: { vm: UsersPageVM }) {
  captured = this.vm;
  return <div class="users-vm-probe">{this.vm.selfId}</div>;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
}

function stubApi(): void {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/users")) return jsonResponse([ADMIN]);
      if (url.endsWith("/tariffs")) return jsonResponse([TARIFF]);
      if (url.endsWith("/groups")) return jsonResponse([GROUP]);
      return jsonResponse([]);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersPageVM constructor DI", () => {
  it("resolves injected service instances through createComponent", async () => {
    const session = new Session(new StubAuthRepository(), new MemoryTokenStore());
    session.user = ADMIN;
    const toasts = new ToastStore();
    const container = createAppContainer();
    container.bind(UsersService, () => new UsersService(new StubUsersRepository()));
    container.bind(TariffsService, () => new TariffsService(new StubTariffsRepository()));
    container.bind(GroupsService, () => new GroupsService(new StubGroupsRepository()));
    container.bind(Session, () => session);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(UsersVmProbe, {}, { container });
    await result.ready;

    const vm = captured;
    expect(vm).toBeInstanceOf(UsersPageVM);
    if (vm === null) throw new Error("VM не был смонтирован");
    await vm.load();

    expect(vm.error).toBeNull();
    expect(vm.users).toEqual([ADMIN]);
    expect(vm.tariffs).toEqual([TARIFF]);
    expect(vm.groups).toEqual([GROUP]);
    expect(result.node.textContent).toBe(ADMIN.id);
    result.dispose();
  });

  it("auto-wires a ViewModel with class services", async () => {
    stubApi();
    const container = createAppContainer();

    const result = createComponent(UsersVmProbe, {}, { container });
    await result.ready;

    const vm = captured;
    expect(vm).toBeInstanceOf(UsersPageVM);
    if (vm === null) throw new Error("VM не был смонтирован");
    await vm.load();

    expect(vm.error).toBeNull();
    expect(vm.users).toEqual([ADMIN]);
    expect(vm.tariffs).toEqual([TARIFF]);
    expect(vm.groups).toEqual([GROUP]);
    result.dispose();
  });
});
