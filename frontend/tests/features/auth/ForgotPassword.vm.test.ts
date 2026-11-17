import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import { ForgotPasswordVM } from "@/features/auth/ForgotPassword.vm";

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
  vm: ForgotPasswordVM;
  router: Router;
  forgotPassword: ReturnType<typeof vi.fn>;
}

function makeHarness(
  handler: (email: string) => Promise<void> = async () => undefined,
): Harness {
  const forgotPassword = vi.fn(async (email: string) => {
    await handler(email);
    return { status: "sent" as const };
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
    forgotPassword,
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
  const router = new Router();
  router.navigate("/forgot-password");
  return {
    vm: new ForgotPasswordVM(new DefaultAuthService(auth), router),
    router,
    forgotPassword,
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
  window.history.replaceState(null, "", "/");
});

describe("ForgotPasswordVM", () => {
  it("rejects an invalid email without calling the service", async () => {
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("nope"));

    expect(harness.vm.emailValid).toBe(false);
    expect(harness.vm.canSubmit).toBe(false);

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Введите корректный email");
    expect(harness.forgotPassword).not.toHaveBeenCalled();
  });

  it("sends the link with a trimmed email and starts the cooldown", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent(" user@example.com "));

    await harness.vm.submit(submitEvent());

    expect(harness.forgotPassword).toHaveBeenCalledWith("user@example.com");
    expect(harness.vm.sent).toBe(true);
    expect(harness.vm.cooldown).toBe(60);
    expect(harness.vm.canResend).toBe(false);
  });

  it("counts down the cooldown and resends the link", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    harness.vm.setEmail(valueEvent("user@example.com"));
    await harness.vm.submit(submitEvent());

    vi.advanceTimersByTime(59_000);
    expect(harness.vm.cooldown).toBe(1);
    expect(harness.vm.canResend).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(harness.vm.cooldown).toBe(0);
    expect(harness.vm.canResend).toBe(true);

    await harness.vm.resend();

    expect(harness.forgotPassword).toHaveBeenCalledTimes(2);
    expect(harness.vm.cooldown).toBe(60);
  });

  it("reports a send failure and keeps the form", async () => {
    const harness = makeHarness(async () => {
      throw new Error("Сервис недоступен");
    });
    harness.vm.setEmail(valueEvent("user@example.com"));

    await harness.vm.submit(submitEvent());

    expect(harness.vm.error).toBe("Сервис недоступен");
    expect(harness.vm.sent).toBe(false);
    expect(harness.vm.cooldown).toBe(0);
  });

  it("reports a resend failure on the success screen", async () => {
    const harness = makeHarness(async () => {
      throw new Error("Слишком часто");
    });
    harness.vm.email = "user@example.com";
    harness.vm.sent = true;

    await harness.vm.resend();

    expect(harness.vm.resendError).toBe("Слишком часто");
  });

  it("navigates back to the login page", () => {
    const harness = makeHarness();

    harness.vm.goLogin();

    expect(harness.router.path).toBe("/login");
  });

  it("resolves through the container", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<ForgotPasswordVM>(ForgotPasswordVM);

    expect(vm).toBeInstanceOf(ForgotPasswordVM);
    expect(await container.resolve(ForgotPasswordVM)).toBe(vm);
  });
});
