import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { BulkResult } from "@/domain/bulk";
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
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
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
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import type { CreateUserInput, UpdateUserInput, ApproveUserInput } from "@/domain/users/types";
import type { TokenStore } from "@/infrastructure/storage";
import { UsersPage } from "@/features/users/UsersPage";
import { UsersPageVM } from "@/features/users/UsersPage.vm";

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

const QUOTA: UserQuota = {
  user_id: ADMIN.id,
  login: ADMIN.login,
  used_bytes: 1024,
  quota_bytes: 2048,
  exceeded: false,
  percent: 50,
};

class StubUsersRepository {
  async listUsers(): Promise<User[]> {
    return [ADMIN];
  }

  async listPending(): Promise<User[]> {
    return [];
  }

  async approveUser(_id: string, _input: ApproveUserInput): Promise<User> {
    return ADMIN;
  }

  async rejectUser(_id: string): Promise<User> {
    return ADMIN;
  }

  async createUser(_input: CreateUserInput): Promise<User> {
    return ADMIN;
  }

  async updateUser(_id: string, _input: UpdateUserInput): Promise<User> {
    return ADMIN;
  }

  async deleteUser(_id: string): Promise<void> {}

  async resetPassword(_id: string, _password: string): Promise<void> {}

  async bulk(_action: UsersBulkAction, _ids: readonly string[]): Promise<BulkResult> {
    return { done: 0, failed: [] };
  }
}

class StubTariffsRepository {
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

  async bulk(_action: "delete", _ids: readonly string[]) {
    return { done: 0, failed: [] };
  }
}

class StubGroupsRepository {
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

  async bulk(_action: "delete", _ids: readonly string[]) {
    return { done: 0, failed: [] };
  }

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

class StubQuotaRepository {
  async me(): Promise<QuotaState> {
    throw new Error("not used");
  }

  async users(): Promise<UserQuota[]> {
    return [{ ...QUOTA }];
  }
}

class StubAuthRepository {
  async login(_input: LoginInput): Promise<AuthSession> {
    throw new Error("not used");
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
    throw new Error("not used");
  }

  async logout(_refreshToken: string): Promise<void> {}

  async me(): Promise<User> {
    return ADMIN;
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
      if (url.endsWith("/quota/users")) return jsonResponse([QUOTA]);
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
    container.bind(DefaultUsersService, () => new DefaultUsersService(new StubUsersRepository()));
    container.bind(DefaultTariffsService, () => new DefaultTariffsService(new StubTariffsRepository()));
    container.bind(DefaultGroupsService, () => new DefaultGroupsService(new StubGroupsRepository()));
    container.bind(DefaultQuotaService, () => new DefaultQuotaService(new StubQuotaRepository()));
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
    expect(vm.quotas).toEqual([
      expect.objectContaining({ userId: ADMIN.id, percent: 50, quotaBytes: 2048 }),
    ]);
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
    expect(vm.quotaPercentLabel(ADMIN.id)).toBe("50.0 %");
    result.dispose();
  });

  it("рендерит список как мобильные карточки с подписями и действиями", async () => {
    stubApi();
    const container = createAppContainer();

    const result = createComponent(UsersPage, {}, { container });
    await result.ready;

    const root = result.node as ParentNode;

    await vi.waitFor(() => {
      expect(root.querySelector("table.table--users")).not.toBeNull();
    });

    const table = root.querySelector("table.table--users");
    expect(table?.classList.contains("table--cards")).toBe(true);
    expect(root.querySelector(".table-wrap--cards")).not.toBeNull();
    expect(root.querySelector(".tabs--fill")).not.toBeNull();

    const quotaCell = root.querySelector("td[data-label='Квота']");
    expect(quotaCell?.querySelector(".user-quota")).not.toBeNull();
    expect(quotaCell?.textContent).toContain("%");

    const actions = root.querySelector("td.cell-actions");
    expect(actions?.querySelectorAll("button")).toHaveLength(4);

    result.dispose();
  });
});
