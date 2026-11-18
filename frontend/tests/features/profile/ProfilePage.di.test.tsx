import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { DefaultAuthService } from "@/application/auth/service";
import { DefaultQuotaService } from "@/application/quota/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSessionInfo } from "@/domain/auth/types";
import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState } from "@/domain/quota/types";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { setLocale } from "@/i18n";
import { ProfilePage } from "@/features/profile/ProfilePage";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_options: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);

const USER: User = {
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

const SESSION: AuthSession = {
  token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: USER,
};

const QUOTA: QuotaState = {
  used_bytes: 1024,
  quota_bytes: null,
  exceeded: false,
  remaining_bytes: null,
  percent: null,
  period_start: "2026-11-01T00:00:00Z",
  period_end: "2026-12-01T00:00:00Z",
  reset_at: "2026-12-01T00:00:00Z",
};

const SESSIONS: AuthSessionInfo[] = [
  {
    jti: "jti-active",
    family_id: "fam-1",
    created_at: "2026-11-10T10:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    revoked: false,
    used: false,
    user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    ip: "203.0.113.7",
  },
  {
    jti: "jti-revoked",
    family_id: "fam-2",
    created_at: "2026-11-05T10:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    revoked: true,
    used: false,
    user_agent: null,
    ip: null,
  },
];

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

function authRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    login: async () => SESSION,
    refresh: async () => SESSION,
    logout: async () => undefined,
    me: async () => USER,
    changePassword: async () => undefined,
    register: async () => ({ status: "pending_email" as const }),
    verifyEmail: async () => ({ status: "pending_approval" as const }),
    resendVerification: async () => undefined,
    forgotPassword: async () => ({ status: "sent" as const }),
    resetPassword: async () => ({ status: "reset" as const }),
    totpSetup: async () => ({
      secret: "SECRET",
      otpauth_url: "otpauth://totp/test",
      recovery_codes: [],
    }),
    totpEnable: async () => ({ enabled: true }),
    totpDisable: async () => ({ enabled: false }),
    sessions: async () => SESSIONS,
    revokeSession: async () => undefined,
    logoutAll: async () => ({ ok: true, revoked: 2 }),
    ...overrides,
  };
}

function quotaRepository(): QuotaRepository {
  return {
    me: async () => ({ ...QUOTA }),
    users: async () => [],
  };
}

interface Harness {
  router: Router;
  toasts: ToastStore;
  tokens: MemoryTokenStore;
  dispose(): void;
}

function mount(auth: AuthRepository): Harness {
  const tokens = new MemoryTokenStore();
  tokens.set("access-1", "refresh-1");
  const session = new Session(auth, tokens);
  session.user = USER;
  session.ready = true;
  const router = new Router();
  router.navigate("/profile");
  const theme = new ThemeStore();
  const toasts = new ToastStore();
  const container = createAppContainer();
  container.bind(Session, () => session);
  container.bind(DefaultAuthService, () => new DefaultAuthService(auth));
  container.bind(DefaultQuotaService, () => new DefaultQuotaService(quotaRepository()));
  container.bind(Router, () => router);
  container.bind(ThemeStore, () => theme);
  container.bind(ToastStore, () => toasts);
  const result = createComponent(ProfilePage, {}, { container });
  document.body.append(result.node);
  return {
    router,
    toasts,
    tokens,
    dispose: () => {
      result.dispose();
      result.node.parentNode?.removeChild(result.node);
    },
  };
}

function actionButtons(node: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    node.querySelectorAll<HTMLButtonElement>(".table--sessions tbody button"),
  );
}

function buttonByText(node: HTMLElement, text: string): HTMLButtonElement | null {
  const button = Array.from(node.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  return button ?? null;
}

describe("ProfilePage sessions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    setLocale("ru");
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders session rows with device, ip and statuses", async () => {
    const harness = mount(authRepository());
    const root = document.body;

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Активные сессии");
      expect(root.textContent).toContain("Chrome · Windows");
      expect(root.textContent).toContain("203.0.113.7");
      expect(root.textContent).toContain("Неизвестное устройство");
      expect(root.textContent).toContain("Отозвана");
    });

    const rows = root.querySelectorAll(".table--sessions tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector(".badge")?.textContent).toBe("Активна");

    const buttons = actionButtons(root);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);

    harness.dispose();
  });

  it("filters sessions with the toolbar and shows a no-match state", async () => {
    const harness = mount(authRepository());
    const root = document.body;

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".table--sessions tbody tr")).toHaveLength(2);
    });

    const toolbar = root.querySelector(".list-toolbar");
    expect(toolbar).not.toBeNull();

    const search = root.querySelector<HTMLInputElement>("#sessions-search");
    if (search === null) throw new Error("sessions search input is missing");
    search.value = "203.0.113";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".table--sessions tbody tr")).toHaveLength(1);
    });

    search.value = "unknown-host";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Ничего не найдено");
    });
    expect(root.querySelector(".table--sessions")).toBeNull();

    const reset = buttonByText(root, "Сбросить");
    if (reset === null) throw new Error("reset button is missing");
    reset.click();

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".table--sessions tbody tr")).toHaveLength(2);
    });

    harness.dispose();
  });

  it("renders the empty state without sessions", async () => {
    const harness = mount(authRepository({ sessions: async () => [] }));
    const root = document.body;

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Сессий нет");
    });

    expect(root.querySelector(".table--sessions")).toBeNull();
    expect(buttonByText(root, "Завершить все сессии")?.disabled).toBe(true);

    harness.dispose();
  });

  it("revokes a session after confirmation", async () => {
    const revokeSession = vi.fn(async (_jti: string) => undefined);
    confirmMock.askConfirm.mockClear();
    confirmMock.askConfirm.mockResolvedValue(true);
    const harness = mount(authRepository({ revokeSession }));
    const root = document.body;

    await vi.waitFor(() => expect(actionButtons(root)).toHaveLength(2));

    actionButtons(root)[0]?.click();

    await vi.waitFor(() => expect(revokeSession).toHaveBeenCalledWith("jti-active"));
    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Завершить эту сессию?" }),
    );
    await vi.waitFor(() => {
      expect(
        harness.toasts.items.some((item) => item.message === "Сессия завершена"),
      ).toBe(true);
    });

    harness.dispose();
  });

  it("ends all sessions and redirects to login", async () => {
    const logoutAll = vi.fn(async () => ({ ok: true, revoked: 2 }));
    confirmMock.askConfirm.mockClear();
    confirmMock.askConfirm.mockResolvedValue(true);
    const harness = mount(authRepository({ logoutAll }));
    const root = document.body;

    await vi.waitFor(() => expect(buttonByText(root, "Завершить все сессии")).not.toBeNull());

    buttonByText(root, "Завершить все сессии")?.click();

    await vi.waitFor(() => expect(harness.router.path).toBe("/login"));
    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Завершить все сессии? Потребуется войти заново." }),
    );
    expect(logoutAll).toHaveBeenCalledTimes(1);
    expect(harness.tokens.access()).toBeNull();

    harness.dispose();
  });

  it("switches the sessions card language", async () => {
    const harness = mount(authRepository());
    const root = document.body;

    await vi.waitFor(() => expect(root.textContent).toContain("Активные сессии"));

    setLocale("en");

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Active sessions");
      expect(root.textContent).toContain("Revoked");
      expect(root.textContent).toContain("End all sessions");
    });
    expect(root.textContent).not.toContain("Сессий нет");

    harness.dispose();
  });
});
