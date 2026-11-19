import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultNodesService } from "@/application/nodes/service";
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
  UpdateProfileInput,
  VerifyEmailResult,
} from "@/domain/auth/types";
import type { NodesRepository } from "@/domain/nodes/repository";
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
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import { pageUsersFromList } from "@/domain/users/query";
import type { UserPageParams } from "@/domain/users/types";
import type { Page } from "@/domain/page";
import type { CreateUserInput, UpdateUserInput, ApproveUserInput } from "@/domain/users/types";
import type { TokenStore } from "@/infrastructure/storage";
import { UsersPage } from "@/features/users/UsersPage";
import { UsersPageVM } from "@/features/users/UsersPage.vm";

const ADMIN: User = {
  id: "u1",
  full_name: "Админ Панели",
  role: "admin",
  tariff_id: null,
  group_id: null,
  node_id: "n1",
  email: "user@example.com",
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

const QUOTA: UserQuota = {
  user_id: ADMIN.id,
  email: ADMIN.email,
  used_bytes: 1024,
  quota_bytes: 2048,
  exceeded: false,
  percent: 50,
};

class StubUsersRepository {
  async listUsers(): Promise<User[]> {
    return [ADMIN];
  }

  async pageUsers(params: UserPageParams): Promise<Page<User>> {
    return pageUsersFromList([ADMIN], params);
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

class StubNodesRepository {
  async listNodes(): Promise<NodeInfo[]> {
    return [NODE];
  }

  async createNode(name: string): Promise<NodeCreated> {
    return { node: { id: "n2", name, created_at: "2020-01-01T00:00:00Z" }, token: "token" };
  }

  async rotateNode(_id: string): Promise<NodeRotated> {
    return { node: NODE, token: "rotated" };
  }

  async deleteNode(_id: string): Promise<void> {}

  async bulk(_action: "delete", _ids: readonly string[]) {
    return { done: 0, failed: [] };
  }
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

  async updateProfile(input: UpdateProfileInput): Promise<User> {
    return { ...ADMIN, ...input };
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
      if (url.includes("/users/page")) {
        return jsonResponse({ items: [ADMIN], total: 1, limit: 25, offset: 0 });
      }
      if (url.endsWith("/users")) return jsonResponse([ADMIN]);
      if (url.endsWith("/tariffs")) return jsonResponse([TARIFF]);
      if (url.endsWith("/nodes")) return jsonResponse([NODE]);
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
    container.bind(DefaultNodesService, () => new DefaultNodesService(new StubNodesRepository()));
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
    expect(vm.nodes).toEqual([NODE]);
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
    expect(vm.nodes).toEqual([NODE]);
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

    const fullNameCell = root.querySelector("td[data-label='ФИО']");
    expect(fullNameCell?.textContent).toContain("Админ Панели");
    const emailCell = root.querySelector("td[data-label='Email']");
    expect(emailCell?.textContent).toContain(ADMIN.email);
    expect(root.querySelector("#users-search")?.getAttribute("placeholder")).toBe("Поиск по email или ФИО");

    const nodeCell = root.querySelector("td[data-label='Тариф/нода']");
    expect(nodeCell?.textContent).toContain("Node 1");
    expect(root.querySelector("#users-role")).not.toBeNull();
    expect(root.querySelector("#users-status")).not.toBeNull();
    expect(root.querySelector("#users-node")).toBeNull();

    const cardMeta = root.querySelector(".entity-list");
    expect(cardMeta).toBeNull();
    const row = root.querySelector("tbody tr");
    expect(row?.textContent).toContain("Node 1");
    expect(row?.textContent).not.toContain("Группа");

    const actions = root.querySelector("td.cell-actions");
    expect(actions?.querySelectorAll("button")).toHaveLength(4);

    result.dispose();
  });
});
