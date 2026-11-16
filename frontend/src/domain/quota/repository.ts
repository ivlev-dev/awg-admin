import type { QuotaState, UserQuota } from "./types";

export interface QuotaRepository {
  me(): Promise<QuotaState>;
  users(): Promise<UserQuota[]>;
}
