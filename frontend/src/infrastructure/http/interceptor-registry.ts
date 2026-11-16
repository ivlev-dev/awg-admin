import type { AuthRequestInterceptor } from "./auth-request.interceptor";
import type { AuthResponseInterceptor } from "./auth-response.interceptor";
import type { RequestInterceptor, ResponseInterceptor } from "./types";

export class InterceptorRegistry {
  private readonly requests: RequestInterceptor[];
  private readonly responses: ResponseInterceptor[];

  constructor(
    authRequest: AuthRequestInterceptor,
    authResponse: AuthResponseInterceptor,
  ) {
    this.requests = [authRequest];
    this.responses = [authResponse];
  }

  get request(): readonly RequestInterceptor[] {
    return this.requests;
  }

  get response(): readonly ResponseInterceptor[] {
    return this.responses;
  }
}
