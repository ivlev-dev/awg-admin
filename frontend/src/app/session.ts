import { reactive } from "@ivlev-dev/silent-core";

import type { AuthSessionState } from "../application/auth/session-state";
import type { AuthRepository } from "../domain/auth/repository";
import type { User } from "@/domain/types";
import type { TokenStore } from "../infrastructure/storage";

export class Session implements AuthSessionState {
  @reactive accessor user: User | null = null;
  @reactive accessor ready = false;
  @reactive accessor busy = false;
  @reactive accessor error: string | null = null;

  constructor(
    private readonly auth: AuthRepository,
    private readonly tokens: TokenStore,
  ) {
    if (import.meta.env.MODE !== "test") {
      const shared = (globalThis as { __awgSession?: Session }).__awgSession;
      if (shared) return shared;
      (globalThis as { __awgSession?: Session }).__awgSession = this;
    }
  }

  clear(): void {
    this.tokens.clear();
    this.user = null;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    if (!this.tokens.access()) {
      this.ready = true;
      return;
    }
    try {
      this.user = await this.auth.me();
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
      const session = await this.auth.login({ login, password });
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
        await this.auth.logout(refresh);
      } catch {
        // Token is cleared locally even when the server is unreachable.
      }
    }
    this.tokens.clear();
    this.user = null;
  }

  async reload(): Promise<void> {
    try {
      this.user = await this.auth.me();
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
