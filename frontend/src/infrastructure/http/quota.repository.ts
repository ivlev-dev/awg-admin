import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState, UserQuota } from "@/domain/quota/types";
import type { HttpClient } from "./client";

export class HttpQuotaRepository implements QuotaRepository {
  constructor(private readonly client: HttpClient) {}

  me(): Promise<QuotaState> {
    return this.client.get<QuotaState>("/quota");
  }

  users(): Promise<UserQuota[]> {
    return this.client.get<UserQuota[]>("/quota/users");
  }
}
