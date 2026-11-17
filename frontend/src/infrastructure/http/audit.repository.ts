import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditFilters, AuditPageResult } from "@/domain/audit/types";
import type { HttpClient } from "./client";

export class HttpAuditRepository implements AuditRepository {
  constructor(private readonly client: HttpClient) {}

  async list(filters: AuditFilters): Promise<AuditPageResult> {
    const params = new URLSearchParams();
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.before != null) params.set("before", filters.before);
    if (filters.action != null) params.set("action", filters.action);
    if (filters.entity != null) params.set("entity", filters.entity);
    if (filters.actor != null) params.set("actor", filters.actor);
    if (filters.status !== undefined) params.set("status", String(filters.status));
    if (filters.from !== undefined) params.set("from", String(filters.from));
    if (filters.to !== undefined) params.set("to", String(filters.to));
    const query = params.toString();
    const payload = await this.client.get<AuditPageResult>(
      query.length > 0 ? `/audit?${query}` : "/audit",
    );
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      next_cursor:
        typeof payload.next_cursor === "string" && payload.next_cursor.length > 0
          ? payload.next_cursor
          : null,
    };
  }
}
