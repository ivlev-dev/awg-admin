import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultNodesService } from "@/application/nodes/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { BulkFailure, BulkResult } from "@/domain/bulk";
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
import type { NodeCreated, NodeRotated } from "@/domain/nodes/types";
import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState, UserQuota } from "@/domain/quota/types";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type {
  AuthSession,
  NodeInfo,
  Tariff,
  User,
} from "@/domain/types";
import type { ApproveUserInput, CreateUserInput, UpdateUserInput, UserPageParams } from "@/domain/users/types";
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import { pageUsersFromList } from "@/domain/users/query";
import type { Page } from "@/domain/page";
import type { TokenStore } from "@/infrastructure/storage";
import { UsersPageVM, usersAdvancedFiltersStorage, usersFiltersStorage } from "@/features/users/UsersPage.vm";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_options: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);

const ADMIN: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
  node_id: null,
  email: "admin@example.com",
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
  node_id: "n1",
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
  node_id: null,
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
  interface_id: null,
  interface_name: null,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const NODE: NodeInfo = {
  id: "n1",
  name: "Node 1",
  status: "online",
  online: true,
  last_seen: null,
  version: null,
  interfaces: 0,
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

class MemoryUsersRepository {
  users: User[] = [];
  readonly passwords = new Map<string, string>();
  failure: Error | null = null;
  bulkResult: BulkResult | null = null;

  async listUsers(): Promise<User[]> {
    this.failIfNeeded();
    return [...this.users];
  }

  async pageUsers(params: UserPageParams): Promise<Page<User>> {
    this.failIfNeeded();
    return pageUsersFromList(this.users, params);
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
      node_id: input.node_id ?? null,
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
      login: input.email,
      email: input.email,
      role: input.role,
      tariff_id: input.tariff_id,
      node_id: input.node_id,
      group_id: input.group_id ?? null,
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

  async bulk(action: UsersBulkAction, ids: readonly string[]): Promise<BulkResult> {
    if (this.bulkResult !== null) return this.bulkResult;
    const failed: BulkFailure[] = [];
    let done = 0;
    for (const id of ids) {
      const user = this.users.find((item) => item.id === id);
      if (user === undefined) {
        failed.push({ id, error: `Пользователь ${id} не найден` });
        continue;
      }
      if (action === "delete") {
        this.users = this.users.filter((item) => item.id !== id);
      } else {
        this.replace({ ...user, disabled: action === "disable" });
      }
      done += 1;
    }
    return { done, failed };
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

class MemoryTariffsRepository {
  tariffs: Tariff[] = [];
  failure: Error | null = null;

  async listTariffs(): Promise<Tariff[]> {
    if (this.failure !== null) throw this.failure;
    return [...this.tariffs];
  }

  async createTariff(input: TariffInput): Promise<Tariff> {
    if (this.failure !== null) throw this.failure;
    const tariff: Tariff = {
      id: `t${this.tariffs.length + 1}`,
      ...input,
      interface_name: null,
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

  async bulk(_action: "delete", ids: readonly string[]) {
    this.tariffs = this.tariffs.filter((item) => !ids.includes(item.id));
    return { done: ids.length, failed: [] };
  }
}

class MemoryNodesRepository {
  nodes: NodeInfo[] = [];
  failure: Error | null = null;

  async listNodes(): Promise<NodeInfo[]> {
    if (this.failure !== null) throw this.failure;
    return [...this.nodes];
  }

  async createNode(name: string): Promise<NodeCreated> {
    const node: NodeInfo = {
      id: `n${this.nodes.length + 1}`,
      name,
      status: "offline",
      online: false,
      last_seen: null,
      version: null,
      interfaces: 0,
    };
    this.nodes.push(node);
    return { node: { id: node.id, name: node.name, created_at: "2020-01-02T00:00:00Z" }, token: "token" };
  }

  async rotateNode(id: string): Promise<NodeRotated> {
    const node = this.nodes.find((item) => item.id === id);
    if (node === undefined) throw new Error(`Нода ${id} не найдена`);
    return { node, token: "rotated" };
  }

  async deleteNode(id: string): Promise<void> {
    this.nodes = this.nodes.filter((node) => node.id !== id);
  }

  async bulk(_action: "delete", ids: readonly string[]) {
    this.nodes = this.nodes.filter((node) => !ids.includes(node.id));
    return { done: ids.length, failed: [] };
  }
}

class MemoryQuotaRepository {
  quotas: UserQuota[] = [];
  failure: Error | null = null;

  async me(): Promise<QuotaState> {
    throw new Error("me is not used in this test");
  }

  async users(): Promise<UserQuota[]> {
    if (this.failure !== null) throw this.failure;
    return this.quotas.map((quota) => ({ ...quota }));
  }
}

class FakeAuthRepository {
  current: User = ADMIN;

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

interface SetupResult {
  vm: UsersPageVM;
  usersRepo: MemoryUsersRepository;
  tariffsRepo: MemoryTariffsRepository;
  nodesRepo: MemoryNodesRepository;
  quotaRepo: MemoryQuotaRepository;
  toasts: ToastStore;
  session: Session;
  services: {
    users: DefaultUsersService;
    tariffs: DefaultTariffsService;
    nodes: DefaultNodesService;
    quota: DefaultQuotaService;
  };
}

function setup(
  seed: User[] = [ADMIN, ALICE],
  quotaSeed: UserQuota[] = QUOTAS,
): SetupResult {
  const usersRepo = new MemoryUsersRepository();
  usersRepo.users = [...seed];
  const tariffsRepo = new MemoryTariffsRepository();
  tariffsRepo.tariffs = [TARIFF];
  const nodesRepo = new MemoryNodesRepository();
  nodesRepo.nodes = [NODE];
  const quotaRepo = new MemoryQuotaRepository();
  quotaRepo.quotas = quotaSeed.map((quota) => ({ ...quota }));
  const services = {
    users: new DefaultUsersService(usersRepo),
    tariffs: new DefaultTariffsService(tariffsRepo),
    nodes: new DefaultNodesService(nodesRepo),
    quota: new DefaultQuotaService(quotaRepo),
  };
  const session = new Session(new FakeAuthRepository(), new MemoryTokenStore());
  session.user = ADMIN;
  const toasts = new ToastStore();
  const vm = new UsersPageVM(
    services.users,
    services.tariffs,
    services.nodes,
    services.quota,
    session,
    toasts,
  );
  return { vm, usersRepo, tariffsRepo, nodesRepo, quotaRepo, toasts, session, services };
}

function toastMessages(toasts: ToastStore): string[] {
  return toasts.items.map((item) => item.message);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  confirmMock.askConfirm.mockClear();
  confirmMock.askConfirm.mockResolvedValue(true);
});

describe("UsersPageVM", () => {
  it("loads users, tariffs and nodes", async () => {
    const { vm } = setup();
    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.users.map((user) => user.login)).toEqual(["admin", "alice"]);
    expect(vm.tariffs).toEqual([TARIFF]);
    expect(vm.nodes).toEqual([NODE]);
    expect(vm.tariffName("t1")).toBe("Basic");
    expect(vm.nodeName("n1")).toBe("Node 1");
    expect(vm.tariffName(null)).toBe("Не задан");
    expect(vm.nodeName(null)).toBe("—");
    expect(vm.nodeName(undefined)).toBe("—");
    expect(vm.selfId).toBe(ADMIN.id);
  });

  it("запрещает менять собственную роль", () => {
    const { vm } = setup();
    vm.openEdit(ADMIN);

    expect(vm.roleLocked).toBe(true);
    vm.setRole("user");

    expect(vm.role).toBe("admin");
  });

  it("перезагружает сессию после сохранения собственного профиля", async () => {
    const { vm, session } = setup();
    const reload = vi.spyOn(session, "reload").mockResolvedValue(undefined);
    vm.openEdit(ADMIN);
    vm.email = "admin@example.com";

    await vm.submit();

    expect(reload).toHaveBeenCalledTimes(1);
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
    vm.email = "  bob@example.com  ";
    vm.password = "secret123";
    vm.role = "admin";
    vm.tariffId = "t1";
    vm.setNode("n1");

    await vm.submit();

    expect(createSpy).toHaveBeenCalledWith({
      email: "bob@example.com",
      password: "secret123",
      role: "admin",
      tariff_id: "t1",
      node_id: "n1",
    });
    expect(usersRepo.users.map((user) => user.email)).toEqual([
      "admin@example.com",
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(usersRepo.users.find((user) => user.email === "bob@example.com")?.node_id).toBe("n1");
    expect(usersRepo.passwords.get("u3")).toBe("secret123");
    expect(vm.modalOpen).toBe(false);
    expect(vm.formError).toBeNull();
    expect(toastMessages(toasts)).toContain("Пользователь создан");
  });

  it("creates a user without a node", async () => {
    const { vm, usersRepo, services } = setup();
    const createSpy = vi.spyOn(services.users, "createUser");
    vm.openCreate();
    vm.email = "bob@example.com";
    vm.password = "secret123";

    await vm.submit();

    expect(createSpy).toHaveBeenCalledWith({
      email: "bob@example.com",
      password: "secret123",
      role: "user",
      tariff_id: null,
      node_id: null,
    });
    expect(usersRepo.users.find((user) => user.email === "bob@example.com")?.node_id).toBeNull();
  });

  it("rejects a short password before creating", async () => {
    const { vm, usersRepo, toasts } = setup();
    vm.openCreate();
    vm.email = "bob@example.com";
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
    expect(vm.nodeId).toBe("n1");
    expect(vm.email).toBe("alice@example.com");

    vm.email = "alice.updated@example.com";
    vm.role = "admin";
    vm.disabled = true;
    vm.tariffId = "";
    vm.setNode("");
    await vm.submit();

    const updated = usersRepo.users.find((user) => user.id === ALICE.id);
    expect(updated).toEqual({
      ...ALICE,
      email: "alice.updated@example.com",
      role: "admin",
      disabled: true,
      tariff_id: null,
      node_id: null,
    });
    expect(vm.modalOpen).toBe(false);
    expect(toastMessages(toasts)).toContain("Пользователь обновлён");
  });

  it("keeps a form error when saving fails", async () => {
    const { vm, usersRepo, toasts } = setup();
    usersRepo.failure = new Error("Сервер недоступен");
    vm.openCreate();
    vm.email = "bob@example.com";
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
    const { vm, usersRepo, toasts } = setup();

    await vm.remove(ALICE);

    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Удалить пользователя alice@example.com?" }),
    );
    expect(usersRepo.users.map((user) => user.id)).toEqual([ADMIN.id]);
    expect(toastMessages(toasts)).toContain("Пользователь удалён");
  });

  it("does not delete the current account", async () => {
    const { vm, usersRepo, toasts } = setup();

    await vm.remove(ADMIN);

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(usersRepo.users).toHaveLength(2);
    expect(toastMessages(toasts)).toContain("Нельзя удалить собственную учётную запись");
  });

  it("cancels deletion when confirmation is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
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

  it("передаёт поиск на сервер после debounce", async () => {
    vi.useFakeTimers();
    try {
      const { vm, usersRepo } = setup([ADMIN, ALICE, PENDING]);
      await vm.load();
      const page = vi.spyOn(usersRepo, "pageUsers");
      page.mockClear();

      vm.setQuery({ target: { value: "alice" } } as unknown as Event);

      expect(vm.query).toBe("alice");
      expect(page).not.toHaveBeenCalled();

      vi.advanceTimersByTime(249);
      expect(page).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(vm.appliedQuery).toBe("alice");
      expect(page).toHaveBeenCalledWith(
        expect.objectContaining({ tab: "active", query: "alice", offset: 0, limit: 25 }),
      );

      vi.useRealTimers();
      await vi.waitFor(() => {
        expect(vm.users.map((user) => user.id)).toEqual([ALICE.id]);
        expect(vm.pending).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("передаёт вкладку, роль и статус на сервер", async () => {
    const { vm, usersRepo } = setup([ADMIN, ALICE, PENDING]);
    await vm.load();
    const page = vi.spyOn(usersRepo, "pageUsers");
    page.mockClear();

    vm.setRoleFilter("admin");
    await vi.waitFor(() => {
      expect(page).toHaveBeenCalledWith(
        expect.objectContaining({ tab: "active", role: "admin", offset: 0 }),
      );
    });

    page.mockClear();
    vm.setStatusFilter("disabled");
    await vi.waitFor(() => {
      expect(page).toHaveBeenCalledWith(
        expect.objectContaining({ tab: "active", status: "disabled", offset: 0 }),
      );
    });

    page.mockClear();
    vm.setTab("pending");
    await vi.waitFor(() => {
      expect(page).toHaveBeenCalledWith(
        expect.objectContaining({ tab: "pending", offset: 0 }),
      );
    });
  });

  it("не отправляет форму с некорректным email", async () => {
    const { vm, usersRepo, services } = setup();
    const createSpy = vi.spyOn(services.users, "createUser");
    vm.openCreate();
    vm.email = "not-an-email";
    vm.password = "secret123";

    await vm.submit();

    expect(createSpy).not.toHaveBeenCalled();
    expect(usersRepo.users).toHaveLength(2);
    expect(vm.formError).toBe("Введите корректный email");
    expect(vm.modalOpen).toBe(true);
  });

  it("показывает email в модалке сброса пароля", () => {
    const { vm } = setup();

    vm.openReset(ALICE);

    expect(vm.resetTargetEmail()).toBe("alice@example.com");
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
    expect(JSON.parse(localStorage.getItem(usersFiltersStorage.key) ?? "{}")).toEqual({
      tab: "active",
      query: "",
    });
    await vi.waitFor(() => {
      expect(vm.users).toHaveLength(2);
    });
  });

  it("не сохраняет пароли и данные форм", () => {
    const { vm } = setup();

    vm.setTab("active");
    vm.openCreate();
    vm.setPassword({ target: { value: "secret123" } } as unknown as Event);
    vm.setEmail({ target: { value: "bob@example.com" } } as unknown as Event);

    const raw = localStorage.getItem(usersFiltersStorage.key);
    expect(raw).not.toBeNull();
    expect(Object.keys(JSON.parse(raw ?? "{}")).sort()).toEqual(["query", "tab"]);
    expect(raw).not.toContain("secret123");
    expect(raw).not.toContain("bob@example.com");
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

  it("approves a pending account with a tariff and node", async () => {
    const { vm, usersRepo, toasts } = setup([ADMIN, PENDING]);
    await vm.load();

    vm.openApprove(PENDING);
    vm.setApproveTariff(TARIFF.id);
    vm.setApproveNode(NODE.id);
    await vm.submitApprove();

    const approved = usersRepo.users.find((user) => user.id === PENDING.id);
    expect(approved?.status).toBe("active");
    expect(approved?.tariff_id).toBe(TARIFF.id);
    expect(approved?.node_id).toBe(NODE.id);
    expect(vm.approveOpen).toBe(false);
    expect(vm.approveTarget).toBeNull();
    expect(vm.pending).toHaveLength(0);
    expect(toastMessages(toasts)).toContain("Заявка подтверждена");
  });

  it("approves a pending account without a node", async () => {
    const { vm, usersRepo } = setup([ADMIN, PENDING]);
    await vm.load();

    vm.openApprove(PENDING);
    vm.setApproveTariff(TARIFF.id);
    vm.setApproveNode("");
    await vm.submitApprove();

    const approved = usersRepo.users.find((user) => user.id === PENDING.id);
    expect(approved?.node_id).toBeNull();
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
    const { vm, usersRepo, toasts } = setup([ADMIN, PENDING]);
    await vm.load();

    await vm.reject(PENDING);

    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Отклонить заявку newbie@example.com?" }),
    );
    expect(usersRepo.users.find((user) => user.id === PENDING.id)?.status).toBe("rejected");
    expect(vm.pending).toHaveLength(0);
    expect(toastMessages(toasts)).toContain("Заявка отклонена");
  });

  it("keeps the request when rejection is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
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

  describe("массовые действия", () => {
    const CAROL: User = {
      ...ALICE,
      id: "u4",
      login: "carol",
      email: "carol@example.com",
      disabled: true,
    };

    it("отключает выбранных одним bulk-запросом, исключая себя и уже отключённых", async () => {
      const { vm, usersRepo, toasts } = setup([ADMIN, ALICE, CAROL]);
      const pageUsers = vi.spyOn(usersRepo, "pageUsers");
      await vm.load();
      const bulk = vi.spyOn(usersRepo, "bulk");
      vm.selectedIds = [ADMIN.id, ALICE.id, CAROL.id];

      await vm.bulkSetDisabled(true);

      expect(bulk).toHaveBeenCalledTimes(1);
      expect(bulk).toHaveBeenCalledWith("disable", [ALICE.id]);
      expect(usersRepo.users.find((user) => user.id === ALICE.id)?.disabled).toBe(true);
      expect(usersRepo.users.find((user) => user.id === CAROL.id)?.disabled).toBe(true);
      expect(pageUsers).toHaveBeenCalledTimes(6);
      expect(vm.selectedIds).toEqual([]);
      expect(vm.bulkBusy).toBe(false);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "success",
        message: "Готово: 1, ошибок: 0",
      });
    });

    it("включает только отключённых пользователей", async () => {
      const { vm, usersRepo, toasts } = setup([ADMIN, ALICE, CAROL]);
      await vm.load();
      const bulk = vi.spyOn(usersRepo, "bulk");
      vm.selectedIds = [ADMIN.id, ALICE.id, CAROL.id];

      await vm.bulkSetDisabled(false);

      expect(bulk).toHaveBeenCalledTimes(1);
      expect(bulk).toHaveBeenCalledWith("enable", [CAROL.id]);
      expect(usersRepo.users.find((user) => user.id === CAROL.id)?.disabled).toBe(false);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "success",
        message: "Готово: 1, ошибок: 0",
      });
    });

    it("удаляет выбранных одним bulk-запросом после подтверждения", async () => {
      const { vm, usersRepo, toasts } = setup([ADMIN, ALICE]);
      await vm.load();
      const bulk = vi.spyOn(usersRepo, "bulk");
      vm.selectedIds = [ADMIN.id, ALICE.id];

      await vm.bulkDelete();

      expect(confirmMock.askConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Удалить выбранные записи (1)?" }),
      );
      expect(bulk).toHaveBeenCalledTimes(1);
      expect(bulk).toHaveBeenCalledWith("delete", [ALICE.id]);
      expect(usersRepo.users.map((user) => user.id)).toEqual([ADMIN.id]);
      expect(vm.selectedIds).toEqual([]);
      expect(vm.bulkBusy).toBe(false);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "success",
        message: "Готово: 1, ошибок: 0",
      });
    });

    it("показывает ошибку при частичном сбое, но учитывает выполненные", async () => {
      const { vm, usersRepo, toasts } = setup([ADMIN, ALICE, CAROL]);
      await vm.load();
      usersRepo.bulkResult = {
        done: 1,
        failed: [{ id: CAROL.id, error: "Недостаточно прав" }],
      };
      vm.selectedIds = [ALICE.id, CAROL.id];

      await vm.bulkSetDisabled(true);

      expect(vm.selectedIds).toEqual([]);
      expect(vm.bulkBusy).toBe(false);
      expect(toasts.items.at(-1)).toMatchObject({
        kind: "error",
        message: "Готово: 1, ошибок: 1",
      });
    });

    it("не вызывает bulk без подходящих целей", async () => {
      const { vm, usersRepo } = setup([ADMIN, ALICE, CAROL]);
      await vm.load();
      const bulk = vi.spyOn(usersRepo, "bulk");
      vm.selectedIds = [ADMIN.id, CAROL.id];

      await vm.bulkSetDisabled(true);

      expect(bulk).not.toHaveBeenCalled();
      expect(vm.selectedIds).toEqual([ADMIN.id, CAROL.id]);
    });

    it("не удаляет пользователей при отказе от подтверждения", async () => {
      confirmMock.askConfirm.mockResolvedValueOnce(false);
      const { vm, usersRepo } = setup([ADMIN, ALICE]);
      await vm.load();
      const bulk = vi.spyOn(usersRepo, "bulk");
      vm.selectedIds = [ALICE.id];

      await vm.bulkDelete();

      expect(bulk).not.toHaveBeenCalled();
      expect(usersRepo.users).toHaveLength(2);
      expect(vm.selectedIds).toEqual([ALICE.id]);
    });
  });
});

describe("UsersPageVM UX-состояния", () => {
  it("ограничивает список страницей и переключает размер", async () => {
    const users = Array.from({ length: 30 }, (_value, index) => ({
      ...ALICE,
      id: `u${index + 10}`,
      login: `user${index + 10}`,
      email: `user${index + 10}@example.com`,
    }));
    const { vm } = setup(users);
    await vm.load();

    expect(vm.users).toHaveLength(25);
    expect(vm.activeTotal).toBe(30);
    expect(vm.pageCount).toBe(2);
    expect(vm.pageSummary).toBe("Показано 1–25 из 30");

    vm.goToPage(2);
    await vi.waitFor(() => {
      expect(vm.users).toHaveLength(5);
    });
    expect(vm.pageSummary).toBe("Показано 26–30 из 30");

    vm.setPageSize("10");
    await vi.waitFor(() => {
      expect(vm.users).toHaveLength(10);
    });
    expect(vm.pageSize).toBe(10);
    expect(vm.currentPage).toBe(1);
  });

  it("сбрасывает выделение при смене вкладки и фильтра", async () => {
    const { vm } = setup();
    await vm.load();
    vm.selectedIds = [ADMIN.id, ALICE.id];

    vm.setRoleFilter("admin");

    expect(vm.selectedIds).toEqual([]);
    expect(vm.roleFilter).toBe("admin");

    vm.selectedIds = [ADMIN.id];
    vm.setTab("pending");

    expect(vm.selectedIds).toEqual([]);
  });

  it("сохраняет расширенные фильтры между переходами", () => {
    const { vm } = setup();

    vm.setRoleFilter("admin");
    vm.setStatusFilter("disabled");

    expect(JSON.parse(localStorage.getItem(usersAdvancedFiltersStorage.key) ?? "{}")).toEqual({
      role: "admin",
      status: "disabled",
    });

    vm.resetFilters();

    expect(JSON.parse(localStorage.getItem(usersAdvancedFiltersStorage.key) ?? "{}")).toEqual({
      role: "all",
      status: "all",
    });
  });

  it("спрашивает подтверждение при закрытии изменённой формы", async () => {
    const { vm } = setup();
    vm.openCreate();
    vm.email = "dirty@example.com";

    expect(vm.formDirty).toBe(true);

    await vm.closeModal();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Отменить изменения?" }),
    );
    expect(vm.modalOpen).toBe(false);
  });

  it("не закрывает изменённую форму при отказе", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const { vm } = setup();
    vm.openCreate();
    vm.email = "dirty@example.com";

    await vm.closeModal();

    expect(vm.modalOpen).toBe(true);
    expect(vm.email).toBe("dirty@example.com");
  });

  it("запрещает удаление последнего администратора", async () => {
    const BOSS: User = { ...ALICE, id: "u9", login: "boss", email: "boss@example.com", role: "admin" };
    const { vm, usersRepo, session } = setup([BOSS]);
    session.user = { ...ADMIN, role: "user" };
    await vm.load();

    await vm.remove(BOSS);

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(usersRepo.users).toHaveLength(1);
  });

  it("не отправляет сброс пароля повторно и показывает ошибку рядом", async () => {
    const { vm, usersRepo, toasts } = setup();
    vm.openReset(ALICE);
    vm.resetPassword = "short";

    await vm.submitReset();

    expect(vm.resetError).toBe("Пароль должен содержать не менее 8 символов");
    expect(vm.resetOpen).toBe(true);
    expect(toastMessages(toasts)).toContain("Пароль должен содержать не менее 8 символов");

    const gate: { release: () => void } = { release: () => undefined };
    usersRepo.resetPassword = vi.fn(
      () => new Promise<void>((resolve) => { gate.release = resolve; }),
    );
    vm.resetPassword = "newsecret1";
    const first = vm.submitReset();
    await Promise.resolve();

    expect(vm.resetSaving).toBe(true);
    await vm.submitReset();

    expect(usersRepo.resetPassword).toHaveBeenCalledTimes(1);
    gate.release();
    await first;
    expect(vm.resetOpen).toBe(false);
  });
});

describe("UsersPageVM квоты, фильтры в URL", () => {
  it("показывает «нет данных» и ошибку загрузки квот", async () => {
    const { vm, quotaRepo } = setup();
    quotaRepo.failure = new Error("Квоты недоступны");
    await vm.load();

    expect(vm.quotaError).toBe("Квоты недоступны");
    expect(vm.quotaCellLabel(ALICE.id)).toBe("нет данных");
  });

  it("восстанавливает вкладку, поиск и страницу из URL", () => {
    window.history.replaceState(
      null,
      "",
      "/users?tab=pending&q=new&page=2&limit=10&role=admin&status=disabled",
    );
    try {
      const { vm } = setup();

      expect(vm.tab).toBe("pending");
      expect(vm.query).toBe("new");
      expect(vm.appliedQuery).toBe("new");
      expect(vm.roleFilter).toBe("admin");
      expect(vm.statusFilter).toBe("disabled");
      expect(vm.page).toBe(2);
      expect(vm.pendingPage).toBe(2);
      expect(vm.pageSize).toBe(10);
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("синхронизирует фильтры с query-параметрами", () => {
    window.history.replaceState({}, "", "/users");
    try {
      const { vm } = setup();

      vm.setRoleFilter("admin");
      vm.setStatusFilter("disabled");

      const params = new URLSearchParams(window.location.search);
      expect(params.get("role")).toBe("admin");
      expect(params.get("status")).toBe("disabled");

      vm.resetFilters();
      expect(window.location.search).toBe("");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
});
