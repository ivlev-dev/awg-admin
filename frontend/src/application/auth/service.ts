import type { AuthRepository } from "../../domain/auth/repository";
import type { LoginInput } from "@/domain/auth/types";
import type { AuthSession, User } from "@/domain/types";
import { ValidationError } from "../errors";
import { requireText, validatePassword } from "../guards";

export interface AuthService {
  login(input: LoginInput): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string | null): Promise<void>;
  me(): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;
}

export class DefaultAuthService implements AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async login(input: LoginInput): Promise<AuthSession> {
    return this.repository.login({
      login: requireText(input.login, "Логин"),
      password: requireText(input.password, "Пароль"),
    });
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
}
