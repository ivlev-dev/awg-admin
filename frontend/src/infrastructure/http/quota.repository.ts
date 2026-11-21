import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState, UserQuota } from "@/domain/quota/types";
import type { HttpClient } from "./client";
import { readQuotaState, readUserQuotas } from "./response";

export class HttpQuotaRepository implements QuotaRepository {
  constructor(private readonly client: HttpClient) {}

  me(): Promise<QuotaState> {
    return this.client.get<unknown>("/quota").then(readQuotaState);
  }

  users(): Promise<UserQuota[]> {
    return this.client.get<unknown>("/quota/users").then(readUserQuotas);
  }
}
