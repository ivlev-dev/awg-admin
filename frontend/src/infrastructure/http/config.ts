export interface ApiConfig {
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export class DefaultApiConfig implements ApiConfig {
  readonly baseUrl = "/api/v1";
  readonly timeoutMs = DEFAULT_TIMEOUT_MS;
}
