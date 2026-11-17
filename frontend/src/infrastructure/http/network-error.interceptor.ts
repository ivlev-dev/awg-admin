import type { ApiError } from "./errors";
import type { ResponseContext, ResponseInterceptor } from "./types";

export const NETWORK_ERROR_NOTICE_MS = 5000;

export class NetworkErrorInterceptor implements ResponseInterceptor {
  private lastNotifiedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly notify: (error: ApiError) => void,
    private readonly cooldownMs: number = NETWORK_ERROR_NOTICE_MS,
  ) {}

  interceptResponse(context: ResponseContext): Promise<ResponseContext> {
    if (context.error?.code !== "network_error") return Promise.resolve(context);
    const now = Date.now();
    if (now - this.lastNotifiedAt >= this.cooldownMs) {
      this.lastNotifiedAt = now;
      this.notify(context.error);
    }
    return Promise.resolve(context);
  }
}
