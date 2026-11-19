import type { AuthSession, User } from "../types";
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
} from "./types";

export interface AuthRepository {
  login(input: LoginInput): Promise<AuthSession>;
  register(input: RegisterInput): Promise<RegisterResult>;
  verifyEmail(token: string): Promise<VerifyEmailResult>;
  resendVerification(email: string): Promise<void>;
  forgotPassword(email: string): Promise<ForgotPasswordResult>;
  resetPassword(token: string, password: string): Promise<ResetPasswordResult>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<User>;
  updateProfile(input: UpdateProfileInput): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;
  totpSetup(): Promise<TotpSetup>;
  totpEnable(code: string): Promise<TotpToggleResult>;
  totpDisable(password: string, code: string): Promise<TotpToggleResult>;
  sessions(): Promise<AuthSessionInfo[]>;
  revokeSession(jti: string): Promise<void>;
  logoutAll(): Promise<LogoutAllResult>;
}
