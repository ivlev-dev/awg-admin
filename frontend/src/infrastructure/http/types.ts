import type { ApiError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type RequestSource = "auth" | "api";

export interface TransportOptions {
  headers?: Record<string, string>;
  source: RequestSource;
}

export interface RequestContext {
  method: HttpMethod;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  auth: boolean;
  source: RequestSource;
  attempt: number;
}

export interface ResponseContext {
  request: RequestContext;
  status: number;
  data: unknown;
  error: ApiError | null;
  retry(): Promise<ResponseContext>;
}

export interface RequestInterceptor {
  interceptRequest(context: RequestContext): Promise<RequestContext>;
}

export interface ResponseInterceptor {
  interceptResponse(context: ResponseContext): Promise<ResponseContext>;
}
