import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { LoginInput } from "@/domain/auth/types";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState, UserQuota } from "@/domain/quota/types";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type {
  AuthSession,
  CidrPool,
  Group,
  Tariff,
  User,
} from "@/domain/types";
import type { CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { UsersRepository } from "@/domain/users/repository";
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

const ALICE: User = {
  id: "u2",
  login: "alice",
  role: "user",
  tariff_id: "t1",
  group_id: "g1",
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

const QUOTAS: UserQuota[] = [
  {
    user_id: "u1",
    login: "admin",
    used_bytes: 1024 * 1024 * 1024,
    quota_bytes: 10 * 1024 * 1024 * 1024,
    exceeded: false,
    percent: 10,
  },
  {
    user_id: "u2",
    login: "alice",
    used_bytes: 10 * 1024 * 1024 * 1024,
    quota_bytes: 10 * 1024 * 1024 * 1024,
    exceeded: true,
    percent: 100,
  },
];

class MemoryUsersRepository implements UsersRepository {
  users: User[];
  readonly passwords = new Map<string, string>();
  failure: Error | null = null;

  constructor(seed: User[]) {
    this.users = [...seed];
  }

  async listUsers(): Promise<User[]> {
    this.failIfNeeded();
    return [...this.users];
  }

  async createUser(input: CreateUserInput): Promise<User> {
    this.failIfNeeded();
    const user: User = {
      id: `u${this.users.length + 1}`,
      login: input.login,
      role: input.role,
      tariff_id: input.tariff_id,
      group_id: input.group_id,
      disabled: false,
      created_at: "2020-01-02T00:00:00Z",
      updated_at: "2020-01-02T00:00:00Z",
    };
    this.users.push(user);
    this.passwords.set(user.id, input.password);
    return user;
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    this.failIfNeeded();
    const user = this.find(id);
    this.replace({ ...user, ...input });
    return { ...user, ...input };
  }

  async deleteUser(id: string): Promise<void> {
    this.failIfNeeded();
    this.users = this.users.filter((user) => user.id !== id);
  }

  async resetPassword(id: string, password: string): Promise<void> {
    this.failIfNeeded();
    this.find(id);
    this.passwords.set(id, password);
  }

  private find(id: string): User {
    const user = this.users.find((item) => item.id === id);
    if (user === undefined) throw new Error(`Пользователь ${id} не найден`);
    return user;
  }

  private replace(next: User): void {
    this.users = this.users.map((user) => (user.id === next.id ? next : user));
  }

  private failIfNeeded(): void {
    if (this.failure !== null) throw this.failure;
  }
}

class MemoryTariffsRepository implements TariffsRepository {
  tariffs: Tariff[];
  failure: Error | null = null;

  constructor(seed: Tariff[]) {
    this.tariffs = [...seed];
  }

  async listTariffs(): Promise<Tariff[]> {
    if (this.failure !== null) throw this.failure;
    return [...this.tariffs];
  }

  async createTariff(input: TariffInput): Promise<Tariff> {
    if (this.failure !== null) throw this.failure;
    const tariff: Tariff = {
      id: `t${this.tariffs.length + 1}`,
      ...input,
      created_at: "2020-01-02T00:00:00Z",
      updated_at: "2020-01-02T00:00:00Z",
    };
    this.tariffs.push(tariff);
    return tariff;
  }

  async updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    const tariff = this.tariffs.find((item) => item.id === id);
    if (tariff === undefined) throw new Error(`Тариф ${id} не найден`);
    const next: Tariff = { ...tariff, ...input };
    this.tariffs = this.tariffs.map((item) => (item.id === id ? next : item));
    return next;
  }

  async deleteTariff(id: string): Promise<void> {
    this.tariffs = this.tariffs.filter((item) => item.id !== id);
  }
}

class MemoryGroupsRepository implements GroupsRepository {
  groups: Group[];
  readonly pools: CidrPool[] = [];
  failure: Error | null = null;

  constructor(seed: Group[]) {
    this.groups = [...seed];
  }

  async listGroups(): Promise<Group[]> {
    if (this.failure !== null) throw this.failure;
    return [...this.groups];
  }

  async createGroup(input: GroupInput): Promise<Group> {
    const group: Group = {
      id: `g${this.groups.length + 1}`,
      ...input,
      created_at: "2020-01-02T00:00:00Z",
      updated_at: "2020-01-02T00:00:00Z",
      interfaces: 0,
      devices: 0,
    };
    this.groups.push(group);
    return group;
  }

  async updateGroup(id: string, input: Partial<GroupInput>): Promise<Group> {
    const group = this.groups.find((item) => item.id === id);
    if (group === undefined) throw new Error(`Группа ${id} не найдена`);
    return { ...group, ...input };
  }

  async deleteGroup(id: string): Promise<void> {
    this.groups = this.groups.filter((item) => item.id !== id);
  }

  async listPools(groupId: string): Promise<CidrPool[]> {
    return this.pools.filter((pool) => pool.group_id === groupId);
  }

  async createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    const pool: CidrPool = {
      id: `p${this.pools.length + 1}`,
      group_id: groupId,
      ...input,
      enabled: true,
    };
    this.pools.push(pool);
    return pool;
  }

  async updatePool(
    id: string,
    input: Partial<PoolInput> & { enabled?: boolean },
  ): Promise<CidrPool> {
    const pool = this.pools.find((item) => item.id === id);
    if (pool === undefined) throw new Error(`Пул ${id} не найден`);
    return { ...pool, ...input };
  }

  async deletePool(id: string): Promise<void> {
    const index = this.pools.findIndex((pool) => pool.id === id);
    if (index >= 0) this.pools.splice(index, 1);
  }
}

