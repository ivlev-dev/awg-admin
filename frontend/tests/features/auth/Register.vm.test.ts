import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import { ApiError } from "@/domain/errors";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";
import { RegisterVM } from "@/features/auth/Register.vm";

const USER: User = {
  id: "u1",
  full_name: null,
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

interface Harness {
  vm: RegisterVM;
  router: Router;
  session: Session;
  register: ReturnType<typeof vi.fn>;
  resendVerification: ReturnType<typeof vi.fn>;
}

function makeHarness(
  handlers: {
    register?: (input: { email: string; full_name?: string; password: string }) => Promise<void>;
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
    updateProfile: vi.fn(async () => USER),
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
    expect(harness.vm.error).toBe("Пароль должен содержать минимум 10 символов");

    harness.vm.setPassword(valueEvent("secret1234"));
    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Пароли не совпадают");
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("requires a password of at least 10 characters", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("123456789"));
    harness.vm.setRepeatPassword(valueEvent("123456789"));

    expect(harness.vm.passwordTooShort).toBe(true);
    expect(harness.vm.canSubmit).toBe(false);
    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Пароль должен содержать минимум 10 символов");
    expect(harness.register).not.toHaveBeenCalled();

    harness.vm.setPassword(valueEvent("abcdefghij"));
    harness.vm.setRepeatPassword(valueEvent("abcdefghij"));

    expect(harness.vm.passwordTooShort).toBe(false);
    expect(harness.vm.canSubmit).toBe(true);
  });

  it("rejects a password that equals the email local part", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("VeryLongLocal@example.com"));
    harness.vm.setPassword(valueEvent("verylonglocal"));
    harness.vm.setRepeatPassword(valueEvent("verylonglocal"));

    expect(harness.vm.canSubmit).toBe(false);
    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Пароль не должен совпадать с частью email до @");
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("rejects common passwords", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("letmein123"));
    harness.vm.setRepeatPassword(valueEvent("letmein123"));

    expect(harness.vm.canSubmit).toBe(false);
    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Пароль слишком простой. Используйте более сложный пароль.");
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("registers without a full name and shows the email confirmation screen", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent(" user@example.com "));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));

    expect(harness.vm.canSubmit).toBe(true);
    await harness.vm.submit(submitEvent());

    expect(harness.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret1234",
    });
    expect(harness.vm.sent).toBe(true);
    expect(harness.vm.registeredEmail).toBe("user@example.com");
    expect(harness.vm.cooldown).toBe(60);
    expect(harness.vm.resendNotice).toBeNull();
  });

  it("sends a trimmed full name when it is provided", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setFullName(valueEvent("  Иван Петров  "));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));
    await harness.vm.submit(submitEvent());

    expect(harness.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret1234",
      full_name: "Иван Петров",
    });
  });

  it("rejects a full name longer than 200 characters", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setFullName(valueEvent("a".repeat(201)));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));

    expect(harness.vm.fullNameTooLong).toBe(true);
    expect(harness.vm.canSubmit).toBe(false);
    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("ФИО должно быть не длиннее 200 символов");
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("останавливает таймер обратного отсчёта при размонтировании", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness();
      harness.vm.setEmail(valueEvent("user@example.com"));
      harness.vm.setPassword(valueEvent("secret1234"));
      harness.vm.setRepeatPassword(valueEvent("secret1234"));
      await harness.vm.submit(submitEvent());

      harness.vm.unmounted();
      vi.advanceTimersByTime(1000);

      expect(harness.vm.cooldown).toBe(60);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a dedicated message when registration is disabled", async () => {
    const harness = makeHarness({
      register: async () => {
        throw new ApiError(403, "registration_disabled", "registration is disabled");
      },
    });
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Саморегистрация отключена. Обратитесь к администратору.");
    expect(harness.vm.sent).toBe(false);
    expect(harness.vm.password).toBe("secret1234");
  });

  it("does not reveal that an email is already registered", async () => {
    const harness = makeHarness({
      register: async () => {
        throw new ApiError(400, "bad_request", "email is already registered");
      },
    });
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Не удалось создать аккаунт");
    expect(harness.vm.sent).toBe(false);
  });

  it("treats an existing email as a pending confirmation (202)", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("existing@example.com"));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.sent).toBe(true);
    expect(harness.vm.error).toBeNull();
    expect(harness.vm.registeredEmail).toBe("existing@example.com");
  });

  it("maps a weak password rejection from the server", async () => {
    const harness = makeHarness({
      register: async () => {
        throw new ApiError(400, "bad_request", "password is too weak: at least 10 characters required");
      },
    });
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Пароль слишком простой. Используйте более сложный пароль.");
    expect(harness.vm.sent).toBe(false);
  });

  it("counts down the resend cooldown and sends the email again", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));
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
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));
    await harness.vm.submit(submitEvent());
    harness.vm.cooldown = 0;

    await harness.vm.resend();

    expect(harness.vm.resendError).toBe("Слишком часто");
  });

  it("returns to the form to change the address", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    harness.vm.setPassword(valueEvent("secret1234"));
    harness.vm.setRepeatPassword(valueEvent("secret1234"));
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
