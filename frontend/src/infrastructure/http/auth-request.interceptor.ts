import type { TokenStore } from "../storage";
import type { RequestContext, RequestInterceptor } from "./types";

export class AuthRequestInterceptor implements RequestInterceptor {
  constructor(private readonly tokens: TokenStore) {}

  async interceptRequest(context: RequestContext): Promise<RequestContext> {
    if (!context.auth) return context;
    const token = this.tokens.access();
    if (token) context.headers.Authorization = `Bearer ${token}`;
    return context;
  }
}
