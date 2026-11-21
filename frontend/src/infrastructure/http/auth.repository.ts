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
  UpdateProfileInput,
  VerifyEmailResult,
} from "@/domain/auth/types";
import type { AuthSession, User } from "@/domain/types";
import { tokenGeneration, type TokenStore } from "../storage";
import { ApiError } from "./errors";
import type { HttpTransport } from "./transport";

export class HttpAuthRepository implements AuthRepository {
  private refreshPromise: Promise<AuthSession> | null = null;

  constructor(
    private readonly transport: HttpTransport,
    private readonly tokens: TokenStore,
  ) {}

  async login(input: LoginInput): Promise<AuthSession> {
    const session = await this.publicRequest(() =>
      this.transport.post<AuthSession>("/auth/login", input, { source: "auth" }),
    );
    this.tokens.set(session.token, session.refresh_token);
    return session;
  }

  register(input: RegisterInput): Promise<RegisterResult> {
    return this.publicRequest(() =>
      this.transport.post<RegisterResult>("/auth/register", input, { source: "auth" }),
    );
  }

  verifyEmail(token: string): Promise<VerifyEmailResult> {
    return this.publicRequest(() =>
      this.transport.post<VerifyEmailResult>("/auth/verify-email", { token }, { source: "auth" }),
    );
  }

  async resendVerification(email: string): Promise<void> {
    await this.publicRequest(() =>
      this.transport.post<void>("/auth/resend-verification", { email }, { source: "auth" }),
    );
  }

  forgotPassword(email: string): Promise<ForgotPasswordResult> {
    return this.publicRequest(() =>
      this.transport.post<ForgotPasswordResult>(
        "/auth/forgot-password",
        { email },
        { source: "auth" },
      ),
    );
  }

  resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
    return this.publicRequest(() =>
      this.transport.post<ResetPasswordResult>(
        "/auth/reset-password",
        { token, password },
        { source: "auth" },
      ),
    );
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    if (this.refreshPromise !== null) return this.refreshPromise;
    const generation = tokenGeneration(this.tokens);
    const pending = this.transport
      .post<AuthSession>(
        "/auth/refresh",
        { refresh_token: refreshToken },
        { source: "auth" },
      )
      .then((session) => {
        if (tokenGeneration(this.tokens) === generation) {
          this.tokens.set(session.token, session.refresh_token);
        }
        return session;
      })
      .finally(() => {
        if (this.refreshPromise === pending) this.refreshPromise = null;
      });
    this.refreshPromise = pending;
    return pending;
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await this.publicRequest(() =>
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
    return this.authed(() =>
      this.transport.get<User>("/auth/me", {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  updateProfile(input: UpdateProfileInput): Promise<User> {
    return this.authed(() =>
      this.transport.patch<User>("/auth/me", input, {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  changePassword(current: string | null, next: string): Promise<void> {
    return this.authed(() =>
      this.transport.post<void>(
        "/auth/password",
        { current_password: current, new_password: next },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  totpSetup(password: string): Promise<TotpSetup> {
    return this.authed(() =>
      this.transport.post<TotpSetup>(
        "/auth/totp/setup",
        { password },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  totpEnable(password: string, code: string): Promise<TotpToggleResult> {
    return this.authed(() =>
      this.transport.post<TotpToggleResult>(
        "/auth/totp/enable",
        { password, code },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  totpDisable(password: string, code: string): Promise<TotpToggleResult> {
    return this.authed(() =>
      this.transport.post<TotpToggleResult>(
        "/auth/totp/disable",
        { password, code },
        { source: "auth", headers: this.authHeaders() },
      ),
    );
  }

  sessions(): Promise<AuthSessionInfo[]> {
    return this.authed(() =>
      this.transport.get<AuthSessionInfo[]>("/auth/sessions", {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  async revokeSession(jti: string): Promise<void> {
    await this.authed(() =>
      this.transport.delete<void>(`/auth/sessions/${encodeURIComponent(jti)}`, {
        source: "auth",
        headers: this.authHeaders(),
      }),
    );
  }

  logoutAll(): Promise<LogoutAllResult> {
    return this.authed(() =>
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

  private async authed<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      const refreshed = await this.tryRefresh();
      if (!refreshed) {
        this.tokens.clear();
        throw error;
      }
    }

    try {
      return await run();
    } catch (error) {
      if (isUnauthorized(error)) this.tokens.clear();
      throw error;
    }
  }

  private async tryRefresh(): Promise<boolean> {
    const refreshToken = this.tokens.refresh();
    if (!refreshToken) return false;
    try {
      await this.refresh(refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private async publicRequest<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUnauthorized(error)) this.tokens.clear();
      throw error;
    }
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
