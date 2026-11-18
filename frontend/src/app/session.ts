import { reactive } from "@ivlev-dev/silent-core";

import type { AuthSessionState } from "@/application/auth/session-state";
import type { AuthRepository } from "@/domain/auth/repository";
import type { User } from "@/domain/types";
import { ApiError } from "@/infrastructure/http/errors";
import type { TokenStore } from "@/infrastructure/storage";

const LOGOUT_TIMEOUT_MS = 1500;

export class Session implements AuthSessionState {
  @reactive accessor user: User | null = null;
  @reactive accessor ready = false;
  @reactive accessor busy = false;
  @reactive accessor loggingOut = false;
  @reactive accessor error: string | null = null;
  @reactive accessor errorCode: string | null = null;
  @reactive accessor totpRequired = false;

  constructor(
    private readonly auth: AuthRepository,
    private readonly tokens: TokenStore,
  ) {
  }

  clear(): void {
    this.tokens.clear();
    this.user = null;
  }

  clearError(): void {
    this.error = null;
    this.errorCode = null;
    this.totpRequired = false;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    const access = this.tokens.access();
    const refresh = this.tokens.refresh();
    if (!access && !refresh) {
      this.ready = true;
      return;
    }
    try {
      if (!access && refresh) await this.auth.refresh(refresh);
      this.user = await this.auth.me();
    } catch {
      this.tokens.clear();
      this.user = null;
    } finally {
      this.ready = true;
    }
  }

  async login(login: string, password: string, totpCode?: string): Promise<boolean> {
    this.busy = true;
    this.clearError();
    try {
      const session = await this.auth.login({
        login,
        password,
        ...(totpCode ? { totp_code: totpCode } : {}),
      });
      this.user = session.user;
      this.clearError();
      return true;
    } catch (error) {
      this.errorCode = error instanceof ApiError ? error.code : null;
      this.totpRequired = this.errorCode === "totp_required";
      this.error = error instanceof Error ? error.message : "Не удалось войти";
      return false;
    } finally {
      this.busy = false;
    }
  }

  async logout(): Promise<void> {
    if (this.loggingOut) return;
    const refresh = this.tokens.refresh();
    this.loggingOut = true;
    this.tokens.clear();
    this.user = null;
    try {
      if (refresh) await withTimeout(this.auth.logout(refresh), LOGOUT_TIMEOUT_MS);
    } catch {
      // Локальная сессия уже очищена, сетевой logout — best effort.
    } finally {
      this.loggingOut = false;
    }
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