class MemoryQuotaRepository implements QuotaRepository {
  quotas: UserQuota[];
  failure: Error | null = null;

  constructor(seed: UserQuota[]) {
    this.quotas = seed.map((quota) => ({ ...quota }));
  }

  async me(): Promise<QuotaState> {
    throw new Error("me is not used in this test");
  }

  async users(): Promise<UserQuota[]> {
    if (this.failure !== null) throw this.failure;
    return this.quotas.map((quota) => ({ ...quota }));
  }
}

class FakeAuthRepository implements AuthRepository {
  constructor(private readonly current: User) {}

  async login(_input: LoginInput): Promise<AuthSession> {
    return {
      token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      user: this.current,
    };
  }

  async refresh(_refreshToken: string): Promise<AuthSession> {
    return this.login({ login: this.current.login, password: "secret" });
  }

  async logout(_refreshToken: string): Promise<void> {}

  async me(): Promise<User> {
    return this.current;
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

interface SetupResult {
  vm: UsersPageVM;
  usersRepo: MemoryUsersRepository;
  tariffsRepo: MemoryTariffsRepository;
  groupsRepo: MemoryGroupsRepository;
  quotaRepo: MemoryQuotaRepository;
  toasts: ToastStore;
  session: Session;
  services: {
    users: DefaultUsersService;
    tariffs: DefaultTariffsService;
    groups: DefaultGroupsService;
    quota: DefaultQuotaService;
  };
}

function setup(
  seed: User[] = [ADMIN, ALICE],
  quotaSeed: UserQuota[] = QUOTAS,
): SetupResult {
  const usersRepo = new MemoryUsersRepository(seed);
  const tariffsRepo = new MemoryTariffsRepository([TARIFF]);
  const groupsRepo = new MemoryGroupsRepository([GROUP]);
  const quotaRepo = new MemoryQuotaRepository(quotaSeed);
  const services = {
    users: new DefaultUsersService(usersRepo),
    tariffs: new DefaultTariffsService(tariffsRepo),
    groups: new DefaultGroupsService(groupsRepo),
    quota: new DefaultQuotaService(quotaRepo),
  };
  const session = new Session(new FakeAuthRepository(ADMIN), new MemoryTokenStore());
  session.user = ADMIN;
  const toasts = new ToastStore();
  const vm = new UsersPageVM(
    services.users,
    services.tariffs,
    services.groups,
    services.quota,
    session,
    toasts,
  );
  return { vm, usersRepo, tariffsRepo, groupsRepo, quotaRepo, toasts, session, services };
}

function toastMessages(toasts: ToastStore): string[] {
  return toasts.items.map((item) => item.message);
}

function stubConfirm(result: boolean): ReturnType<typeof vi.fn> {
  const confirm = vi.fn(() => result);
  vi.stubGlobal("confirm", confirm);
  return confirm;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersPageVM", () => {
  it("loads users, tariffs and groups", async () => {
    const { vm } = setup();
    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.users.map((user) => user.login)).toEqual(["admin", "alice"]);
    expect(vm.tariffs).toEqual([TARIFF]);
    expect(vm.groups).toEqual([GROUP]);
    expect(vm.tariffName("t1")).toBe("Basic");
    expect(vm.groupName("g1")).toBe("Main");
    expect(vm.tariffName(null)).toBe("Не задан");
    expect(vm.groupName(null)).toBe("Не задана");
    expect(vm.selfId).toBe(ADMIN.id);
  });

  it("reports a load error", async () => {
    const { vm, usersRepo } = setup();
    usersRepo.failure = new Error("Сеть недоступна");

    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.error).toBe("Сеть недоступна");
    expect(vm.users).toEqual([]);
  });

