import { createComponent, flushSync } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { DefaultAuthService } from "@/application/auth/service";
import { DefaultQuotaService } from "@/application/quota/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSessionInfo, LogoutAllResult } from "@/domain/auth/types";
import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState } from "@/domain/quota/types";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import type { Mock } from "vitest";
import { setLocale } from "@/i18n";
import { formatDateTimeI18n } from "@/i18n/format";
import { ProfilePage } from "./ProfilePage";
import { ProfilePageVM } from "./ProfilePage.vm";

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

const REGULAR: User = {
  ...ADMIN,
  id: "u2",
  login: "operator",
  role: "user",
};

const SESSION: AuthSession = {
  token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: ADMIN,
};

const QUOTA: QuotaState = {
  used_bytes: 2 * 1024 * 1024 * 1024,
  quota_bytes: 10 * 1024 * 1024 * 1024,
  exceeded: false,
  remaining_bytes: 8 * 1024 * 1024 * 1024,
  percent: 20,
  period_start: "2026-11-01T00:00:00Z",
  period_end: "2026-12-01T00:00:00Z",
  reset_at: "2026-12-01T00:00:00Z",
};

const CHROME_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SESSIONS: AuthSessionInfo[] = [
  {
    jti: "jti-old-active",
    family_id: "fam-1",
    created_at: "2026-11-10T10:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    revoked: false,
    used: false,
    user_agent: CHROME_AGENT,
    ip: "203.0.113.7",
  },
  {
    jti: "jti-new-active",
    family_id: "fam-2",
    created_at: "2026-11-12T10:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    revoked: false,
    used: true,
    user_agent: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ip: "198.51.100.9",
  },
  {
    jti: "jti-revoked",
    family_id: "fam-3",
    created_at: "2026-11-05T10:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    revoked: true,
    used: false,
    user_agent: null,
    ip: null,
  },
  {
    jti: "jti-expired",
    family_id: "fam-4",
    created_at: "2026-11-01T10:00:00Z",
    expires_at: "2020-01-01T00:00:00Z",
    revoked: false,
    used: false,
    user_agent: "curl/8.0",
    ip: "192.0.2.5",
  },
];

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

interface Harness {
  vm: ProfilePageVM;
  session: Session;
  router: Router;
  theme: ThemeStore;
  toasts: ToastStore;
  tokens: MemoryTokenStore;
  auth: AuthRepository;
  quota: QuotaRepository;
  quotaMe: Mock<() => Promise<QuotaState>>;
  changePassword: Mock<(current: string | null, next: string) => Promise<void>>;
  logout: Mock<(refreshToken: string) => Promise<void>>;
  totpSetup: Mock<() => Promise<{ secret: string; otpauth_url: string; recovery_codes: string[] }>>;
  totpEnable: Mock<(code: string) => Promise<void>>;
  totpDisable: Mock<(password: string, code: string) => Promise<void>>;
  sessions: Mock<() => Promise<AuthSessionInfo[]>>;
  revokeSession: Mock<(jti: string) => Promise<void>>;
  logoutAll: Mock<() => Promise<LogoutAllResult>>;
}

function quotaHarness(state: QuotaState = QUOTA): {
  repository: QuotaRepository;
  me: Mock<() => Promise<QuotaState>>;
} {
  const me = vi.fn(async () => ({ ...state }));
  return {
    me,
    repository: {
      me,
      users: vi.fn(async () => []),
    },
  };
}

