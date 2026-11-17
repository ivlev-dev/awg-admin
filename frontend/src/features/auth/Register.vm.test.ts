import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { RegisterVM } from "./Register.vm";

const USER: User = {
  id: "u1",
  login: "admin",
  email: "admin@example.com",
  status: "active",
  totp_enabled: false,
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
  vm: RegisterVM;
  router: Router;
  session: Session;
  register: ReturnType<typeof vi.fn>;
  resendVerification: ReturnType<typeof vi.fn>;
}

function makeHarness(
  handlers: {
    register?: (input: { email: string; login?: string; password: string }) => Promise<void>;
    resend?: (email: string) => Promise<void>;
  } = {},
): Harness {
  const register = vi.fn(handlers.register ?? (async () => undefined));
  const resendVerification = vi.fn(handlers.resend ?? (async () => undefined));
  const auth: AuthRepository = {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async (input) => {
      await register(input);
      return { status: "pending_email" as const };
    }),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification,
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
  const session = new Session(auth, new MemoryTokenStore());
  const router = new Router();
  router.navigate("/register");
  return {
    vm: new RegisterVM(new DefaultAuthService(auth), session, router),
    router,
    session,
    register,
    resendVerification,
  };
}

function valueEvent(value: string): Event {
  const event = new Event("input");
  Object.defineProperty(event, "target", { value: { value } });
  return event;
}

function submitEvent(): Event {
  return new Event("submit", { cancelable: true });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RegisterVM", () => {
  it("validates the email, password length and confirmation", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("nope"));
    harness.vm.setPassword(valueEvent("short"));
    harness.vm.setRepeatPassword(valueEvent("other"));

    expect(harness.vm.emailValid).toBe(false);
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Введите корректный email");

    harness.vm.setEmail(valueEvent("user@example.com"));
    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Пароль должен содержать минимум 8 символов");

    harness.vm.setPassword(valueEvent("secret123"));
    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Пароли не совпадают");
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("registers with an optional login and shows the email confirmation screen", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent(" user@example.com "));
    harness.vm.setLogin(valueEvent(" user "));
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    expect(harness.vm.canSubmit).toBe(true);
    await harness.vm.submit(submitEvent());

    expect(harness.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
      login: "user",
    });
    expect(harness.vm.sent).toBe(true);
    expect(harness.vm.registeredEmail).toBe("user@example.com");
    expect(harness.vm.cooldown).toBe(60);
    expect(harness.vm.resendNotice).toBeNull();
  });

  it("omits an empty login on registration", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    await harness.vm.submit(submitEvent());

    expect(harness.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
    });
  });

  it("reports a registration failure and keeps the form", async () => {
    const harness = makeHarness({
      register: async () => {
        throw new Error("Email уже занят");
      },
    });
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Email уже занят");
    expect(harness.vm.sent).toBe(false);
    expect(harness.vm.password).toBe("secret123");
  });

  it("counts down the resend cooldown and sends the email again", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));
    await harness.vm.submit(submitEvent());

    expect(harness.vm.canResend).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(harness.vm.cooldown).toBe(59);
    vi.advanceTimersByTime(59_000);
    expect(harness.vm.cooldown).toBe(0);
    expect(harness.vm.canResend).toBe(true);

    await harness.vm.resend();

    expect(harness.resendVerification).toHaveBeenCalledWith("user@example.com");
    expect(harness.vm.resendNotice).toBe("Письмо отправлено повторно");
    expect(harness.vm.cooldown).toBe(60);
  });

  it("reports a resend failure", async () => {
    const harness = makeHarness({
      resend: async () => {
        throw new Error("Слишком часто");
      },
    });
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));
    await harness.vm.submit(submitEvent());
    harness.vm.cooldown = 0;

    await harness.vm.resend();

    expect(harness.vm.resendError).toBe("Слишком часто");
  });

  it("returns to the form to change the address", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));
    await harness.vm.submit(submitEvent());

    harness.vm.editEmail();

    expect(harness.vm.sent).toBe(false);
    expect(harness.vm.cooldown).toBe(0);
    expect(harness.vm.resendNotice).toBeNull();
  });

  it("navigates to the login page", () => {
    const harness = makeHarness();

    harness.vm.goLogin();

    expect(harness.router.path).toBe("/login");
  });

  it("redirects an authenticated user on creation", () => {
    const harness = makeHarness();
    harness.session.user = USER;

    harness.vm.created();

    expect(harness.router.path).toBe("/");
  });

  it("resolves through the container", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<RegisterVM>(RegisterVM);

    expect(vm).toBeInstanceOf(RegisterVM);
    expect(await container.resolve(RegisterVM)).toBe(vm);
  });
});
