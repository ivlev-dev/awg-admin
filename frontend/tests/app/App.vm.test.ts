import { createComponent, getRuntimeOptions, whenIdle } from "@ivlev-dev/silent-core";

const prefetchModule = vi.hoisted(() => ({
  prefetchPath: vi.fn((_path: string): Promise<void> => Promise.resolve()),
  scheduleIdlePrefetch: vi.fn((_options: { readonly routes?: readonly string[] } = {}): (() => void) => () => undefined),
  IDLE_PREFETCH_PATHS: ["/clients", "/stats"] as readonly string[],
}));

vi.mock("@/app/prefetch", () => prefetchModule);

import type { AuthRepository } from "@/domain/auth/repository";
import type { LoginInput } from "@/domain/auth/types";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { DefaultUsersService } from "@/application/users/service";
import { LiveStats } from "@/infrastructure/stats";
import { AppVM } from "@/app/App.vm";
import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { setLocale } from "@/i18n";

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

const PLAIN: User = {
  ...ADMIN,
  id: "u2",
  login: "alice",
  role: "user",
};

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

function authSession(user: User): AuthSession {
  return {
    token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    user,
  };
}

function makeAuth(current: User | null): AuthRepository {
  return {
    login: vi.fn(async (_input: LoginInput) => {
      if (current === null) throw new Error("Неверный логин или пароль");
      return authSession(current);
    }),
    refresh: vi.fn(async () => {
      if (current === null) throw new Error("unauthorized");
      return authSession(current);
    }),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => {
      if (current === null) throw new Error("unauthorized");
      return current;
    }),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
}

function makeSession(current: User | null, tokens: TokenStore = new MemoryTokenStore()): Session {
  const session = new Session(makeAuth(current), tokens);
  if (current !== null) session.user = current;
  session.ready = true;
  return session;
}

interface Harness {
  vm: AppVM;
  session: Session;
  router: Router;
  theme: ThemeStore;
  toasts: ToastStore;
  tokens: MemoryTokenStore;
}

function makeHarness(options: { user?: User | null; path?: string } = {}): Harness {
  const current = options.user === undefined ? ADMIN : options.user;
  const path = options.path ?? "/";
  window.history.replaceState(null, "", path);
  const tokens = new MemoryTokenStore();
  const session = makeSession(current, tokens);
  const router = new Router();
  const theme = new ThemeStore();
  const toasts = new ToastStore();
  const vm = new AppVM(session, router, theme, toasts);
  vm.booting = false;
  return { vm, session, router, theme, toasts, tokens };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  setLocale("ru");
  vi.unstubAllGlobals();
});

