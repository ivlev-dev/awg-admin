import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import type { Mock } from "vitest";
import { ProfilePageVM } from "./ProfilePage.vm";

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
  changePassword: Mock<(current: string | null, next: string) => Promise<void>>;
  logout: Mock<(refreshToken: string) => Promise<void>>;
}

function makeHarness(
  user: User = ADMIN,
  handlers: {
    changePassword?: (current: string | null, next: string) => Promise<void>;
    logout?: (refreshToken: string) => Promise<void>;
  } = {},
): Harness {
  const changePassword = vi.fn(
    handlers.changePassword ?? (async () => undefined),
  );
  const logout = vi.fn(handlers.logout ?? (async () => undefined));
  const auth: AuthRepository = {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout,
    me: vi.fn(async () => user),
    changePassword,
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
  return {
    vm: new ProfilePageVM(session, new DefaultAuthService(auth), router, theme, toasts),
    session,
    router,
    theme,
    toasts,
    tokens,
    auth,
    changePassword,
    logout,
  };
}

function submitEvent(): Event {
  return new Event("submit", { cancelable: true });
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

  it("resolves constructor dependencies through the container", async () => {
    const harness = makeHarness();
    const container = createAppContainer();
    container.bind(Session, () => harness.session);
    container.bind(DefaultAuthService, () => new DefaultAuthService(harness.auth));
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
