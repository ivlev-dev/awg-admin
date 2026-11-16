import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import type { AuthRepository } from "@/domain/auth/repository";
import type { LoginInput } from "@/domain/auth/types";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import type { Mock } from "vitest";
import { LoginVM } from "./Login.vm";

const USER: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
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
  vm: LoginVM;
  session: Session;
  router: Router;
  tokens: MemoryTokenStore;
  login: Mock<(input: LoginInput) => Promise<AuthSession>>;
}

function makeHarness(
  handler: (input: LoginInput) => Promise<AuthSession> = async () => SESSION,
): Harness {
  const tokens = new MemoryTokenStore();
  const login = vi.fn(async (input: LoginInput): Promise<AuthSession> => {
    const result = await handler(input);
    tokens.set(result.token, result.refresh_token);
    return result;
  });
  const auth: AuthRepository = {
    login,
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
  };
  const session = new Session(auth, tokens);
  const router = new Router();
  router.navigate("/login");
  return { vm: new LoginVM(session, router), session, router, tokens, login };
}

function valueEvent(value: string): Event {
  const event = new Event("input");
  Object.defineProperty(event, "target", { value: { value } });
  return event;
}

function submitEvent(): Event {
  return new Event("submit", { cancelable: true });
}

describe("LoginVM", () => {
  it("logs in with trimmed credentials, stores tokens and navigates to the dashboard", async () => {
    const harness = makeHarness();
    harness.vm.setLogin(valueEvent(" admin "));
    harness.vm.setPassword(valueEvent("secret"));

    expect(harness.vm.canSubmit).toBe(true);
    await harness.vm.submit(submitEvent());

    expect(harness.login).toHaveBeenCalledWith({ login: "admin", password: "secret" });
    expect(harness.session.user).toEqual(USER);
    expect(harness.session.authenticated).toBe(true);
    expect(harness.tokens.access()).toBe("access-1");
    expect(harness.tokens.refresh()).toBe("refresh-1");
    expect(harness.router.path).toBe("/");
    expect(harness.session.error).toBeNull();
    expect(harness.session.busy).toBe(false);
  });

  it("reports a login error and stays on the login page", async () => {
    const harness = makeHarness(async () => {
      throw new Error("Неверный логин или пароль");
    });
    harness.vm.login = "admin";
    harness.vm.password = "wrong";

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Неверный логин или пароль");
    expect(harness.session.user).toBeNull();
    expect(harness.tokens.access()).toBeNull();
    expect(harness.router.path).toBe("/login");
    expect(harness.vm.busy).toBe(false);
  });

  it("falls back to a generic message for a non-Error failure", async () => {
    const harness = makeHarness(async () => {
      throw "unreachable";
    });
    harness.vm.login = "admin";
    harness.vm.password = "secret";

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Не удалось войти");
  });

  it("blocks submission while the credentials are empty", async () => {
    const harness = makeHarness();
    harness.vm.login = "   ";
    harness.vm.password = "secret";
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());
    expect(harness.login).not.toHaveBeenCalled();

    harness.vm.login = "admin";
    harness.vm.password = "";
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());
    expect(harness.login).not.toHaveBeenCalled();
    expect(harness.router.path).toBe("/login");
  });

  it("exposes the busy state while the login request is pending", async () => {
    let release: (value: AuthSession) => void = () => undefined;
    const pending = new Promise<AuthSession>((resolve) => {
      release = resolve;
    });
    const harness = makeHarness(async () => pending);
    harness.vm.login = "admin";
    harness.vm.password = "secret";

    const submission = harness.vm.submit(submitEvent());

    expect(harness.vm.busy).toBe(true);
    expect(harness.vm.canSubmit).toBe(false);

    release(SESSION);
    await submission;

    expect(harness.vm.busy).toBe(false);
    expect(harness.router.path).toBe("/");
  });

  it("redirects an already authenticated user on creation", () => {
    const harness = makeHarness();
    harness.session.user = USER;

    harness.vm.created();

    expect(harness.router.path).toBe("/");
  });

  it("keeps an anonymous user on the login page on creation", () => {
    const harness = makeHarness();
    harness.vm.created();

    expect(harness.router.path).toBe("/login");
  });

  it("toggles password visibility", () => {
    const harness = makeHarness();
    expect(harness.vm.showPassword).toBe(false);

    harness.vm.togglePassword();
    expect(harness.vm.showPassword).toBe(true);

    harness.vm.togglePassword();
    expect(harness.vm.showPassword).toBe(false);
  });

  it("resolves constructor dependencies through the container", async () => {
    const harness = makeHarness();
    const container = createAppContainer();
    container.bind(Session, () => harness.session);
    container.bind(Router, () => harness.router);

    const vm = await container.resolve<LoginVM>(LoginVM);

    expect(vm).toBeInstanceOf(LoginVM);
    expect(await container.resolve(LoginVM)).toBe(vm);
    expect(vm.busy).toBe(harness.session.busy);
  });

  it("auto-wires the session and router without explicit bindings", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<LoginVM>(LoginVM);

    expect(vm).toBeInstanceOf(LoginVM);
    expect(vm.canSubmit).toBe(false);
    expect(vm.error).toBeNull();
  });
});
