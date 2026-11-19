import { createComponent, flushSync } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";


import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultNodesService } from "@/application/nodes/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { QuotaRepository } from "@/domain/quota/repository";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { AuthSession, NodeInfo, Tariff, User } from "@/domain/types";
import type { UsersRepository } from "@/domain/users/repository";
import { pageUsersFromList } from "@/domain/users/query";
import { UsersPage } from "@/features/users/UsersPage";
import { UsersPageVM } from "@/features/users/UsersPage.vm";
import { setLocale } from "@/i18n";

const ADMIN: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: "t1",
  group_id: null,
  node_id: "n1",
  email: "admin@example.com",
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
  device_down_kbps: 100_000,
  device_up_kbps: 50_000,
  group_down_kbps: 0,
  group_up_kbps: 0,
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

function authRepository(user: User): AuthRepository {
  return {
    login: vi.fn(async () => {
      throw new Error("not used");
    }),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    refresh: vi.fn(async () => ({ token: "a", refresh_token: "r", expires_in: 1, user }) as AuthSession),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => user),
    changePassword: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
}

interface HarnessOptions {
  users?: User[];
  failUsers?: boolean;
}

function usersRepository(options: HarnessOptions): UsersRepository {
  const list = options.users ?? [ADMIN];
  return {
    listUsers: vi.fn(async () => {
      if (options.failUsers === true) throw new Error("Сеть недоступна");
      return list;
    }),
    pageUsers: vi.fn(async (params) => {
      if (options.failUsers === true) throw new Error("Сеть недоступна");
      return pageUsersFromList(list, params);
    }),
    listPending: vi.fn(async () => []),
    approveUser: vi.fn(async () => ADMIN),
    rejectUser: vi.fn(async () => ADMIN),
    createUser: vi.fn(async () => ADMIN),
    updateUser: vi.fn(async () => ADMIN),
    deleteUser: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function tariffsRepository(): TariffsRepository {
  return {
    listTariffs: vi.fn(async () => [TARIFF]),
    createTariff: vi.fn(async () => TARIFF),
    updateTariff: vi.fn(async () => TARIFF),
    deleteTariff: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function nodesRepository(): NodesRepository {
  return {
    listNodes: vi.fn(async () => [NODE]),
    createNode: vi.fn(async () => ({ node: { id: "n2", name: "n2", created_at: "" }, token: "t" })),
    rotateNode: vi.fn(async () => ({ node: NODE, token: "t" })),
    deleteNode: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function quotaRepository(): QuotaRepository {
  return {
    me: vi.fn(async () => {
      throw new Error("not used");
    }),
    users: vi.fn(async () => []),
  };
}

async function render(options: HarnessOptions = {}) {
  const session = new Session(authRepository(ADMIN), new MemoryTokenStore());
  session.user = ADMIN;
  const vm = new UsersPageVM(
    new DefaultUsersService(usersRepository(options)),
    new DefaultTariffsService(tariffsRepository()),
    new DefaultNodesService(nodesRepository()),
    new DefaultQuotaService(quotaRepository()),
    session,
    new ToastStore(),
  );
  const container = new Container("users-page-render");
  container.bindValue(UsersPageVM, vm);
  const result = createComponent(UsersPage, {}, { container });
  await result.ready;
  flushSync();
  document.body.appendChild(result.node);
  flushSync();
  return result;
}

beforeEach(() => {
  setLocale("ru");
});

afterEach(() => {
  setLocale("ru");
  document.body.replaceChildren();
});

describe("UsersPage разметка и локализация", () => {
  it("в английской локали не содержит кириллицы", async () => {
    setLocale("en");
    const result = await render();

        await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Users");
      expect(document.body.textContent).toContain("admin@example.com");
    });

    expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
    result.dispose();
  });

  it("не показывает пустое состояние при ошибке загрузки", async () => {
    const result = await render({ failUsers: true });
    
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Не удалось загрузить пользователей");
    });

    expect(document.body.textContent).not.toContain("Нет пользователей");
    expect(document.querySelector("button")?.textContent).toBeDefined();
    result.dispose();
  });

  it("не использует фиксированную раскладку и помечает ключевые колонки", async () => {
    const result = await render();
    
    await vi.waitFor(() => {
      expect(document.querySelector("table.table--users")).not.toBeNull();
    });

    const table = document.querySelector("table.table--users");
    expect(table?.classList.contains("table--fixed")).toBe(false);
    expect(table?.querySelector("th.col-user")).not.toBeNull();
    expect(table?.querySelector("th.col-role")).not.toBeNull();
    expect(table?.querySelector("th.col-actions")?.getAttribute("aria-label")).toBe("Действия");
    expect(table?.getAttribute("aria-label")).toBe("Учётные записи");
    result.dispose();
  });

  it("ограничивает страницу и переключает её", async () => {
    const users = Array.from({ length: 30 }, (_value, index) => ({
      ...ADMIN,
      id: `u${index + 1}`,
      login: `user${index + 1}`,
      email: `user${index + 1}@example.com`,
    }));
    const result = await render({ users });
    
    await vi.waitFor(() => {
      expect(document.querySelectorAll("tbody tr")).toHaveLength(25);
    });

    const next = document.querySelector<HTMLButtonElement>('button[aria-label="Следующая страница"]');
    next?.click();
    flushSync();

    await vi.waitFor(() => {
      expect(document.querySelectorAll("tbody tr")).toHaveLength(5);
    });
    expect(document.body.textContent).toContain("26–30 из 30");
    result.dispose();
  });

  it("показывает общий счётчик и блокирует кнопки на границах", async () => {
    const users = Array.from({ length: 30 }, (_value, index) => ({
      ...ADMIN,
      id: `u${index + 1}`,
      login: `user${index + 1}`,
      email: `user${index + 1}@example.com`,
    }));
    const result = await render({ users });

    await vi.waitFor(() => {
      expect(document.querySelectorAll("tbody tr")).toHaveLength(25);
    });

    expect(document.body.textContent).toContain("Найдено: 30");

    const prev = document.querySelector<HTMLButtonElement>('button[aria-label="Предыдущая страница"]');
    const next = document.querySelector<HTMLButtonElement>('button[aria-label="Следующая страница"]');
    expect(prev?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);

    next?.click();
    flushSync();

    await vi.waitFor(() => {
      expect(document.querySelectorAll("tbody tr")).toHaveLength(5);
    });

    const prevAfter = document.querySelector<HTMLButtonElement>('button[aria-label="Предыдущая страница"]');
    const nextAfter = document.querySelector<HTMLButtonElement>('button[aria-label="Следующая страница"]');
    expect(prevAfter?.disabled).toBe(false);
    expect(nextAfter?.disabled).toBe(true);
    result.dispose();
  });

  it("фокусирует первое поле формы и показывает ошибку рядом с полем", async () => {
    const result = await render();
    
    await vi.waitFor(() => {
      expect(document.querySelector("table.table--users")).not.toBeNull();
    });

    const create = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Новый пользователь"),
    );
    const opener = create;
    opener?.focus();
    create?.click();
    flushSync();

    const email = document.querySelector<HTMLInputElement>("#users-form-email");
    expect(email).not.toBeNull();
    expect(document.querySelectorAll(".modal").length).toBe(1);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(email);
    });
    expect(document.querySelector("form#users-form")).not.toBeNull();
    const submit = document.querySelector<HTMLButtonElement>('button[type="submit"][form="users-form"]');
    expect(submit).not.toBeNull();

    if (email !== null) {
      email.value = "bad";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
    }
    document.querySelector("form#users-form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    flushSync();

    await vi.waitFor(() => {
      expect(document.querySelector("#users-form-email-error")?.getAttribute("role")).toBe("alert");
    });
    expect(document.querySelector("#users-form-email")?.getAttribute("aria-invalid")).toBe("true");
    result.dispose();
  });
});