function makeHarness(
  user: User = ADMIN,
  handlers: {
    changePassword?: (current: string | null, next: string) => Promise<void>;
    logout?: (refreshToken: string) => Promise<void>;
    totpSetup?: () => Promise<{ secret: string; otpauth_url: string; recovery_codes: string[] }>;
    totpEnable?: (code: string) => Promise<void>;
    totpDisable?: (password: string, code: string) => Promise<void>;
    sessions?: () => Promise<AuthSessionInfo[]>;
    revokeSession?: (jti: string) => Promise<void>;
    logoutAll?: () => Promise<LogoutAllResult>;
  } = {},
  quotaState: QuotaState = QUOTA,
): Harness {
  const changePassword = vi.fn(
    handlers.changePassword ?? (async () => undefined),
  );
  const logout = vi.fn(handlers.logout ?? (async () => undefined));
  const totpSetup = vi.fn(
    handlers.totpSetup ??
      (async () => ({ secret: "SECRET", otpauth_url: "otpauth://totp/test", recovery_codes: ["1111", "2222"] })),
  );
  const totpEnable = vi.fn(handlers.totpEnable ?? (async () => undefined));
  const totpDisable = vi.fn(handlers.totpDisable ?? (async () => undefined));
  const sessions = vi.fn(handlers.sessions ?? (async () => []));
  const revokeSession = vi.fn(handlers.revokeSession ?? (async () => undefined));
  const logoutAll = vi.fn(
    handlers.logoutAll ?? (async () => ({ ok: true, revoked: 0 })),
  );
  let current: User = user;
  const auth: AuthRepository = {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout,
    me: vi.fn(async () => current),
    changePassword,
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    totpSetup,
    totpEnable: vi.fn(async (code: string) => {
      await totpEnable(code);
      current = { ...current, totp_enabled: true };
      return { enabled: true };
    }),
    totpDisable: vi.fn(async (password: string, code: string) => {
      await totpDisable(password, code);
      current = { ...current, totp_enabled: false };
      return { enabled: false };
    }),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    sessions,
    revokeSession,
    logoutAll,
  };
  const tokens = new MemoryTokenStore();
  tokens.set("access-1", "refresh-1");
  const session = new Session(auth, tokens);
  session.user = user;
  session.ready = true;
  const router = new Router();
  router.navigate("/profile");
  const theme = new ThemeStore();
  const toasts = new ToastStore();
  const quota = quotaHarness(quotaState);
  return {
    vm: new ProfilePageVM(
      session,
      new DefaultAuthService(auth),
      new DefaultQuotaService(quota.repository),
      router,
      theme,
      toasts,
    ),
    session,
    router,
    theme,
    toasts,
    tokens,
    auth,
    quota: quota.repository,
    quotaMe: quota.me,
    changePassword,
    logout,
    totpSetup,
    totpEnable,
    totpDisable,
    sessions,
    revokeSession,
    logoutAll,
  };
}

function submitEvent(): Event {
  return new Event("submit", { cancelable: true });
}

function valueEvent(value: string): Event {
  const event = new Event("input");
  Object.defineProperty(event, "target", { value: { value } });
  return event;
}

