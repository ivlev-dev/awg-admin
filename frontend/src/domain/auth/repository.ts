import type { AuthSession, User } from "../types";
import type { LoginInput } from "./types";

export interface AuthRepository {
  login(input: LoginInput): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;
}