describe("AppVM access guard", () => {
  it("sends a guest from a protected route to the login page", () => {
    const harness = makeHarness({ user: null, path: "/nodes" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/login");
  });

  it("keeps a guest on the public login route", () => {
    const harness = makeHarness({ user: null, path: "/login" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/login");
  });

  it("keeps a guest on the public registration route", () => {
    const harness = makeHarness({ user: null, path: "/register" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/register");
  });

  it("keeps a guest on the public email verification route", () => {
    const harness = makeHarness({ user: null, path: "/verify-email" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/verify-email");
  });

  it("keeps a guest on the public forgot-password route", () => {
    const harness = makeHarness({ user: null, path: "/forgot-password" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/forgot-password");
  });

  it("keeps a guest on the public reset-password route", () => {
    const harness = makeHarness({ user: null, path: "/reset-password" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/reset-password");
  });

  it("does not render the shell for public auth routes", () => {
    const harness = makeHarness({ user: ADMIN, path: "/register" });

    expect(harness.vm.showShell).toBe(false);

    harness.vm.guard();

    expect(harness.router.path).toBe("/register");
  });

  it("does not render the shell for password reset routes", () => {
    const forgot = makeHarness({ user: ADMIN, path: "/forgot-password" });
    const reset = makeHarness({ user: ADMIN, path: "/reset-password" });

    expect(forgot.vm.showShell).toBe(false);
    expect(reset.vm.showShell).toBe(false);
  });

  it("moves an authenticated user away from the login page", () => {
    const harness = makeHarness({ user: ADMIN, path: "/login" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/");
  });

  it("redirects a non-admin from an admin-only route to the dashboard", () => {
    const harness = makeHarness({ user: PLAIN, path: "/users" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/");
  });

  it("keeps a non-admin on a route they may access", () => {
    const harness = makeHarness({ user: PLAIN, path: "/clients" });

    harness.vm.guard();

    expect(harness.router.path).toBe("/clients");
  });

  it("does not guard while the application is still booting", () => {
    const harness = makeHarness({ user: null, path: "/nodes" });
    harness.vm.booting = true;

    harness.vm.guard();

    expect(harness.router.path).toBe("/nodes");
  });

  it("boots and guards after session initialization", async () => {
    const harness = makeHarness({ user: null, path: "/nodes" });
    harness.vm.booting = true;

    await harness.vm.created();

    expect(harness.vm.booting).toBe(false);
    expect(harness.router.path).toBe("/login");
  });
});

describe("AppVM navigation filtering", () => {
  it("shows every management section to an admin", () => {
    const harness = makeHarness({ user: ADMIN });

    expect(harness.vm.nav.map((item) => item.path)).toEqual([
      "/",
      "/nodes",
      "/interfaces",
      "/groups",
      "/clients",
      "/import",
    ]);
    expect(harness.vm.accountNav.map((item) => item.path)).toEqual([
      "/tariffs",
      "/users",
      "/audit",
      "/stats",
      "/settings",
      "/profile",
    ]);
    expect(harness.vm.roleLabel).toBe("Администратор");
  });

  it("переводит пункты меню и роль при смене языка", () => {
    const harness = makeHarness({ user: ADMIN });

    setLocale("en");

    expect(harness.vm.nav.map((item) => item.title)).toEqual([
      "Overview",
      "Nodes",
      "Interfaces",
      "Groups",
      "Clients",
      "Import",
    ]);
    expect(harness.vm.accountNav.map((item) => item.title)).toContain("Settings");
    expect(harness.vm.mobileNav.map((item) => item.title)).toContain("Statistics");
    expect(harness.vm.roleLabel).toBe("Administrator");
    expect(harness.vm.title).toBe("Overview");

    setLocale("ru");

    expect(harness.vm.nav[0]?.title).toBe("Обзор");
    expect(harness.vm.roleLabel).toBe("Администратор");
  });

  it("скрывает админские разделы у обычного пользователя", () => {
    const harness = makeHarness({ user: PLAIN });

    expect(harness.vm.nav.map((item) => item.path)).toEqual(["/", "/interfaces", "/clients"]);
    expect(harness.vm.accountNav.map((item) => item.path)).toEqual(["/stats", "/profile"]);
    expect(harness.vm.mobileNav.map((item) => item.path)).not.toContain("/nodes");
    expect(harness.vm.roleLabel).toBe("Пользователь");
  });

  it("exposes the current user and initials", () => {
    const harness = makeHarness({ user: ADMIN });

    expect(harness.vm.name).toBe("admin");
    expect(harness.vm.userInitial).toBe("A");
    expect(harness.vm.user).toEqual(ADMIN);
  });

  it("falls back to a guest identity without a session", () => {
    const harness = makeHarness({ user: null });

    expect(harness.vm.name).toBe("Гость");
  });
});

describe("AppVM route state", () => {
  it("derives the title, params and shell visibility from the router", () => {
    const harness = makeHarness({ user: ADMIN, path: "/clients/42" });

    expect(harness.vm.routeName).toBe("client");
    expect(harness.vm.params).toEqual({ id: "42" });
    expect(harness.vm.title).toBe("Устройство");
    expect(harness.vm.showShell).toBe(true);
  });

  it("переводит заголовок маршрута", () => {
    const harness = makeHarness({ user: ADMIN, path: "/clients/42" });

    expect(harness.vm.title).toBe("Устройство");

    setLocale("en");

    expect(harness.vm.title).toBe("Device");

    setLocale("ru");
  });

  it("скрывает shell на маршруте входа", () => {
    const harness = makeHarness({ user: null, path: "/login" });

    expect(harness.vm.showShell).toBe(false);
  });

  it("marks the active route and its nested paths", () => {
    const harness = makeHarness({ user: ADMIN, path: "/clients/42" });

    expect(harness.vm.isActive("/clients")).toBe(true);
    expect(harness.vm.isActive("/nodes")).toBe(false);
    expect(harness.vm.isActive("/")).toBe(false);
  });

  it("renders the not-found route standalone for a guest", () => {
    const harness = makeHarness({ user: null, path: "/missing/page" });

    expect(harness.vm.routeName).toBe("not-found");
    expect(harness.vm.title).toBe("Раздел не найден");
    expect(harness.vm.path).toBe("/missing/page");
    expect(harness.vm.showShell).toBe(false);

    harness.vm.dispose();
  });

  it("renders the not-found route inside the shell for an authenticated user", () => {
    const harness = makeHarness({ user: ADMIN, path: "/missing/page" });

    expect(harness.vm.routeName).toBe("not-found");
    expect(harness.vm.showShell).toBe(true);

    harness.vm.dispose();
  });
});

describe("AppVM connection state", () => {
  it("switches the banner between offline and restored", () => {
    const harness = makeHarness({ user: ADMIN });

    expect(harness.vm.connectionNotice).toBeNull();

    window.dispatchEvent(new Event("offline"));
    expect(harness.vm.online).toBe(false);
    expect(harness.vm.connectionNotice).toBe("offline");

    window.dispatchEvent(new Event("online"));
    expect(harness.vm.online).toBe(true);
    expect(harness.vm.connectionNotice).toBe("restored");

    harness.vm.dispose();
  });
});

describe("AppVM actions", () => {
  it("navigates and closes the more sheet", () => {
    const harness = makeHarness({ user: ADMIN });
    harness.vm.openMore();

    harness.vm.go("/interfaces");

    expect(harness.router.path).toBe("/interfaces");
    expect(harness.vm.moreOpen).toBe(false);
  });

  it("opens and closes the more sheet", () => {
    const harness = makeHarness({ user: ADMIN });

    expect(harness.vm.moreOpen).toBe(false);
    harness.vm.openMore();
    expect(harness.vm.moreOpen).toBe(true);
    harness.vm.closeMore();
    expect(harness.vm.moreOpen).toBe(false);
  });

  it("keeps extra sections in the more sheet", () => {
    const harness = makeHarness({ user: ADMIN });

    expect(harness.vm.mobileNav.map((item) => item.path)).toEqual([
      "/",
      "/clients",
      "/interfaces",
      "/stats",
    ]);
    expect(harness.vm.moreManagementNav.map((item) => item.path)).toEqual([
      "/nodes",
      "/groups",
      "/import",
    ]);
    expect(harness.vm.moreAccountNav.map((item) => item.path)).toContain("/settings");
  });

  it("logs out, clears tokens and returns to the login page", async () => {
    const harness = makeHarness({ user: ADMIN });
    harness.tokens.set("access-1", "refresh-1");

    await harness.vm.logout();

    expect(harness.session.user).toBeNull();
    expect(harness.session.authenticated).toBe(false);
    expect(harness.tokens.access()).toBeNull();
    expect(harness.tokens.refresh()).toBeNull();
    expect(harness.router.path).toBe("/login");
  });

  it("applies and toggles the theme", () => {
    const harness = makeHarness({ user: ADMIN });

    harness.vm.setTheme("dark");

    expect(harness.vm.themeMode).toBe("dark");
    expect(harness.vm.themeEffective).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    harness.vm.toggleTheme();

    expect(harness.vm.themeMode).toBe("light");
    expect(harness.vm.themeEffective).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("exposes the injected toast store to the template", () => {
    const harness = makeHarness({ user: ADMIN });

    expect(harness.vm.toasts).toBe(harness.toasts);

    harness.vm.toasts.success("Готово");

    expect(harness.vm.toasts.items.map((item) => item.message)).toContain("Готово");

    const id = harness.vm.toasts.items[0]?.id;
    if (id === undefined) throw new Error("Уведомление не создано");
    harness.vm.toasts.dismiss(id);
    expect(harness.vm.toasts.items).toHaveLength(0);
  });
});

let mountedApp: AppProbeVM | null = null;
let mountedChild: ChildProbeVM | null = null;

class ChildProbeVM {
  constructor(
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {}

  get authenticated(): boolean {
    return this.session.authenticated;
  }

  get routeName(): string {
    return this.router.match.route.name;
  }

  get sessionRef(): Session {
    return this.session;
  }

  get routerRef(): Router {
    return this.router;
  }

  notify(message: string): void {
    this.toasts.success(message);
  }
}

function ChildProbe(this: { vm: ChildProbeVM }): Node {
  mountedChild = this.vm;
  return document.createElement("div");
}

class AppProbeVM extends AppVM {
  constructor(session: Session, router: Router, theme: ThemeStore, toastStore: ToastStore) {
    super(session, router, theme, toastStore);
  }
}

function AppProbe(this: { vm: AppProbeVM }): Node {
  mountedApp = this.vm;
  const child = createComponent(ChildProbe, {}, getRuntimeOptions());
  return child.node;
}

describe("AppVM constructor DI", () => {
  it("shares one Session, Router and ToastStore with nested view models", async () => {
    const session = makeSession(ADMIN);
    const router = new Router();
    const theme = new ThemeStore();
    const toasts = new ToastStore();
    const container = createAppContainer();
    container.bind(Session, () => session);
    container.bind(Router, () => router);
    container.bind(ThemeStore, () => theme);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(AppProbe, {}, { container });
    await result.ready;
    await whenIdle();

    const app = mountedApp;
    const child = mountedChild;
    if (app === null || child === null) throw new Error("ViewModel не был смонтирован");
    expect(app).toBeInstanceOf(AppProbeVM);
    expect(child).toBeInstanceOf(ChildProbeVM);

    expect(await container.resolve<Session>(Session)).toBe(session);
    expect(child.sessionRef).toBe(session);
    expect(child.routerRef).toBe(router);
    expect(child.authenticated).toBe(true);

    session.user = null;
    expect(app.authenticated).toBe(false);
    expect(child.authenticated).toBe(false);

    session.user = ADMIN;
    router.navigate("/clients");
    expect(app.routeName).toBe("clients");
    expect(child.routeName).toBe("clients");

    child.notify("Из дочернего VM");
    expect(app.toasts.items.map((item) => item.message)).toContain("Из дочернего VM");

    result.dispose();
  });

  it("guards admin-only navigation through the shared reactive router", async () => {
    const session = makeSession(PLAIN);
    const router = new Router();
    const container = createAppContainer();
    container.bind(Session, () => session);
    container.bind(Router, () => router);
    container.bind(ThemeStore, () => new ThemeStore());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(AppProbe, {}, { container });
    await result.ready;
    await whenIdle();

    router.navigate("/users");
    await Promise.resolve();

    expect(router.path).toBe("/");
    expect(mountedApp?.routeName).toBe("overview");

    result.dispose();
  });

  it("shares the bootstrap singleton graph with every child scope", async () => {
    const appContainer = await import("@/app/container");
    const container = createAppContainer();
    appContainer.bindAppServices(container);
    const scope = container.createScope("probe");

    const session = await container.resolve<Session>(Session);
    const router = await container.resolve<Router>(Router);
    const toasts = await container.resolve<ToastStore>(ToastStore);
    const liveStats = await container.resolve<LiveStats>(LiveStats);
    const users = await container.resolve<DefaultUsersService>(DefaultUsersService);

    expect(await scope.resolve<Session>(Session)).toBe(session);
    expect(await scope.resolve<Router>(Router)).toBe(router);
    expect(await scope.resolve<ToastStore>(ToastStore)).toBe(toasts);
    expect(await scope.resolve<LiveStats>(LiveStats)).toBe(liveStats);
    expect(await scope.resolve<DefaultUsersService>(DefaultUsersService)).toBe(users);
    expect(await container.resolve<Session>(Session)).toBe(session);
  });
});

describe("AppVM prefetch", () => {
  beforeEach(() => {
    prefetchModule.prefetchPath.mockClear();
    prefetchModule.scheduleIdlePrefetch.mockReset();
    prefetchModule.scheduleIdlePrefetch.mockImplementation(() => () => undefined);
  });

  it("plans idle prefetch for likely routes after boot", async () => {
    const harness = makeHarness({ user: ADMIN, path: "/" });
    harness.vm.booting = true;

    await harness.vm.created();

    expect(prefetchModule.scheduleIdlePrefetch).toHaveBeenCalledTimes(1);
    expect(prefetchModule.scheduleIdlePrefetch).toHaveBeenCalledWith({ routes: ["/clients", "/stats"] });
    harness.vm.dispose();
  });

  it("excludes the current route from idle prefetch", async () => {
    const harness = makeHarness({ user: ADMIN, path: "/clients" });
    harness.vm.booting = true;

    await harness.vm.created();

    expect(prefetchModule.scheduleIdlePrefetch).toHaveBeenCalledWith({ routes: ["/stats"] });
    harness.vm.dispose();
  });

  it("does not plan idle prefetch for guests on public pages", async () => {
    const harness = makeHarness({ user: null, path: "/login" });
    harness.vm.booting = true;

    await harness.vm.created();

    expect(prefetchModule.scheduleIdlePrefetch).not.toHaveBeenCalled();
  });

  it("does not plan idle prefetch on authenticated public pages", async () => {
    const harness = makeHarness({ user: ADMIN, path: "/register" });
    harness.vm.booting = true;

    await harness.vm.created();

    expect(prefetchModule.scheduleIdlePrefetch).not.toHaveBeenCalled();
    harness.vm.dispose();
  });

  it("cancels the planned idle prefetch on dispose", async () => {
    const cancel = vi.fn();
    prefetchModule.scheduleIdlePrefetch.mockReturnValue(cancel);
    const harness = makeHarness({ user: ADMIN, path: "/" });
    harness.vm.booting = true;

    await harness.vm.created();
    harness.vm.dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("forwards navigation hover and focus to the prefetch module", () => {
    const harness = makeHarness({ user: ADMIN, path: "/" });

    harness.vm.prefetch("/stats");
    harness.vm.prefetch("/stats");

    expect(prefetchModule.prefetchPath).toHaveBeenCalledTimes(2);
    expect(prefetchModule.prefetchPath).toHaveBeenCalledWith("/stats");
  });
});
