import type { AuthRepository } from "@/domain/auth/repository";
import type {
  AuthSessionInfo,
  ForgotPasswordResult,
  LoginInput,
  LogoutAllResult,
  RegisterInput,
  RegisterResult,
  ResetPasswordResult,
  TotpSetup,
  TotpToggleResult,
  VerifyEmailResult,
} from "@/domain/auth/types";
import type { AuthSession, User } from "@/domain/types";
import type { TokenStore } from "../storage";
import { ApiError } from "./errors";
import type { HttpTransport } from "./transport";

export class HttpAuthRepository implements AuthRepository {
  constructor(
    private readonly transport: HttpTransport,
    private readonly tokens: TokenStore,
  ) {}

  async login(input: LoginInput): Promise<AuthSession> {
    const session = await this.request(() =>
      this.transport.post<AuthSession>("/auth/login", input, { source: "auth" }),
    );
    this.tokens.set(session.token, session.refresh_token);
    return session;
  }

  register(input: RegisterInput): Promise<RegisterResult> {
    return this.request(() =>
      this.transport.post<RegisterResult>("/auth/register", input, { source: "auth" }),
    );
  }

  verifyEmail(token: string): Promise<VerifyEmailResult> {
    return this.request(() =>
      this.transport.post<VerifyEmailResult>("/auth/verify-email", { token }, { source: "auth" }),
    );
  }

  async resendVerification(email: string): Promise<void> {
    await this.request(() =>
      this.transport.post<void>("/auth/resend-verification", { email }, { source: "auth" }),
    );
  }

  forgotPassword(email: string): Promise<ForgotPasswordResult> {
    return this.request(() =>
      this.transport.post<ForgotPasswordResult>(
        "/auth/forgot-password",
        { email },
        { source: "auth" },
      ),
    );
  }

  resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
    return this.request(() =>
      this.transport.post<ResetPasswordResult>(
        "/auth/reset-password",
        { token, password },
        { source: "auth" },
      ),
    );
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const session = await this.request(() =>
      this.transport.post<AuthSession>(
        "/auth/refresh",
        { refresh_token: refreshToken },
        { source: "auth" },
      ),
    );
    this.tokens.set(session.token, session.refresh_token);
    return session;
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await this.request(() =>
        this.transport.post<void>(
          "/auth/logout",
          { refresh_token: refreshToken },
          { source: "auth" },
        ),
      );
    } finally {
      this.tokens.clear();
    }
  }

  me(): Promise<User> {
    return this.request(() =>
      this.transport.get<User>("/auth/me", {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  changePassword(current: string | null, next: string): Promise<void> {
    return this.request(() =>
      this.transport.post<void>(
        "/auth/password",
        { current_password: current, new_password: next },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  totpSetup(): Promise<TotpSetup> {
    return this.request(() =>
      this.transport.post<TotpSetup>("/auth/totp/setup", undefined, {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  totpEnable(code: string): Promise<TotpToggleResult> {
    return this.request(() =>
      this.transport.post<TotpToggleResult>(
        "/auth/totp/enable",
        { code },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  totpDisable(password: string, code: string): Promise<TotpToggleResult> {
    return this.request(() =>
      this.transport.post<TotpToggleResult>(
        "/auth/totp/disable",
        { password, code },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  sessions(): Promise<AuthSessionInfo[]> {
    return this.request(() =>
      this.transport.get<AuthSessionInfo[]>("/auth/sessions", {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  async revokeSession(jti: string): Promise<void> {
    await this.request(() =>
      this.transport.delete<void>(`/auth/sessions/${encodeURIComponent(jti)}`, {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  logoutAll(): Promise<LogoutAllResult> {
    return this.request(() =>
      this.transport.post<LogoutAllResult>("/auth/logout-all", undefined, {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  private authHeaders(): Record<string, string> {
    const token = this.tokens.access();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async request<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.tokens.clear();
      }
      throw error;
    }
  }
}
