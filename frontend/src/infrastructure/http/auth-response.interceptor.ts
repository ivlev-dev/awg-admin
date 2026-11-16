import type { AuthRepository } from "../../domain/auth/repository";
import type { AuthSessionState } from "../../application/auth/session-state";
import type { TokenStore } from "../storage";
import type { ResponseContext, ResponseInterceptor } from "./types";

export class AuthResponseInterceptor implements ResponseInterceptor {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly auth: AuthRepository,
    private readonly tokens: TokenStore,
    private readonly session: AuthSessionState,
  ) {}

  async interceptResponse(context: ResponseContext): Promise<ResponseContext> {
    if (context.error?.status !== 401) return context;
    if (context.request.source === "auth" || context.request.path === "/auth/refresh") {
      this.session.clear();
      return context;
    }
    if (context.request.attempt > 0) return context;
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