  it("loads user quotas once and exposes column labels", async () => {
    const { vm, quotaRepo } = setup();
    const usersSpy = vi.spyOn(quotaRepo, "users");

    await vm.load();

    expect(usersSpy).toHaveBeenCalledTimes(1);
    expect(vm.quotas).toHaveLength(2);
    expect(vm.quotaFor(ADMIN.id)).toMatchObject({ userId: ADMIN.id, percent: 10 });
    expect(vm.quotaPercentLabel(ADMIN.id)).toBe("10.0 %");
    expect(vm.quotaStatusLabel(ADMIN.id)).toBe("в норме");
    expect(vm.quotaBadgeClass(ADMIN.id)).toBe("badge badge--green");
    expect(vm.quotaTitle(ADMIN.id)).toBe("Использовано 1.0 ГБ из 10.0 ГБ");
    expect(vm.quotaPercentLabel(ALICE.id)).toBe("100.0 %");
    expect(vm.quotaStatusLabel(ALICE.id)).toBe("исчерпана");
    expect(vm.quotaBadgeClass(ALICE.id)).toBe("badge badge--red");
    expect(vm.quotaFor("missing")).toBeNull();
    expect(vm.quotaPercentLabel("missing")).toBe("—");
  });

  it("marks an unlimited quota in the users table", async () => {
    const { vm } = setup([ADMIN], [
      {
        user_id: ADMIN.id,
        login: ADMIN.login,
        used_bytes: 1024,
        quota_bytes: null,
        exceeded: false,
        percent: null,
      },
    ]);

    await vm.load();

    expect(vm.quotaPercentLabel(ADMIN.id)).toBe("—");
    expect(vm.quotaStatusLabel(ADMIN.id)).toBe("без лимита");
    expect(vm.quotaBadgeClass(ADMIN.id)).toBe("badge badge--blue");
    expect(vm.quotaTitle(ADMIN.id)).toBe("Использовано 1.0 КБ из Без ограничения");
  });

  it("keeps the users table when quotas fail to load", async () => {
    const { vm, quotaRepo } = setup();
    quotaRepo.failure = new Error("Квоты недоступны");

    await vm.load();

    expect(vm.error).toBeNull();
    expect(vm.users.map((user) => user.login)).toEqual(["admin", "alice"]);
    expect(vm.quotas).toEqual([]);
    expect(vm.quotaFor(ALICE.id)).toBeNull();
    expect(vm.quotaPercentLabel(ALICE.id)).toBe("—");
    expect(vm.quotaStatusLabel(ALICE.id)).toBe("");
  });

  it("creates a user", async () => {
    const { vm, usersRepo, toasts, services } = setup();
    const createSpy = vi.spyOn(services.users, "createUser");
    vm.openCreate();
    vm.login = "  bob  ";
    vm.password = "secret123";
    vm.role = "admin";
    vm.tariffId = "t1";
    vm.groupId = "g1";

    await vm.submit();

    expect(createSpy).toHaveBeenCalledWith({
      login: "bob",
      password: "secret123",
      role: "admin",
      tariff_id: "t1",
      group_id: "g1",
    });
    expect(usersRepo.users.map((user) => user.login)).toEqual(["admin", "alice", "bob"]);
    expect(usersRepo.passwords.get("u3")).toBe("secret123");
    expect(vm.modalOpen).toBe(false);
    expect(vm.formError).toBeNull();
    expect(toastMessages(toasts)).toContain("Пользователь создан");
  });

