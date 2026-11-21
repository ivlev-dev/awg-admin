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
    const error = context.error;
    if (error === null) return Promise.resolve(context);
    if (error.code === "aborted") return Promise.resolve(context);
    if (error.code !== "network_error") return Promise.resolve(context);
    // Live statistics retries in the background and reports its state in the
    // UI on its own; a global toast per reconnect would be noise.
    if (context.request.path.startsWith("/ws/ticket")) return Promise.resolve(context);
    const now = Date.now();
    if (now - this.lastNotifiedAt >= this.cooldownMs) {
      this.lastNotifiedAt = now;
      this.notify(error);
    }
    return Promise.resolve(context);
  }
}
