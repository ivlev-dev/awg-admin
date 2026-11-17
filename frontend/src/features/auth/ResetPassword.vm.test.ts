import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import { ApiError } from "@/infrastructure/http/errors";
import { ResetPasswordVM } from "./ResetPassword.vm";

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

interface Harness {
  vm: ResetPasswordVM;
  router: Router;
  resetPassword: ReturnType<typeof vi.fn>;
}

function makeHarness(
  handler: (token: string, password: string) => Promise<void> = async () => undefined,
  search = "?token=reset-token",
): Harness {
  const resetPassword = vi.fn(async (token: string, password: string) => {
    await handler(token, password);
    return { status: "reset" as const };
  });
  const auth: AuthRepository = {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword,
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
  window.history.replaceState(null, "", `/reset-password${search}`);
  const router = new Router();
  return {
    vm: new ResetPasswordVM(new DefaultAuthService(auth), router),
    router,
    resetPassword,
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
  window.history.replaceState(null, "", "/");
});

describe("ResetPasswordVM", () => {
  it("reads the token from the query string", () => {
    const harness = makeHarness();

    expect(harness.vm.token).toBe("reset-token");
    expect(harness.vm.status).toBe("form");
  });

  it("shows an invalid screen without a token", async () => {
    const harness = makeHarness(undefined, "");

    harness.vm.created();
    await harness.vm.submit(submitEvent());

    expect(harness.vm.status).toBe("invalid");
    expect(harness.vm.error).toBe("В ссылке нет токена сброса пароля.");
    expect(harness.resetPassword).not.toHaveBeenCalled();
  });

  it("validates the password length and confirmation", async () => {
    const harness = makeHarness();
    harness.vm.setPassword(valueEvent("short"));

    expect(harness.vm.passwordTooShort).toBe(true);
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Пароль должен содержать минимум 8 символов");

    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("other123"));
    expect(harness.vm.repeatMismatch).toBe(true);

    await harness.vm.submit(submitEvent());
    expect(harness.vm.error).toBe("Пароли не совпадают");
    expect(harness.resetPassword).not.toHaveBeenCalled();
  });

  it("resets the password and clears the form", async () => {
    const harness = makeHarness();
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    expect(harness.vm.canSubmit).toBe(true);
    await harness.vm.submit(submitEvent());

    expect(harness.resetPassword).toHaveBeenCalledWith("reset-token", "secret123");
    expect(harness.vm.status).toBe("success");
    expect(harness.vm.password).toBe("");
    expect(harness.vm.repeatPassword).toBe("");
  });

  it("shows an invalid screen for an invalid token", async () => {
    const harness = makeHarness(async () => {
      throw new ApiError(400, "invalid_token", "invalid token");
    });
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.status).toBe("invalid");
    expect(harness.vm.error).toBe("Ссылка недействительна или устарела. Запросите новую.");
  });

  it("shows an invalid screen for an expired token", async () => {
    const harness = makeHarness(async () => {
      throw new ApiError(400, "token_expired", "expired");
    });
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.status).toBe("invalid");
    expect(harness.vm.error).toBe("Ссылка недействительна или устарела. Запросите новую.");
  });

  it("keeps the form on a generic failure", async () => {
    const harness = makeHarness(async () => {
      throw new Error("Сервис недоступен");
    });
    harness.vm.setPassword(valueEvent("secret123"));
    harness.vm.setRepeatPassword(valueEvent("secret123"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.status).toBe("form");
    expect(harness.vm.error).toBe("Сервис недоступен");
  });

  it("navigates to login and to the forgot-password page", () => {
    const harness = makeHarness();

    harness.vm.goForgotPassword();
    expect(harness.router.path).toBe("/forgot-password");

    harness.vm.goLogin();
    expect(harness.router.path).toBe("/login");
  });

  it("resolves through the container", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<ResetPasswordVM>(ResetPasswordVM);

    expect(vm).toBeInstanceOf(ResetPasswordVM);
    expect(await container.resolve(ResetPasswordVM)).toBe(vm);
  });
});