  it("rejects a short password before creating", async () => {
    const { vm, usersRepo, toasts } = setup();
    vm.openCreate();
    vm.login = "bob";
    vm.password = "123";
    await vm.load();

    await vm.submit();

    expect(vm.formError).toBe("Пароль должен содержать не менее 8 символов");
    expect(usersRepo.users).toHaveLength(2);
    expect(vm.modalOpen).toBe(true);
    expect(toastMessages(toasts)).toEqual([]);
  });

  it("updates a user", async () => {
    const { vm, usersRepo, toasts } = setup();
    vm.openEdit(ALICE);

    expect(vm.title).toBe("Редактировать пользователя");
    expect(vm.tariffId).toBe("t1");
    expect(vm.groupId).toBe("g1");

    vm.role = "admin";
    vm.disabled = true;
    vm.tariffId = "";
    await vm.submit();

    const updated = usersRepo.users.find((user) => user.id === ALICE.id);
    expect(updated).toEqual({
      ...ALICE,
      role: "admin",
      disabled: true,
      tariff_id: null,
      group_id: "g1",
    });
    expect(vm.modalOpen).toBe(false);
    expect(toastMessages(toasts)).toContain("Пользователь обновлён");
  });

  it("keeps a form error when saving fails", async () => {
    const { vm, usersRepo, toasts } = setup();
    usersRepo.failure = new Error("Сервер недоступен");
    vm.openCreate();
    vm.login = "bob";
    vm.password = "secret123";

    await vm.submit();

    expect(vm.formError).toBe("Сервер недоступен");
    expect(vm.saving).toBe(false);
    expect(vm.modalOpen).toBe(true);
    expect(toastMessages(toasts)).toContain("Сервер недоступен");
  });

  it("resets a password", async () => {
    const { vm, usersRepo, toasts } = setup();
    vm.openReset(ALICE);
    vm.resetPassword = "newsecret1";

    await vm.submitReset();

    expect(usersRepo.passwords.get(ALICE.id)).toBe("newsecret1");
    expect(vm.resetOpen).toBe(false);
    expect(vm.resetTarget).toBeNull();
    expect(toastMessages(toasts)).toContain("Пароль обновлён");
  });

  it("rejects a short reset password", async () => {
    const { vm, usersRepo, toasts } = setup();
    vm.openReset(ALICE);
    vm.resetPassword = "short";

    await vm.submitReset();

    expect(usersRepo.passwords.has(ALICE.id)).toBe(false);
    expect(vm.resetOpen).toBe(true);
    expect(toastMessages(toasts)).toContain("Пароль должен содержать не менее 8 символов");
  });

  it("deletes another user after confirmation", async () => {
    const confirm = stubConfirm(true);
    const { vm, usersRepo, toasts } = setup();

    await vm.remove(ALICE);

    expect(confirm).toHaveBeenCalledWith("Удалить пользователя alice?");
    expect(usersRepo.users.map((user) => user.id)).toEqual([ADMIN.id]);
    expect(toastMessages(toasts)).toContain("Пользователь удалён");
  });

  it("does not delete the current account", async () => {
    const confirm = stubConfirm(true);
    const { vm, usersRepo, toasts } = setup();

    await vm.remove(ADMIN);

    expect(confirm).not.toHaveBeenCalled();
    expect(usersRepo.users).toHaveLength(2);
    expect(toastMessages(toasts)).toContain("Нельзя удалить собственную учётную запись");
  });

  it("cancels deletion when confirmation is declined", async () => {
    stubConfirm(false);
    const { vm, usersRepo } = setup();

    await vm.remove(ALICE);

    expect(usersRepo.users).toHaveLength(2);
  });

  it("toggles the disabled flag", async () => {
    const { vm, usersRepo } = setup();

    await vm.toggleDisabled(ALICE);

    expect(usersRepo.users.find((user) => user.id === ALICE.id)?.disabled).toBe(true);
  });
});
