import { reactive } from "@ivlev-dev/silent-core";

import type { User } from "@/domain/types";
import type { HttpApi } from "@/infrastructure/http";
import type { LocalTokenStore } from "@/infrastructure/storage";

export class Session {
  @reactive accessor user: User | null = null;
  @reactive accessor ready = false;
  @reactive accessor busy = false;
  @reactive accessor error: string | null = null;

  constructor(
    private readonly api: HttpApi,
    private readonly tokens: LocalTokenStore,
  ) {}

  async init(): Promise<void> {
    if (!this.tokens.access()) {
      this.ready = true;
      return;
    }
    try {
      this.user = await this.api.me();
    } catch {
      this.tokens.clear();
      this.user = null;
    } finally {
      this.ready = true;
    }
  }

  async login(login: string, password: string): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      const session = await this.api.login({ login, password });
      this.user = session.user;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Не удалось войти";
      return false;
    } finally {
      this.busy = false;
    }
  }

  async logout(): Promise<void> {
    const refresh = this.tokens.refresh();
    if (refresh) {
      try {
        await this.api.logout(refresh);
      } catch {
        // Token is cleared locally even when the server is unreachable.
      }
    }
    this.tokens.clear();
    this.user = null;
  }

  async reload(): Promise<void> {
    try {
      this.user = await this.api.me();
    } catch {
      this.user = null;
    }
  }

  get isAdmin(): boolean {
    return this.user?.role === "admin";
  }

  get authenticated(): boolean {
    return this.user !== null;
  }
}
