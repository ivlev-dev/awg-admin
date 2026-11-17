import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import { setLocale } from "@/i18n";
import { ForgotPassword } from "@/features/auth/ForgotPassword";
import { ForgotPasswordVM } from "@/features/auth/ForgotPassword.vm";
import { ResetPassword } from "@/features/auth/ResetPassword";
import { ResetPasswordVM } from "@/features/auth/ResetPassword.vm";

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

function authRepository(): AuthRepository {
  return {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
}

function routerAt(path: string): Router {
  window.history.replaceState(null, "", path);
  return new Router();
}

function submitEvent(): Event {
  return new Event("submit", { cancelable: true });
}

afterEach(() => {
  setLocale("ru");
  window.history.replaceState(null, "", "/");
});

describe("ForgotPassword view", () => {
  it("renders the email form and switches the language", async () => {
    const router = routerAt("/forgot-password");
    const container = createAppContainer();
    container.bind(Router, () => router);
    const result = createComponent(ForgotPassword, {}, { container });
    await result.ready;

    expect(result.node.textContent).toContain("Забыли пароль?");
    expect(result.node.textContent).toContain("Отправить ссылку");

    setLocale("en");

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Forgot password?");
      expect(result.node.textContent).toContain("Send link");
    });

    result.dispose();
  });

  it("renders the success screen after sending the link", async () => {
    const router = routerAt("/forgot-password");
    const vm = new ForgotPasswordVM(new DefaultAuthService(authRepository()), router);
    const container = createAppContainer();
    container.bind(Router, () => router);
    container.bind(ForgotPasswordVM, () => vm);
    const result = createComponent(ForgotPassword, {}, { container });
    await result.ready;

    vm.email = "user@example.com";
    await vm.submit(submitEvent());

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Письмо отправлено");
      expect(result.node.textContent).toContain("Если аккаунт существует, письмо отправлено.");
      expect(result.node.textContent).toContain("Повторно через 60 с");
      expect(result.node.textContent).toContain("Назад ко входу");
    });

    result.dispose();
  });
});

describe("ResetPassword view", () => {
  it("renders the new password form", async () => {
    const router = routerAt("/reset-password?token=reset-token");
    const container = createAppContainer();
    container.bind(Router, () => router);
    const result = createComponent(ResetPassword, {}, { container });
    await result.ready;

    expect(result.node.textContent).toContain("Новый пароль");
    expect(result.node.textContent).toContain("Повторите пароль");
    expect(result.node.textContent).toContain("Сохранить пароль");
    expect(result.node.textContent).not.toContain("токена сброса пароля");

    result.dispose();
  });

  it("renders the success screen after saving the password", async () => {
    const router = routerAt("/reset-password?token=reset-token");
    const vm = new ResetPasswordVM(new DefaultAuthService(authRepository()), router);
    const container = createAppContainer();
    container.bind(Router, () => router);
    container.bind(ResetPasswordVM, () => vm);
    const result = createComponent(ResetPassword, {}, { container });
    await result.ready;

    vm.password = "secret123";
    vm.repeatPassword = "secret123";
    await vm.submit(submitEvent());

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Пароль изменён");
      expect(result.node.textContent).toContain("Войдите заново");
      expect(result.node.textContent).toContain("Перейти ко входу");
    });

    result.dispose();
  });

  it("renders the invalid-token screen without a token", async () => {
    const router = routerAt("/reset-password");
    const container = createAppContainer();
    container.bind(Router, () => router);
    const result = createComponent(ResetPassword, {}, { container });
    await result.ready;

    expect(result.node.textContent).toContain("В ссылке нет токена сброса пароля.");
    expect(result.node.textContent).toContain("Запросить новую ссылку");

    result.dispose();
  });
});
