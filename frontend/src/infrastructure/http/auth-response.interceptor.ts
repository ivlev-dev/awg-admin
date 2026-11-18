import type { AuthRepository } from "@/domain/auth/repository";
import type { AuthSessionState } from "@/application/auth/session-state";
import type { TokenStore } from "../storage";
import type { ResponseContext, ResponseInterceptor } from "./types";

const REFRESH_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

export class AuthResponseInterceptor implements ResponseInterceptor {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly auth: AuthRepository,
    private readonly tokens: TokenStore,
    private readonly session: AuthSessionState,
  ) {}

  async interceptResponse(context: ResponseContext): Promise<ResponseContext> {
    if (context.error?.status !== 401) return context;
    if (REFRESH_EXEMPT_PATHS.has(context.request.path)) {
      if (context.request.path === "/auth/refresh" || context.request.path === "/auth/logout") {
        this.session.clear();
      }
      return context;
    }
    if (context.request.attempt > 0) {
      this.session.clear();
      return context;
    }
    const refreshed = await this.tryRefresh();
    if (!refreshed) {
      this.session.clear();
      return context;
    }
    return context.retry();
  }

  private tryRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const refreshToken = this.tokens.refresh();
    if (!refreshToken) return Promise.resolve(false);
    this.refreshing = this.auth
      .refresh(refreshToken)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}
