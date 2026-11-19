import type { ApiConfig } from "./config";
import { ApiError } from "./errors";
import type { HttpMethod, TransportOptions } from "./types";

export class HttpTransport {
  constructor(private readonly config: ApiConfig) {}

  get<T>(path: string, options: TransportOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  post<T>(path: string, body: unknown, options: TransportOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  patch<T>(path: string, body: unknown, options: TransportOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options);
  }

  put<T>(path: string, body: unknown, options: TransportOptions): Promise<T> {
    return this.request<T>("PUT", path, body, options);
  }

  delete<T>(path: string, options: TransportOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    options: TransportOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal(options.signal, this.config.timeoutMs),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = readErrorPayload(payload);
      throw new ApiError(
        response.status,
        error.code ?? "http_error",
        error.message ?? `HTTP ${response.status}`,
      );
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, "invalid_response", "Invalid server response");
    }
  }
}

interface ErrorPayload {
  code: string | undefined;
  message: string | undefined;
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (signal === undefined) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

function readErrorPayload(payload: unknown): ErrorPayload {
  if (typeof payload !== "object" || payload === null) {
    return { code: undefined, message: undefined };
  }
  const wrapper = Reflect.get(payload, "error");
  if (typeof wrapper !== "object" || wrapper === null) {
    return { code: undefined, message: undefined };
  }
  const code = Reflect.get(wrapper, "code");
  const message = Reflect.get(wrapper, "message");
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}
