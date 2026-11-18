import type { AuditFilters, AuditPageResult } from "./types";

export interface AuditRepository {
  list(filters: AuditFilters): Promise<AuditPageResult>;
  clear(filters: AuditFilters): Promise<number>;
}
