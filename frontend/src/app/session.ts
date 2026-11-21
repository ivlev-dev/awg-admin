import { reactive } from "@ivlev-dev/silent-core";

import type { AuthSessionState } from "@/application/auth/session-state";
import type { AuthRepository } from "@/domain/auth/repository";
import type { User } from "@/domain/types";
import { ApiError } from "@/domain/errors";
import type { TokenStore } from "@/infrastructure/storage";
import { t } from "@/i18n";

const LOGOUT_TIMEOUT_MS = 1500;

const ACCOUNT_BLOCK_CODES: ReadonlySet<string> = new Set([
  "pending_approval",
  "rejected",
  "account_disabled",
]);

function shouldClearTokens(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401) return true;
  return error.status === 403 && ACCOUNT_BLOCK_CODES.has(error.code);
}

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
    this.error = null;
    this.errorCode = null;
    try {
      if (!access && refresh) await this.auth.refresh(refresh);
      this.user = await this.auth.me();
    } catch (error) {
      this.user = null;
      if (shouldClearTokens(error)) {
        this.tokens.clear();
        this.errorCode = error instanceof ApiError ? error.code : null;
        this.error = accountBlockMessage(error);
      } else {
        this.errorCode = error instanceof ApiError ? error.code : null;
        this.error = bootErrorMessage(error);
      }
    } finally {
      this.ready = true;
    }
  }

  async login(email: string, password: string, totpCode?: string): Promise<boolean> {
    this.busy = true;
    this.clearError();
    try {
      const session = await this.auth.login({
        email,
        password,
        ...(totpCode ? { totp_code: totpCode } : {}),
      });
      this.user = session.user;
      this.clearError();
      return true;
    } catch (error) {
      this.errorCode = error instanceof ApiError ? error.code : null;
      this.totpRequired = this.errorCode === "totp_required";
      this.error = error instanceof Error ? error.message : t("auth.login.error.failed");
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
      this.error = null;
      this.errorCode = null;
    } catch (error) {
      if (shouldClearTokens(error)) {
        this.tokens.clear();
        this.user = null;
        this.error = accountBlockMessage(error);
        this.errorCode = error instanceof ApiError ? error.code : null;
        return;
      }
      this.errorCode = error instanceof ApiError ? error.code : null;
      this.error = bootErrorMessage(error);
    }
  }

  get isAdmin(): boolean {
    return this.user?.role === "admin";
  }

  get authenticated(): boolean {
    return this.user !== null;
  }
}

function bootErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === "network_error") {
    return t("app.error.network");
  }
  return t("app.error.unknown");
}

function accountBlockMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  switch (error.code) {
    case "pending_approval":
      return t("auth.login.error.pendingApproval");
    case "rejected":
      return t("auth.login.error.rejected");
    case "account_disabled":
      return t("users.form.disabled");
    default:
      return null;
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
