import type { AuthRepository } from "../../domain/auth/repository";
import type { LoginInput } from "../../domain/auth/types";
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
