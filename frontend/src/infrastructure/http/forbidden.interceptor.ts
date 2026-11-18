import type { ApiError } from "./errors";
import type { ResponseContext, ResponseInterceptor } from "./types";

const SESSION_ENDPOINT = "/auth/me";

export class ForbiddenInterceptor implements ResponseInterceptor {
  constructor(private readonly onForbidden: (error: ApiError) => void) {}

  async interceptResponse(context: ResponseContext): Promise<ResponseContext> {
    const error = context.error;
    if (error?.status !== 403) return context;
    if (context.request.path === SESSION_ENDPOINT) return context;
    this.onForbidden(error);
    return context;
  }
}
