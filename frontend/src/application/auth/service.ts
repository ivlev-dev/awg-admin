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
import { ValidationError } from "../errors";
import {
  requireId,
  requireText,
  validateEmail,
  validatePassword,
  validateTotpCode,
} from "../guards";

export interface AuthService {
  login(input: LoginInput): Promise<AuthSession>;
  register(input: RegisterInput): Promise<RegisterResult>;
  verifyEmail(token: string): Promise<VerifyEmailResult>;
  resendVerification(email: string): Promise<void>;
  forgotPassword(email: string): Promise<ForgotPasswordResult>;
  resetPassword(token: string, password: string): Promise<ResetPasswordResult>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string | null): Promise<void>;
  me(): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;
  totpSetup(): Promise<TotpSetup>;
  totpEnable(code: string): Promise<TotpToggleResult>;
  totpDisable(password: string, code: string): Promise<TotpToggleResult>;
  sessions(): Promise<AuthSessionInfo[]>;
  revokeSession(jti: string): Promise<void>;
  logoutAll(): Promise<LogoutAllResult>;
}

export class DefaultAuthService implements AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async login(input: LoginInput): Promise<AuthSession> {
    const code = input.totp_code?.trim();
    return this.repository.login({
      login: requireText(input.login, "Логин"),
      password: requireText(input.password, "Пароль"),
      ...(code ? { totp_code: code } : {}),
    });
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const login = input.login?.trim();
    return this.repository.register({
      email: validateEmail(input.email),
      password: validatePassword(input.password),
      ...(login ? { login } : {}),
    });
  }

  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    return this.repository.verifyEmail(requireText(token, "Токен подтверждения"));
  }

  async resendVerification(email: string): Promise<void> {
    await this.repository.resendVerification(validateEmail(email));
  }

  async forgotPassword(email: string): Promise<ForgotPasswordResult> {
    return this.repository.forgotPassword(validateEmail(email));
  }

  async resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
    return this.repository.resetPassword(
      requireText(token, "Токен сброса пароля"),
      validatePassword(password),
    );
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    return this.repository.refresh(requireText(refreshToken, "Refresh-токен"));
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return;
    await this.repository.logout(refreshToken);
  }

  me(): Promise<User> {
    return this.repository.me();
  }

  async changePassword(current: string | null, next: string): Promise<void> {
    if (current !== null && !current.trim()) {
      throw new ValidationError("Текущий пароль обязателен");
    }
    await this.repository.changePassword(current, validatePassword(next));
  }

  totpSetup(): Promise<TotpSetup> {
    return this.repository.totpSetup();
  }

  async totpEnable(code: string): Promise<TotpToggleResult> {
    return this.repository.totpEnable(validateTotpCode(code));
  }

  async totpDisable(password: string, code: string): Promise<TotpToggleResult> {
    return this.repository.totpDisable(
      requireText(password, "Пароль"),
      validateTotpCode(code),
    );
  }

  sessions(): Promise<AuthSessionInfo[]> {
    return this.repository.sessions();
  }

  async revokeSession(jti: string): Promise<void> {
    await this.repository.revokeSession(requireId(jti, "Сессия"));
  }

  logoutAll(): Promise<LogoutAllResult> {
    return this.repository.logoutAll();
  }
}
