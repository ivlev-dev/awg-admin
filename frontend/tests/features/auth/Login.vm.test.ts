import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { LoginInput } from "@/domain/auth/types";
import type { AuthSession, User } from "@/domain/types";
import { ApiError } from "@/infrastructure/http/errors";
import type { TokenStore } from "@/infrastructure/storage";
import type { Mock } from "vitest";
import { LoginVM } from "@/features/auth/Login.vm";

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
  vm: LoginVM;
  session: Session;
  router: Router;
  tokens: MemoryTokenStore;
  login: Mock<(input: LoginInput) => Promise<AuthSession>>;
  resendVerification: Mock<(email: string) => Promise<void>>;
}

function makeHarness(
  handler: (input: LoginInput) => Promise<AuthSession> = async () => SESSION,
  resend: (email: string) => Promise<void> = async () => undefined,
): Harness {
  const tokens = new MemoryTokenStore();
  const login = vi.fn(async (input: LoginInput): Promise<AuthSession> => {
    const result = await handler(input);
    tokens.set(result.token, result.refresh_token);
    return result;
  });
  const resendVerification = vi.fn(resend);
  const auth: AuthRepository = {
    login,
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    updateProfile: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
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
  const session = new Session(auth, tokens);
  const router = new Router();
  router.navigate("/login");
  return {
    vm: new LoginVM(session, router, new DefaultAuthService(auth)),
    session,
    router,
    tokens,
    login,
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

describe("LoginVM", () => {
  it("logs in with trimmed credentials, stores tokens and navigates to the dashboard", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent(" admin@example.com "));
    harness.vm.setPassword(valueEvent("secret"));

    expect(harness.vm.canSubmit).toBe(true);
    await harness.vm.submit(submitEvent());

    expect(harness.login).toHaveBeenCalledWith({ email: "admin@example.com", password: "secret" });
    expect(harness.login.mock.calls[0]?.[0]).not.toHaveProperty("login");
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
    harness.vm.email = "admin@example.com";
    harness.vm.password = "wrong";

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Неверный логин или пароль");
    expect(harness.session.user).toBeNull();
    expect(harness.tokens.access()).toBeNull();
    expect(harness.router.path).toBe("/login");
    expect(harness.vm.busy).toBe(false);
  });

  it("switches to the TOTP step when the server requires a second factor", async () => {
    const harness = makeHarness(async (input) => {
      if (!input.totp_code) {
        throw new ApiError(401, "totp_required", "totp required");
      }
      return SESSION;
    });
    harness.vm.email = "admin@example.com";
    harness.vm.password = "secret";

    await harness.vm.submit(submitEvent());

    expect(harness.vm.step).toBe("totp");
    expect(harness.vm.error).toBeNull();
    expect(harness.router.path).toBe("/login");

    harness.vm.setTotpCode(valueEvent("123456"));
    expect(harness.vm.canSubmit).toBe(true);

    await harness.vm.submit(submitEvent());

    expect(harness.login).toHaveBeenLastCalledWith({
      email: "admin@example.com",
      password: "secret",
      totp_code: "123456",
    });
    expect(harness.session.user).toEqual(USER);
    expect(harness.router.path).toBe("/");
  });

  it("accepts a recovery code on the TOTP step", async () => {
    const harness = makeHarness(async (input) => {
      if (!input.totp_code) throw new ApiError(401, "totp_required", "totp required");
      return SESSION;
    });
    harness.vm.email = "admin@example.com";
    harness.vm.password = "secret";
    await harness.vm.submit(submitEvent());

    harness.vm.setTotpCode(valueEvent("abcd-1234"));
    await harness.vm.submit(submitEvent());

    expect(harness.login).toHaveBeenLastCalledWith({
      email: "admin@example.com",
      password: "secret",
      totp_code: "abcd-1234",
    });
    expect(harness.router.path).toBe("/");
  });

  it("shows an error for an invalid TOTP code", async () => {
    const harness = makeHarness(async (input) => {
      if (!input.totp_code) throw new ApiError(401, "totp_required", "totp required");
      throw new ApiError(401, "totp_invalid", "invalid code");
    });
    harness.vm.email = "admin@example.com";
    harness.vm.password = "secret";
    await harness.vm.submit(submitEvent());

    harness.vm.setTotpCode(valueEvent("000000"));
    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Неверный код двухфакторной аутентификации.");
    expect(harness.vm.step).toBe("totp");
    expect(harness.router.path).toBe("/login");
  });

  it("returns to the credentials step and clears the code", async () => {
    const harness = makeHarness(async () => {
      throw new ApiError(401, "totp_required", "totp required");
    });
    harness.vm.email = "admin@example.com";
    harness.vm.password = "secret";
    await harness.vm.submit(submitEvent());
    harness.vm.setTotpCode(valueEvent("123456"));

    harness.vm.backToCredentials();

    expect(harness.vm.step).toBe("credentials");
    expect(harness.vm.totpCode).toBe("");
    expect(harness.vm.error).toBeNull();
  });

  it("maps approval and rejection errors to readable messages", async () => {
    const pending = makeHarness(async () => {
      throw new ApiError(403, "pending_approval", "pending");
    });
    pending.vm.email = "admin@example.com";
    pending.vm.password = "secret";
    await pending.vm.submit(submitEvent());
    expect(pending.vm.error).toBe("Заявка ожидает подтверждения администратором.");

    const rejected = makeHarness(async () => {
      throw new ApiError(403, "rejected", "rejected");
    });
    rejected.vm.email = "admin@example.com";
    rejected.vm.password = "secret";
    await rejected.vm.submit(submitEvent());
    expect(rejected.vm.error).toBe("Заявка отклонена администратором. Обратитесь в поддержку.");
  });

  it("offers to resend the verification email for an unverified address", async () => {
    const harness = makeHarness(async () => {
      throw new ApiError(403, "email_not_verified", "verify email");
    });
    harness.vm.email = " user@example.com ";
    harness.vm.password = "secret";
    await harness.vm.submit(submitEvent());

    expect(harness.vm.showResend).toBe(true);
    expect(harness.vm.error).toBe("Почта не подтверждена. Проверьте письмо и подтвердите адрес.");

    await harness.vm.resend();

    expect(harness.resendVerification).toHaveBeenCalledWith("user@example.com");
    expect(harness.vm.resendNotice).toBe("Письмо отправлено повторно.");
    expect(harness.vm.resending).toBe(false);
  });

  it("reports a resend failure", async () => {
    const harness = makeHarness(
      async () => {
        throw new ApiError(403, "email_not_verified", "verify email");
      },
      async () => {
        throw new Error("Слишком часто");
      },
    );
    harness.vm.email = "user@example.com";
    harness.vm.password = "secret";
    await harness.vm.submit(submitEvent());

    await harness.vm.resend();

    expect(harness.vm.resendError).toBe("Слишком часто");
  });

  it("falls back to a generic message for a non-Error failure", async () => {
    const harness = makeHarness(async () => {
      throw "unreachable";
    });
    harness.vm.email = "admin@example.com";
    harness.vm.password = "secret";

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Не удалось войти");
  });

  it("requires an email address instead of a login", async () => {
    const harness = makeHarness();
    harness.vm.email = "admin";
    harness.vm.password = "secret";

    expect(harness.vm.emailValid).toBe(false);
    expect(harness.vm.emailInvalid).toBe(true);
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());
    expect(harness.login).not.toHaveBeenCalled();
  });

  it("blocks submission while the credentials are empty", async () => {
    const harness = makeHarness();
    harness.vm.email = "   ";
    harness.vm.password = "secret";
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());
    expect(harness.login).not.toHaveBeenCalled();

    harness.vm.email = "admin@example.com";
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
    harness.vm.email = "admin@example.com";
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

  it("navigates to the registration page", () => {
    const harness = makeHarness();

    harness.vm.goRegister();

    expect(harness.router.path).toBe("/register");
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
