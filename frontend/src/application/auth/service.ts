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
import { ValidationError } from "../errors";
import {
  requireId,
  requireText,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePasswordForEmail,
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
  updateProfile(input: UpdateProfileInput): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;
  totpSetup(password: string): Promise<TotpSetup>;
  totpEnable(password: string, code: string): Promise<TotpToggleResult>;
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
      email: validateEmail(input.email),
      password: requireText(input.password, "error.label.password"),
      ...(code ? { totp_code: code } : {}),
    });
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = validateEmail(input.email);
    const fullName = input.full_name?.trim();
    return this.repository.register({
      email,
      password: validatePasswordForEmail(input.password, email),
      ...(fullName ? { full_name: validateFullName(fullName) } : {}),
    });
  }

  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    return this.repository.verifyEmail(requireText(token, "error.label.verifyToken"));
  }

  async resendVerification(email: string): Promise<void> {
    await this.repository.resendVerification(validateEmail(email));
  }

  async forgotPassword(email: string): Promise<ForgotPasswordResult> {
    return this.repository.forgotPassword(validateEmail(email));
  }

  async resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
    return this.repository.resetPassword(
      requireText(token, "error.label.resetToken"),
      validatePassword(password),
    );
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    return this.repository.refresh(requireText(refreshToken, "error.label.refreshToken"));
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return;
    await this.repository.logout(refreshToken);
  }

  me(): Promise<User> {
    return this.repository.me();
  }

  async updateProfile(input: UpdateProfileInput): Promise<User> {
    const trimmed = input.full_name?.trim() ?? "";
    const fullName = trimmed.length === 0 ? null : validateFullName(trimmed);
    return this.repository.updateProfile({ full_name: fullName });
  }

  async changePassword(current: string | null, next: string): Promise<void> {
    if (current !== null && !current.trim()) {
      throw new ValidationError("error.validation.authCurrentPassword");
    }
    await this.repository.changePassword(current, validatePassword(next));
  }

  async totpSetup(password: string): Promise<TotpSetup> {
    return this.repository.totpSetup(requireText(password, "error.label.password"));
  }

  async totpEnable(password: string, code: string): Promise<TotpToggleResult> {
    return this.repository.totpEnable(
      requireText(password, "error.label.password"),
      validateTotpCode(code),
    );
  }

  async totpDisable(password: string, code: string): Promise<TotpToggleResult> {
    return this.repository.totpDisable(
      requireText(password, "error.label.password"),
      validateTotpCode(code),
    );
  }

  sessions(): Promise<AuthSessionInfo[]> {
    return this.repository.sessions();
  }

  async revokeSession(jti: string): Promise<void> {
    await this.repository.revokeSession(requireId(jti, "error.label.session"));
  }

  logoutAll(): Promise<LogoutAllResult> {
    return this.repository.logoutAll();
  }
}
