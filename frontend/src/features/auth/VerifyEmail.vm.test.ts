import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import { VerifyEmailVM } from "./VerifyEmail.vm";

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

function makeHarness(
  verify: (token: string) => Promise<void> = async () => undefined,
  search = "?token=verify-token",
): { vm: VerifyEmailVM; router: Router; verifyEmail: ReturnType<typeof vi.fn> } {
  const verifyEmail = vi.fn(async (token: string) => {
    await verify(token);
    return { status: "pending_approval" as const };
  });
  const auth: AuthRepository = {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail,
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
  window.history.replaceState(null, "", `/verify-email${search}`);
  const router = new Router();
  return {
    vm: new VerifyEmailVM(new DefaultAuthService(auth), router),
    router,
    verifyEmail,
  };
}

describe("VerifyEmailVM", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("verifies the token from the query string and shows the approval message", async () => {
    const harness = makeHarness();

    expect(harness.vm.token).toBe("verify-token");
    expect(harness.vm.status).toBe("loading");

    harness.vm.created();
    await vi.waitFor(() => expect(harness.vm.status).toBe("success"));

    expect(harness.verifyEmail).toHaveBeenCalledWith("verify-token");
    expect(harness.vm.error).toBeNull();
  });

  it("reports a missing token as an error", async () => {
    const harness = makeHarness(undefined, "");

    await harness.vm.verify();

    expect(harness.vm.status).toBe("error");
    expect(harness.vm.error).toBe("В ссылке нет токена подтверждения.");
    expect(harness.verifyEmail).not.toHaveBeenCalled();
  });

  it("reports a verification failure", async () => {
    const harness = makeHarness(async () => {
      throw new Error("Ссылка устарела");
    });

    await harness.vm.verify();

    expect(harness.vm.status).toBe("error");
    expect(harness.vm.error).toBe("Ссылка устарела");
  });

  it("does not verify twice", async () => {
    const harness = makeHarness();
    harness.vm.created();
    await harness.vm.verify();

    expect(harness.verifyEmail).toHaveBeenCalledTimes(1);
  });

  it("navigates to the login page", () => {
    const harness = makeHarness();

    harness.vm.goLogin();

    expect(harness.router.path).toBe("/login");
  });

  it("resolves through the container", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<VerifyEmailVM>(VerifyEmailVM);

    expect(vm).toBeInstanceOf(VerifyEmailVM);
    expect(await container.resolve(VerifyEmailVM)).toBe(vm);
  });
});
