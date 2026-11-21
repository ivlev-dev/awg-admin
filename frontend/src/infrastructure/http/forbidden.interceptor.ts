import type { ApiError } from "./errors";
import type { ResponseContext, ResponseInterceptor } from "./types";

const SESSION_ENDPOINT = "/auth/me";

export const ACCOUNT_BLOCK_CODES: ReadonlySet<string> = new Set([
  "pending_approval",
  "rejected",
  "account_disabled",
]);

export function isAccountBlockedError(error: ApiError): boolean {
  return error.status === 403 && ACCOUNT_BLOCK_CODES.has(error.code);
}

export class ForbiddenInterceptor implements ResponseInterceptor {
  constructor(private readonly onForbidden: (error: ApiError) => void) {}

  async interceptResponse(context: ResponseContext): Promise<ResponseContext> {
    const error = context.error;
    if (error === null || error === undefined) return context;
    if (!isAccountBlockedError(error)) return context;
    if (context.request.path === SESSION_ENDPOINT) return context;
    this.onForbidden(error);
    return context;
  }
}
