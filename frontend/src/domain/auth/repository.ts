import type { AuthSession, User } from "../types";
import type {
  LoginInput,
  RegisterInput,
  RegisterResult,
  TotpSetup,
  TotpToggleResult,
  VerifyEmailResult,
} from "./types";

export interface AuthRepository {
  login(input: LoginInput): Promise<AuthSession>;
  register(input: RegisterInput): Promise<RegisterResult>;
  verifyEmail(token: string): Promise<VerifyEmailResult>;
  resendVerification(email: string): Promise<void>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;
  totpSetup(): Promise<TotpSetup>;
  totpEnable(code: string): Promise<TotpToggleResult>;
  totpDisable(password: string, code: string): Promise<TotpToggleResult>;
}
