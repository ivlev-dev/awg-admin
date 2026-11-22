import { createComponent, flushSync } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { DefaultAuthService } from "@/application/auth/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSession, User } from "@/domain/types";
import { Login } from "@/features/auth/Login";
import { LoginVM } from "@/features/auth/Login.vm";
import { Register } from "@/features/auth/Register";
import { RegisterVM } from "@/features/auth/Register.vm";
import { setLocale } from "@/i18n";

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

function authRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => USER),
    updateProfile: vi.fn(async () => USER),
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
    ...overrides,
  };
}

function typeInto(node: ParentNode, selector: string, value: string): void {
  const input = node.querySelector<HTMLInputElement>(selector);
  if (input === null) throw new Error(`input not found: ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function submitForm(node: ParentNode): void {
  const form = node.querySelector("form");
  if (form === null) throw new Error("form not found");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  flushSync();
}

afterEach(() => {
  setLocale("ru");
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

describe("Login view", () => {
  it("renders validation errors, aria-invalid and submits valid credentials", async () => {
    const repository = authRepository();
    const router = new Router();
    router.navigate("/login");
    const session = new Session(repository, new MemoryTokenStore());
    const vm = new LoginVM(session, router, new DefaultAuthService(repository));
    const container = createAppContainer();
    container.bind(Router, () => router);
    container.bind(LoginVM, () => vm);
    const result = createComponent(Login, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);
    flushSync();

    const email = document.querySelector<HTMLInputElement>("#email");
    const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(email).not.toBeNull();
    expect(submit?.disabled).toBe(true);

    typeInto(document, "#email", "nope");
    submitForm(document);

    await vi.waitFor(() => {
      expect(email?.classList.contains("is-invalid")).toBe(true);
      expect(email?.getAttribute("aria-invalid")).toBe("true");
      expect(document.body.textContent).toContain("Введите корректный email");
    });
    expect(submit?.disabled).toBe(true);
    expect(repository.login).not.toHaveBeenCalled();

    typeInto(document, "#email", "admin@example.com");
    typeInto(document, "#password", "secret");
    await vi.waitFor(() => {
      expect(submit?.disabled).toBe(false);
    });

    submitForm(document);

    await vi.waitFor(() => {
      expect(repository.login).toHaveBeenCalledWith({
        email: "admin@example.com",
        password: "secret",
      });
      expect(router.path).toBe("/");
    });

    result.dispose();
  });

  it("renders the TOTP step with its own field", async () => {
    const repository = authRepository({
      login: vi.fn(async () => {
        throw new Error("totp");
      }),
    });
    const router = new Router();
    router.navigate("/login");
    const session = new Session(repository, new MemoryTokenStore());
    const vm = new LoginVM(session, router, new DefaultAuthService(repository));
    const container = createAppContainer();
    container.bind(Router, () => router);
    container.bind(LoginVM, () => vm);
    const result = createComponent(Login, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);
    flushSync();

    vm.form.getFieldProps("email").setValue("admin@example.com");
    vm.form.getFieldProps("password").setValue("secret");
    vm.form.totpRequired = true;
    vm.step = "totp";
    flushSync();

    await vi.waitFor(() => {
      expect(document.querySelector("#totp")).not.toBeNull();
      expect(document.querySelector("#email")).toBeNull();
      expect(document.body.textContent).toContain("Двухфакторная аутентификация");
    });

    result.dispose();
  });
});

describe("Register view", () => {
  it("renders field errors and submits a valid registration", async () => {
    const repository = authRepository();
    const router = new Router();
    router.navigate("/register");
    const session = new Session(repository, new MemoryTokenStore());
    const vm = new RegisterVM(new DefaultAuthService(repository), session, router);
    const container = createAppContainer();
    container.bind(Router, () => router);
    container.bind(RegisterVM, () => vm);
    const result = createComponent(Register, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);
    flushSync();

    typeInto(document, "#register-email", "nope");
    typeInto(document, "#register-password", "letmein123");
    typeInto(document, "#register-repeat", "letmein123");
    submitForm(document);

    await vi.waitFor(() => {
      const email = document.querySelector("#register-email");
      const password = document.querySelector("#register-password");
      expect(email?.classList.contains("is-invalid")).toBe(true);
      expect(email?.getAttribute("aria-invalid")).toBe("true");
      expect(password?.classList.contains("is-invalid")).toBe(true);
      expect(document.body.textContent).toContain("Введите корректный email");
      expect(document.body.textContent).toContain(
        "Пароль слишком простой. Используйте более сложный пароль.",
      );
    });
    expect(repository.register).not.toHaveBeenCalled();

    typeInto(document, "#register-email", "user@example.com");
    typeInto(document, "#register-password", "secret1234");
    typeInto(document, "#register-repeat", "secret1234");

    await vi.waitFor(() => {
      const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(submit?.disabled).toBe(false);
    });

    submitForm(document);

    await vi.waitFor(() => {
      expect(repository.register).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret1234",
      });
      expect(document.body.textContent).toContain("Проверьте почту");
    });

    result.dispose();
  });
});
