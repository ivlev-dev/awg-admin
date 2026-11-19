import { ApiError } from "./errors";
import type { HttpTransport } from "./transport";
import {
  createIdempotencyKey,
  hasIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  needsIdempotencyKey,
} from "./idempotency";
import type { InterceptorRegistry } from "./interceptor-registry";
import type {
  HttpMethod,
  RequestContext,
  RequestSource,
  ResponseContext,
} from "./types";

export interface RequestOptions {
  auth?: boolean;
  source?: RequestSource;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class HttpClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly registry: InterceptorRegistry,
  ) {}

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.execute<T>(context("GET", path, undefined, options));
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.execute<T>(context("POST", path, body, options));
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.execute<T>(context("PATCH", path, body, options));
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.execute<T>(context("PUT", path, body, options));
  }

  delete<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.execute<T>(context("DELETE", path, undefined, options));
  }

  private async execute<T>(initial: RequestContext): Promise<T> {
    const response = await this.dispatch(initial);
    if (response.error) throw response.error;
    return response.data as T;
  }

  private async dispatch(initial: RequestContext): Promise<ResponseContext> {
    let current = initial;
    for (const interceptor of this.registry.request) {
      current = await interceptor.interceptRequest(current);
    }
    let response = await this.send(current);
    for (const interceptor of this.registry.response) {
      response = await interceptor.interceptResponse(response);
    }
    return response;
  }

  private async send(request: RequestContext): Promise<ResponseContext> {
    try {
      const data = await this.transport.request(
        request.method,
        request.path,
        request.body,
        {
          headers: request.headers,
          source: request.source,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      return {
        request,
        status: 200,
        data,
        error: null,
        retry: () => this.retry(request),
      };
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(
              0,
              "network_error",
              error instanceof Error ? error.message : "Network error",
            );
      return {
        request,
        status: apiError.status,
        data: undefined,
        error: apiError,
        retry: () => this.retry(request),
      };
    }
  }

  private retry(request: RequestContext): Promise<ResponseContext> {
    const headers: Record<string, string> = { ...request.headers };
    delete headers.Authorization;
    return this.dispatch({ ...request, headers, attempt: request.attempt + 1 });
  }
}

function context(
  method: HttpMethod,
  path: string,
  body: unknown,
  options: RequestOptions,
): RequestContext {
  const headers: Record<string, string> = { ...options.headers };
  if (needsIdempotencyKey(method, path) && !hasIdempotencyKey(headers)) {
    headers[IDEMPOTENCY_KEY_HEADER] = createIdempotencyKey();
  }
  return {
    method,
    path,
    body,
    headers,
    auth: options.auth ?? true,
    source: options.source ?? "api",
    attempt: 0,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}
