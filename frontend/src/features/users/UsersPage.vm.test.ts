import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type {
  AuthSessionInfo,
  LoginInput,
  LogoutAllResult,
  RegisterInput,
  RegisterResult,
  TotpSetup,
  TotpToggleResult,
  VerifyEmailResult,
} from "@/domain/auth/types";
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
import type { ApproveUserInput, CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { UsersRepository } from "@/domain/users/repository";
import type { TokenStore } from "@/infrastructure/storage";
import { UsersPageVM, usersFiltersStorage } from "./UsersPage.vm";

const ADMIN: User = {
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

const ALICE: User = {
  id: "u2",
  login: "alice",
  role: "user",
  tariff_id: "t1",
  group_id: "g1",
  email: "alice@example.com",
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const PENDING: User = {
  ...ALICE,
  id: "u3",
  login: "newbie",
  email: "newbie@example.com",
  status: "pending_approval",
  tariff_id: null,
  group_id: null,
  created_at: "2020-02-01T00:00:00Z",
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

  async listPending(): Promise<User[]> {
    this.failIfNeeded();
    return this.users.filter(
      (user) => user.status === "pending_email" || user.status === "pending_approval",
    );
  }

  async approveUser(id: string, input: ApproveUserInput): Promise<User> {
    this.failIfNeeded();
    const user = this.find(id);
    const next: User = {
      ...user,
      status: "active",
      tariff_id: input.tariff_id,
      group_id: input.group_id ?? null,
    };
    this.replace(next);
    return next;
  }

  async rejectUser(id: string): Promise<User> {
    this.failIfNeeded();
    const user = this.find(id);
    const next: User = { ...user, status: "rejected" };
    this.replace(next);
    return next;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    this.failIfNeeded();
    const user: User = {
      id: `u${this.users.length + 1}`,
      login: input.login,
      role: input.role,
      tariff_id: input.tariff_id,
      group_id: input.group_id,
      email: null,
      status: "active",
      totp_enabled: false,
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

  async register(_input: RegisterInput): Promise<RegisterResult> {
    return { status: "pending_email" };
  }

  async verifyEmail(_token: string): Promise<VerifyEmailResult> {
    return { status: "pending_approval" };
  }

  async resendVerification(_email: string): Promise<void> {}

  async forgotPassword(_email: string): Promise<{ status: "sent" }> {
    return { status: "sent" };
  }

  async resetPassword(_token: string, _password: string): Promise<{ status: "reset" }> {
    return { status: "reset" };
  }

  async refresh(_refreshToken: string): Promise<AuthSession> {
    return this.login({ login: this.current.login, password: "secret" });
  }

  async logout(_refreshToken: string): Promise<void> {}

  async me(): Promise<User> {
    return this.current;
  }

  async changePassword(_current: string | null, _next: string): Promise<void> {}

  async totpSetup(): Promise<TotpSetup> {
    return { secret: "secret", otpauth_url: "otpauth://totp/test", recovery_codes: ["code"] };
  }

  async totpEnable(_code: string): Promise<TotpToggleResult> {
    return { enabled: true };
  }

  async totpDisable(_password: string, _code: string): Promise<TotpToggleResult> {
    return { enabled: false };
  }

  async sessions(): Promise<AuthSessionInfo[]> {
    return [];
  }

  async revokeSession(_jti: string): Promise<void> {}

  async logoutAll(): Promise<LogoutAllResult> {
    return { ok: true, revoked: 0 };
  }
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

  clear(): void {
    this.store.clear();
  }
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

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
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

  it("separates pending registrations from the main user list", async () => {
    const { vm } = setup([ADMIN, ALICE, PENDING]);

    await vm.load();

    expect(vm.activeUsers.map((user) => user.login)).toEqual(["admin", "alice"]);
    expect(vm.pending.map((user) => user.login)).toEqual(["newbie"]);
    expect(vm.pendingCount).toBe(1);
    expect(vm.emailLabel(PENDING)).toBe("newbie@example.com");
    expect(vm.requestDateLabel(PENDING)).not.toBe("—");
  });

  it("shows status labels and badges for accounts", () => {
    const { vm } = setup();

    expect(vm.statusLabel(ADMIN)).toBe("Активен");
    expect(vm.statusBadgeClass(ADMIN)).toBe("badge badge--green");
    expect(vm.statusLabel({ ...ADMIN, disabled: true })).toBe("Отключён");
    expect(vm.statusBadgeClass({ ...ADMIN, disabled: true })).toBe("badge badge--red");
    expect(vm.statusLabel(PENDING)).toBe("Ожидает подтверждения");
    expect(vm.statusBadgeClass(PENDING)).toBe("badge badge--blue");
    expect(vm.statusLabel({ ...PENDING, status: "rejected" })).toBe("Отклонён");
  });

  it("switches tabs and refreshes lists", async () => {
    const { vm } = setup();

    vm.setTab("pending");
    expect(vm.tab).toBe("pending");
    expect(JSON.parse(localStorage.getItem(usersFiltersStorage.key) ?? "{}")).toMatchObject({
      tab: "pending",
    });
    vm.setTab("active");
    expect(vm.tab).toBe("active");
  });

  it("сохраняет таб и поиск между переходами", () => {
    localStorage.setItem(
      usersFiltersStorage.key,
      JSON.stringify({ tab: "pending", query: "new" }),
    );

    const { vm } = setup();

    expect(vm.tab).toBe("pending");
    expect(vm.query).toBe("new");
    expect(vm.appliedQuery).toBe("new");
  });

  it("игнорирует некорректное сохранённое состояние", () => {
    localStorage.setItem(
      usersFiltersStorage.key,
      JSON.stringify({ tab: "unknown", query: 42 }),
    );

    const { vm } = setup();

    expect(vm.tab).toBe("active");
    expect(vm.query).toBe("");
    expect(localStorage.getItem(usersFiltersStorage.key)).toBeNull();
  });

  it("фильтрует активных пользователей и заявки после debounce", async () => {
    vi.useFakeTimers();
    try {
      const { vm } = setup([ADMIN, ALICE, PENDING]);
      await vm.load();

      vm.setQuery({ target: { value: "alice" } } as unknown as Event);

      expect(vm.query).toBe("alice");
      expect(vm.filteredActiveUsers).toHaveLength(2);

      vi.advanceTimersByTime(250);

      expect(vm.filteredActiveUsers.map((user) => user.id)).toEqual([ALICE.id]);
      expect(vm.filteredPending).toEqual([]);
      expect(vm.activeCountLabel).toBe("Найдено 1 из 2");
      expect(vm.hasActiveFilters).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("фильтрует заявки по email", async () => {
    const { vm } = setup([ADMIN, ALICE, PENDING]);
    await vm.load();

    vm.query = "newbie@example.com";
    vm.appliedQuery = "newbie@example.com";

    expect(vm.filteredPending.map((user) => user.id)).toEqual([PENDING.id]);
    expect(vm.filteredActiveUsers).toEqual([]);
    expect(vm.pendingCountLabel).toBe("Найдено 1 из 1");
  });

  it("сбрасывает поиск и очищает storage", async () => {
    const { vm } = setup();
    await vm.load();

    vm.setQuery({ target: { value: "admin" } } as unknown as Event);
    expect(localStorage.getItem(usersFiltersStorage.key)).not.toBeNull();

    vm.resetFilters();

    expect(vm.query).toBe("");
    expect(vm.appliedQuery).toBe("");
    expect(vm.hasActiveFilters).toBe(false);
    expect(vm.filteredActiveUsers).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(usersFiltersStorage.key) ?? "{}")).toEqual({
      tab: "active",
      query: "",
    });
  });

  it("не сохраняет пароли и данные форм", () => {
    const { vm } = setup();

    vm.setTab("active");
    vm.openCreate();
    vm.setPassword({ target: { value: "secret123" } } as unknown as Event);
    vm.setLogin({ target: { value: "bob" } } as unknown as Event);

    const raw = localStorage.getItem(usersFiltersStorage.key);
    expect(raw).not.toBeNull();
    expect(Object.keys(JSON.parse(raw ?? "{}")).sort()).toEqual(["query", "tab"]);
    expect(raw).not.toContain("secret123");
    expect(raw).not.toContain("bob");
  });

  it("requires a tariff before approving a pending account", async () => {
    const { vm, toasts } = setup([ADMIN, PENDING]);
    await vm.load();

    vm.openApprove(PENDING);
    expect(vm.approveOpen).toBe(true);
    expect(vm.approveTarget?.id).toBe(PENDING.id);

    await vm.submitApprove();

    expect(vm.approveError).toBe("Выберите тариф");
    expect(toastMessages(toasts)).not.toContain("Заявка подтверждена");
  });

  it("approves a pending account with a tariff and group", async () => {
    const { vm, usersRepo, toasts } = setup([ADMIN, PENDING]);
    await vm.load();

    vm.openApprove(PENDING);
    vm.setApproveTariff(TARIFF.id);
    vm.setApproveGroup(GROUP.id);
    await vm.submitApprove();

    const approved = usersRepo.users.find((user) => user.id === PENDING.id);
    expect(approved?.status).toBe("active");
    expect(approved?.tariff_id).toBe(TARIFF.id);
    expect(approved?.group_id).toBe(GROUP.id);
    expect(vm.approveOpen).toBe(false);
    expect(vm.approveTarget).toBeNull();
    expect(vm.pending).toHaveLength(0);
    expect(toastMessages(toasts)).toContain("Заявка подтверждена");
  });

  it("reports an approval failure", async () => {
    const { vm, usersRepo, toasts } = setup([ADMIN, PENDING]);
    await vm.load();
    usersRepo.failure = new Error("Сервер недоступен");

    vm.openApprove(PENDING);
    vm.setApproveTariff(TARIFF.id);
    await vm.submitApprove();

    expect(vm.approveError).toBe("Сервер недоступен");
    expect(toastMessages(toasts)).toContain("Сервер недоступен");
    expect(vm.approveOpen).toBe(true);
  });

  it("rejects a pending account after confirmation", async () => {
    const confirm = stubConfirm(true);
    const { vm, usersRepo, toasts } = setup([ADMIN, PENDING]);
    await vm.load();

    await vm.reject(PENDING);

    expect(confirm).toHaveBeenCalledWith("Отклонить заявку newbie@example.com?");
    expect(usersRepo.users.find((user) => user.id === PENDING.id)?.status).toBe("rejected");
    expect(vm.pending).toHaveLength(0);
    expect(toastMessages(toasts)).toContain("Заявка отклонена");
  });

  it("keeps the request when rejection is declined", async () => {
    stubConfirm(false);
    const { vm, usersRepo } = setup([ADMIN, PENDING]);
    await vm.load();

    await vm.reject(PENDING);

    expect(usersRepo.users.find((user) => user.id === PENDING.id)?.status).toBe("pending_approval");
  });

  it("reports pending list load errors without failing the page", async () => {
    const { vm, usersRepo, toasts } = setup();
    usersRepo.failure = new Error("Заявки недоступны");

    await vm.load();

    expect(vm.error).toBe("Заявки недоступны");
    expect(vm.pendingError).toBe("Заявки недоступны");
    expect(toastMessages(toasts)).toEqual([]);
  });
});