function stubConfirm(result: boolean): ReturnType<typeof vi.fn> {
  const confirm = vi.fn(() => result);
  vi.stubGlobal("confirm", confirm);
  return confirm;
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

describe("ProfilePageVM", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    setLocale("ru");
    vi.unstubAllGlobals();
  });

  it("shows the current user profile", () => {
    const harness = makeHarness();

    expect(harness.vm.login).toBe("admin");
    expect(harness.vm.userInitial).toBe("A");
    expect(harness.vm.userId).toBe("u1");
    expect(harness.vm.createdAtLabel).not.toBe("—");
    expect(harness.vm.isAdmin).toBe(true);
    expect(harness.vm.roleLabel).toBe("Администратор");
    expect(harness.vm.roleBadgeClass).toBe("badge badge--violet");
  });

  it("falls back to a guest profile without a user", () => {
    const harness = makeHarness();
    harness.session.user = null;

    expect(harness.vm.login).toBe("Гость");
    expect(harness.vm.userId).toBe("—");
    expect(harness.vm.createdAtLabel).toBe("—");
    expect(harness.vm.isAdmin).toBe(false);
  });

  it("grants every permission to an administrator", () => {
    const harness = makeHarness();

    expect(harness.vm.permissions).toHaveLength(6);
    expect(harness.vm.permissions.every((permission) => permission.granted)).toBe(true);
  });

  it("limits permissions of a regular user", () => {
    const harness = makeHarness(REGULAR);

    expect(harness.vm.isAdmin).toBe(false);
    expect(harness.vm.roleLabel).toBe("Пользователь");
    expect(harness.vm.roleBadgeClass).toBe("badge badge--blue");
    const granted = harness.vm.permissions
      .filter((permission) => permission.granted)
      .map((permission) => permission.key);
    expect(granted).toEqual(["read", "write", "share_config", "profile"]);
  });

  it("exposes the theme options", () => {
    const harness = makeHarness();

    expect(harness.vm.themeOptions.map((option) => option.value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
  });

  it("загружает квоту пользователя при создании", async () => {
    const harness = makeHarness();

    harness.vm.created();
    await vi.waitFor(() => expect(harness.vm.quotaLoading).toBe(false));
    await vi.waitFor(() => expect(harness.sessions).toHaveBeenCalledTimes(1));

    expect(harness.quotaMe).toHaveBeenCalledTimes(1);
    expect(harness.vm.quotaError).toBeNull();
    expect(harness.vm.quotaView).toMatchObject({
      hasQuota: true,
      exceeded: false,
      usedLabel: "2.0 ГБ",
      limitLabel: "10.0 ГБ",
      remainingLabel: "8.0 ГБ",
      percentLabel: "20.0 %",
      progress: 20,
      statusLabel: "В норме",
    });
    expect(harness.vm.quotaResetLabel).toBe(
      new Date(QUOTA.reset_at).toLocaleDateString("ru-RU"),
    );
  });

  it("помечает исчерпанную квоту пользователя", async () => {
    const harness = makeHarness(ADMIN, {}, {
      ...QUOTA,
      used_bytes: QUOTA.quota_bytes ?? 0,
      remaining_bytes: 0,
      percent: 100,
      exceeded: true,
    });

    await harness.vm.loadQuota();

    expect(harness.vm.quotaView.exceeded).toBe(true);
    expect(harness.vm.quotaView.statusLabel).toBe("Квота исчерпана");
    expect(harness.vm.quotaView.progressClass).toContain("progress__bar--danger");
  });

  it("показывает «Без ограничения» и скрывает прогресс без квоты", async () => {
    const harness = makeHarness(ADMIN, {}, {
      ...QUOTA,
      quota_bytes: null,
      remaining_bytes: null,
      percent: null,
    });

    await harness.vm.loadQuota();

    expect(harness.vm.quotaView.hasQuota).toBe(false);
    expect(harness.vm.quotaView.limitLabel).toBe("Без ограничения");
    expect(harness.vm.quotaView.percentLabel).toBe("—");
    expect(harness.vm.quotaView.progress).toBe(0);
  });

  it("обрабатывает ошибку загрузки квоты", async () => {
    const harness = makeHarness();
    vi.mocked(harness.quotaMe).mockRejectedValueOnce(new Error("Квота недоступна"));

    await harness.vm.loadQuota();

    expect(harness.vm.quota).toBeNull();
    expect(harness.vm.quotaError).toBe("Квота недоступна");
    expect(harness.vm.quotaLoading).toBe(false);
    expect(harness.vm.quotaView.hasQuota).toBe(false);
  });

  it("загружает сессии и помечает статусы", async () => {
    const harness = makeHarness(ADMIN, {
      sessions: async () => SESSIONS.map((session) => ({ ...session })),
    });

    await harness.vm.loadSessions();

    expect(harness.sessions).toHaveBeenCalledTimes(1);
    expect(harness.vm.sessionsLoading).toBe(false);
    expect(harness.vm.sessionsError).toBeNull();
    expect(harness.vm.sessionsEmpty).toBe(false);
    expect(harness.vm.canRevokeAll).toBe(true);
    expect(harness.vm.sessionRows.map((row) => row.jti)).toEqual([
      "jti-new-active",
      "jti-old-active",
      "jti-revoked",
      "jti-expired",
    ]);

    const [newest, chrome, revoked, expired] = harness.vm.sessionRows;
    expect(newest?.device).toBe("Firefox · Linux");
    expect(newest?.ip).toBe("198.51.100.9");
    expect(newest?.statusLabel).toBe("Активна");
    expect(newest?.statusClass).toBe("badge--green");
    expect(newest?.revocable).toBe(true);
    expect(newest?.busy).toBe(false);

    expect(chrome?.device).toBe("Chrome · Windows");
    expect(chrome?.deviceTitle).toBe(CHROME_AGENT);
    expect(chrome?.createdLabel).toBe(formatDateTimeI18n("2026-11-10T10:00:00Z"));
    expect(chrome?.expiresLabel).toBe(formatDateTimeI18n("2099-01-01T00:00:00Z"));

    expect(revoked?.device).toBe("Неизвестное устройство");
    expect(revoked?.ip).toBe("—");
    expect(revoked?.statusLabel).toBe("Отозвана");
    expect(revoked?.statusClass).toBe("badge--red");
    expect(revoked?.revocable).toBe(false);

    expect(expired?.device).toBe("curl/8.0");
    expect(expired?.statusLabel).toBe("Истекла");
    expect(expired?.statusClass).toBe("badge--gray");
    expect(expired?.revocable).toBe(false);
  });

  it("сокращает длинный user agent без распознавания", async () => {
    const longAgent = "custom-agent/" + "x".repeat(80);
    const harness = makeHarness(ADMIN, {
      sessions: async () => [
        {
          ...SESSIONS[0]!,
          jti: "jti-long",
          user_agent: longAgent,
        },
      ],
    });

    await harness.vm.loadSessions();

    const row = harness.vm.sessionRows[0];
    expect(row?.device).toBe(`${longAgent.slice(0, 47)}…`);
    expect(row?.deviceTitle).toBe(longAgent);
  });

  it("показывает пустое состояние без сессий", async () => {
    const harness = makeHarness();

    await harness.vm.loadSessions();

    expect(harness.vm.sessionRows).toEqual([]);
    expect(harness.vm.sessionsEmpty).toBe(true);
    expect(harness.vm.canRevokeAll).toBe(false);
    expect(harness.vm.sessionsError).toBeNull();
  });

  it("обрабатывает ошибку загрузки сессий", async () => {
    const harness = makeHarness(ADMIN, {
      sessions: async () => {
        throw new Error("Сессии недоступны");
      },
    });

    await harness.vm.loadSessions();

    expect(harness.vm.sessions).toEqual([]);
    expect(harness.vm.sessionsError).toBe("Сессии недоступны");
    expect(harness.vm.sessionsLoading).toBe(false);
    expect(harness.vm.sessionsEmpty).toBe(true);
  });

  it("использует запасное сообщение при неизвестной ошибке загрузки сессий", async () => {
    const harness = makeHarness(ADMIN, {
      sessions: async () => {
        throw "boom";
      },
    });

    await harness.vm.loadSessions();

    expect(harness.vm.sessionsError).toBe("Не удалось загрузить сессии");
  });

  it("завершает одну сессию после подтверждения и обновляет список", async () => {
    const confirm = stubConfirm(true);
    let sessions = SESSIONS.map((session) => ({ ...session }));
    const harness = makeHarness(ADMIN, {
      sessions: async () => sessions.map((session) => ({ ...session })),
      revokeSession: async (jti) => {
        sessions = sessions.filter((session) => session.jti !== jti);
      },
    });
    await harness.vm.loadSessions();

    await harness.vm.revokeSession("jti-old-active");

    expect(confirm).toHaveBeenCalledWith("Завершить эту сессию?");
    expect(harness.revokeSession).toHaveBeenCalledWith("jti-old-active");
    expect(harness.sessions).toHaveBeenCalledTimes(2);
    expect(harness.vm.sessionRows.map((row) => row.jti)).not.toContain("jti-old-active");
    expect(harness.toasts.items.some((item) => item.message === "Сессия завершена")).toBe(true);
    expect(harness.vm.sessionsBusy).toBe(false);
    expect(harness.vm.sessionsBusyJti).toBeNull();
  });

  it("не завершает сессию без подтверждения", async () => {
    const confirm = stubConfirm(false);
    const harness = makeHarness(ADMIN, { sessions: async () => SESSIONS });

    await harness.vm.revokeSession("jti-old-active");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(harness.revokeSession).not.toHaveBeenCalled();
    expect(harness.vm.sessionsBusy).toBe(false);
  });

  it("сообщает об ошибке завершения сессии", async () => {
    stubConfirm(true);
    const harness = makeHarness(ADMIN, {
      sessions: async () => SESSIONS,
      revokeSession: async () => {
        throw new Error("Нет доступа");
      },
    });

    await harness.vm.revokeSession("jti-old-active");

    expect(harness.toasts.items.some((item) => item.message === "Нет доступа")).toBe(true);
    expect(harness.vm.sessionsBusy).toBe(false);
    expect(harness.vm.sessionsBusyJti).toBeNull();
  });

  it("завершает все сессии и выводит из аккаунта", async () => {
    const confirm = stubConfirm(true);
    const harness = makeHarness(ADMIN, {
      sessions: async () => SESSIONS,
      logoutAll: async () => ({ ok: true, revoked: 3 }),
    });

    await harness.vm.revokeAll();

    expect(confirm).toHaveBeenCalledWith("Завершить все сессии? Потребуется войти заново.");
    expect(harness.logoutAll).toHaveBeenCalledTimes(1);
    expect(harness.logout).toHaveBeenCalledWith("refresh-1");
    expect(harness.tokens.access()).toBeNull();
    expect(harness.tokens.refresh()).toBeNull();
    expect(harness.session.user).toBeNull();
    expect(harness.router.path).toBe("/login");
    expect(
      harness.toasts.items.some((item) => item.message === "Все сессии завершены. Отозвано: 3"),
    ).toBe(true);
    expect(harness.vm.sessionsBusy).toBe(false);
  });

  it("не завершает все сессии без подтверждения", async () => {
    const confirm = stubConfirm(false);
    const harness = makeHarness(ADMIN, { sessions: async () => SESSIONS });

    await harness.vm.revokeAll();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(harness.logoutAll).not.toHaveBeenCalled();
    expect(harness.router.path).toBe("/profile");
    expect(harness.session.user).not.toBeNull();
  });

  it("сообщает об ошибке завершения всех сессий и остаётся в аккаунте", async () => {
    stubConfirm(true);
    const harness = makeHarness(ADMIN, {
      sessions: async () => SESSIONS,
      logoutAll: async () => {
        throw new Error("Сервер недоступен");
      },
    });

    await harness.vm.revokeAll();

    expect(harness.logout).not.toHaveBeenCalled();
    expect(harness.router.path).toBe("/profile");
    expect(harness.session.user).not.toBeNull();
    expect(harness.toasts.items.some((item) => item.message === "Сервер недоступен")).toBe(true);
    expect(harness.vm.sessionsBusy).toBe(false);
  });

  it("переключает язык интерфейса и сохраняет выбор", () => {
    const harness = makeHarness();

    expect(harness.vm.language).toBe("ru");
    expect(harness.vm.roleLabel).toBe("Администратор");
    expect(harness.vm.permissions[0]?.label).toBe("Просмотр");
    expect(harness.vm.themeOptions.map((option) => option.label)).toEqual([
      "Системная",
      "Светлая",
      "Тёмная",
    ]);

    harness.vm.setLanguage("en");

    expect(harness.vm.language).toBe("en");
    expect(harness.vm.roleLabel).toBe("Administrator");
    expect(harness.vm.permissions[0]?.label).toBe("View");
    expect(harness.vm.themeOptions.map((option) => option.label)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(harness.vm.effectiveThemeLabel).toBe("Light");
    expect(localStorage.getItem("awg.locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    harness.vm.setLanguage("de");

    expect(harness.vm.language).toBe("en");
  });

  it("показывает подписи квоты на выбранном языке", async () => {
    const harness = makeHarness();

    await harness.vm.loadQuota();

    expect(harness.vm.quotaUsedLabel).toBe("2.0 ГБ");
    expect(harness.vm.quotaLimitLabel).toBe("10.0 ГБ");
    expect(harness.vm.quotaRemainingLabel).toBe("8.0 ГБ");
    expect(harness.vm.quotaStatusLabel).toBe("В норме");

    setLocale("en");

    expect(harness.vm.quotaUsedLabel).toBe("2.0 GB");
    expect(harness.vm.quotaStatusLabel).toBe("Within limit");
  });

  it("switches the theme through the injected store", () => {
    const harness = makeHarness();

    harness.vm.setTheme("dark");

    expect(harness.theme.mode).toBe("dark");
    expect(harness.vm.effectiveTheme).toBe("dark");
    expect(harness.vm.effectiveThemeLabel).toBe("Тёмная");
    expect(harness.vm.isTheme("dark")).toBe(true);
    expect(harness.vm.isTheme("light")).toBe(false);
    expect(localStorage.getItem("awg.theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    harness.vm.setTheme("light");

    expect(harness.theme.mode).toBe("light");
    expect(harness.vm.effectiveTheme).toBe("light");
    expect(harness.vm.effectiveThemeLabel).toBe("Светлая");
  });

  it("validates that the next password is long enough", async () => {
    const harness = makeHarness();
    harness.vm.currentPassword = "old-password";
    harness.vm.nextPassword = "short";
    harness.vm.repeatPassword = "short";

    expect(harness.vm.nextTooShort).toBe(true);
    expect(harness.vm.canSave).toBe(false);

    await harness.vm.savePassword(submitEvent());

    expect(harness.changePassword).not.toHaveBeenCalled();
    expect(
      harness.toasts.items.some(
        (item) => item.message === "Новый пароль должен содержать минимум 8 символов",
      ),
    ).toBe(true);
    expect(harness.vm.saving).toBe(false);
  });

  it("requires the current password", async () => {
    const harness = makeHarness();
    harness.vm.nextPassword = "new-password";
    harness.vm.repeatPassword = "new-password";

    await harness.vm.savePassword(submitEvent());

    expect(harness.changePassword).not.toHaveBeenCalled();
    expect(
      harness.toasts.items.some((item) => item.message === "Введите текущий пароль"),
    ).toBe(true);
  });

  it("validates that the passwords match", async () => {
    const harness = makeHarness();
    harness.vm.currentPassword = "old-password";
    harness.vm.nextPassword = "new-password";
    harness.vm.repeatPassword = "another-password";

    expect(harness.vm.repeatMismatch).toBe(true);
    expect(harness.vm.canSave).toBe(false);

    await harness.vm.savePassword(submitEvent());

    expect(harness.changePassword).not.toHaveBeenCalled();
    expect(harness.toasts.items.some((item) => item.message === "Пароли не совпадают")).toBe(true);
  });

  it("changes the password and clears the form", async () => {
    const harness = makeHarness();
    harness.vm.currentPassword = "old-password";
    harness.vm.nextPassword = "new-password";
    harness.vm.repeatPassword = "new-password";

    expect(harness.vm.canSave).toBe(true);
    await harness.vm.savePassword(submitEvent());

    expect(harness.changePassword).toHaveBeenCalledWith("old-password", "new-password");
    expect(harness.vm.currentPassword).toBe("");
    expect(harness.vm.nextPassword).toBe("");
    expect(harness.vm.repeatPassword).toBe("");
    expect(harness.vm.saving).toBe(false);
    expect(harness.toasts.items.some((item) => item.message === "Пароль обновлён")).toBe(true);
  });

  it("keeps the form and reports an error when the password change fails", async () => {
    const harness = makeHarness(ADMIN, {
      changePassword: async () => {
        throw new Error("Неверный текущий пароль");
      },
    });
    harness.vm.currentPassword = "old-password";
    harness.vm.nextPassword = "new-password";
    harness.vm.repeatPassword = "new-password";

    await harness.vm.savePassword(submitEvent());

    expect(harness.vm.currentPassword).toBe("old-password");
    expect(harness.vm.nextPassword).toBe("new-password");
    expect(
      harness.toasts.items.some((item) => item.message === "Неверный текущий пароль"),
    ).toBe(true);
    expect(harness.vm.saving).toBe(false);
  });

  it("uses a fallback message for a non-Error password failure", async () => {
    const harness = makeHarness(ADMIN, {
      changePassword: async () => {
        throw "boom";
      },
    });
    harness.vm.currentPassword = "old-password";
    harness.vm.nextPassword = "new-password";
    harness.vm.repeatPassword = "new-password";

    await harness.vm.savePassword(submitEvent());

    expect(
      harness.toasts.items.some((item) => item.message === "Не удалось изменить пароль"),
    ).toBe(true);
  });

  it("does not submit twice while saving", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = makeHarness(ADMIN, {
      changePassword: async () => pending,
    });
    harness.vm.currentPassword = "old-password";
    harness.vm.nextPassword = "new-password";
    harness.vm.repeatPassword = "new-password";

    const submission = harness.vm.savePassword(submitEvent());
    expect(harness.vm.saving).toBe(true);

    await harness.vm.savePassword(submitEvent());
    expect(harness.changePassword).toHaveBeenCalledTimes(1);

    release();
    await submission;
    expect(harness.vm.saving).toBe(false);
  });

  it("logs out, clears tokens and navigates to the login page", async () => {
    const harness = makeHarness();

    await harness.vm.logout();

    expect(harness.logout).toHaveBeenCalledWith("refresh-1");
    expect(harness.tokens.access()).toBeNull();
    expect(harness.tokens.refresh()).toBeNull();
    expect(harness.session.user).toBeNull();
    expect(harness.router.path).toBe("/login");
  });

  it("logs out even when the server call fails", async () => {
    const harness = makeHarness(ADMIN, {
      logout: async () => {
        throw new Error("unreachable");
      },
    });

    await harness.vm.logout();

    expect(harness.session.user).toBeNull();
    expect(harness.tokens.refresh()).toBeNull();
    expect(harness.router.path).toBe("/login");
  });

  it("включает двухфакторную аутентификацию через модалку", async () => {
    const harness = makeHarness();
    expect(harness.vm.totpEnabled).toBe(false);
    expect(harness.vm.totpStatusLabel).toBe("Отключена");

    await harness.vm.openTotpSetup();

    expect(harness.totpSetup).toHaveBeenCalledTimes(1);
    expect(harness.vm.totpOpen).toBe(true);
    expect(harness.vm.totpSetup?.secret).toBe("SECRET");
    expect(harness.vm.totpSetup?.recovery_codes).toEqual(["1111", "2222"]);

    harness.vm.setTotpCode(valueEvent("123456"));
    expect(harness.vm.canEnableTotp).toBe(true);

    await harness.vm.submitTotpEnable();

    expect(harness.totpEnable).toHaveBeenCalledWith("123456");
    expect(harness.vm.totpOpen).toBe(false);
    expect(harness.vm.totpEnabled).toBe(true);
    expect(harness.vm.totpStatusLabel).toBe("Включена");
    expect(harness.toasts.items.some((item) => item.message === "Двухфакторная аутентификация включена")).toBe(true);
  });

  it("не включает 2FA с некорректным кодом", async () => {
    const harness = makeHarness();
    await harness.vm.openTotpSetup();
    harness.vm.setTotpCode(valueEvent("12"));

    expect(harness.vm.canEnableTotp).toBe(false);
    await harness.vm.submitTotpEnable();

    expect(harness.totpEnable).not.toHaveBeenCalled();
    expect(harness.toasts.items.some((item) => item.message === "Введите 6-значный код")).toBe(true);
  });

  it("показывает ошибку загрузки параметров 2FA", async () => {
    const harness = makeHarness(ADMIN, {
      totpSetup: async () => {
        throw new Error("Сервис недоступен");
      },
    });

    await harness.vm.openTotpSetup();

    expect(harness.vm.totpSetupError).toBe("Сервис недоступен");
    expect(harness.vm.totpSetup).toBeNull();
    expect(harness.vm.totpSetupLoading).toBe(false);
  });

  it("отключает двухфакторную аутентификацию по паролю и коду", async () => {
    const harness = makeHarness({ ...ADMIN, totp_enabled: true });

    await harness.vm.toggleTotp();

    expect(harness.vm.totpDisableOpen).toBe(true);
    harness.vm.setTotpDisablePassword(valueEvent("secret"));
    harness.vm.setTotpDisableCode(valueEvent("654321"));

    expect(harness.vm.canDisableTotp).toBe(true);
    await harness.vm.submitTotpDisable();

    expect(harness.totpDisable).toHaveBeenCalledWith("secret", "654321");
    expect(harness.vm.totpDisableOpen).toBe(false);
    expect(harness.vm.totpEnabled).toBe(false);
    expect(harness.toasts.items.some((item) => item.message === "Двухфакторная аутентификация отключена")).toBe(true);
  });

  it("не отключает 2FA без пароля", async () => {
    const harness = makeHarness({ ...ADMIN, totp_enabled: true });
    harness.vm.openTotpDisable();
    harness.vm.setTotpDisableCode(valueEvent("654321"));

    expect(harness.vm.canDisableTotp).toBe(false);
    await harness.vm.submitTotpDisable();

    expect(harness.totpDisable).not.toHaveBeenCalled();
  });

  it("копирует резервные коды", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const harness = makeHarness();
    await harness.vm.openTotpSetup();

    await harness.vm.copyRecoveryCodes();

    expect(writeText).toHaveBeenCalledWith("1111\n2222");
    expect(harness.toasts.items.some((item) => item.message === "Резервные коды скопированы")).toBe(true);
  });

  it("копирует секрет TOTP", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const harness = makeHarness();
    await harness.vm.openTotpSetup();

    await harness.vm.copyTotpSecret();

    expect(writeText).toHaveBeenCalledWith("SECRET");
    expect(harness.toasts.items.some((item) => item.message === "Секрет скопирован")).toBe(true);
    expect(harness.totpSetup).toHaveBeenCalledTimes(1);
  });

  it("показывает QR с otpauth_url в модалке включения 2FA", async () => {
    const harness = makeHarness();
    const container = createAppContainer();
    container.bind(Session, () => harness.session);
    container.bind(DefaultAuthService, () => new DefaultAuthService(harness.auth));
    container.bind(DefaultQuotaService, () => new DefaultQuotaService(harness.quota));
    container.bind(Router, () => harness.router);
    container.bind(ThemeStore, () => harness.theme);
    container.bind(ToastStore, () => harness.toasts);

    const result = createComponent(ProfilePage, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);
    flushSync();

    const enableButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Включить",
    );
    expect(enableButton).not.toBeUndefined();
    enableButton?.click();
    flushSync();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Включение 2FA");
    });
    expect(harness.totpSetup).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(document.querySelector(".modal svg.qr-code__svg")).not.toBeNull();
    });

    const svg = document.querySelector(".modal svg.qr-code__svg");
    expect(svg?.getAttribute("aria-label")).toBe(
      "QR-код для добавления в приложение-аутентификатор",
    );
    expect(svg?.getAttribute("role")).toBe("img");

    const readonly = Array.from(
      document.querySelectorAll<HTMLInputElement>(".modal input[readonly]"),
    ).map((input) => input.value);
    expect(readonly).toContain("otpauth://totp/test");
    expect(readonly).toContain("SECRET");
    expect(document.body.textContent).toContain("Копировать секрет");

    result.dispose();
    document.body.replaceChildren();
  });

  it("resolves constructor dependencies through the container", async () => {
    const harness = makeHarness();
    const container = createAppContainer();
    container.bind(Session, () => harness.session);
    container.bind(DefaultAuthService, () => new DefaultAuthService(harness.auth));
    container.bind(DefaultQuotaService, () => new DefaultQuotaService(harness.quota));
    container.bind(Router, () => harness.router);
    container.bind(ThemeStore, () => harness.theme);
    container.bind(ToastStore, () => harness.toasts);

    const vm = await container.resolve<ProfilePageVM>(ProfilePageVM);

    expect(vm).toBeInstanceOf(ProfilePageVM);
    expect(await container.resolve(ProfilePageVM)).toBe(vm);
    expect(vm.login).toBe("admin");
  });

  it("auto-wires the session, theme and toast stores without explicit bindings", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<ProfilePageVM>(ProfilePageVM);

    expect(vm).toBeInstanceOf(ProfilePageVM);
    expect(vm.login).toBe("Гость");
    expect(vm.effectiveTheme).toBe("light");
    expect(vm.themeOptions).toHaveLength(3);
  });
});
