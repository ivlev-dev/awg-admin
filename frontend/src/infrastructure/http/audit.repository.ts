import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditFilters, AuditPageResult } from "@/domain/audit/types";
import type { HttpClient } from "./client";

function filterParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action != null) params.set("action", filters.action);
  if (filters.entity != null) params.set("entity", filters.entity);
  if (filters.actor != null) params.set("actor", filters.actor);
  if (filters.status !== undefined) params.set("status", String(filters.status));
  if (filters.from !== undefined) params.set("from", String(filters.from));
  if (filters.to !== undefined) params.set("to", String(filters.to));
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

export class HttpAuditRepository implements AuditRepository {
  constructor(private readonly client: HttpClient) {}

  async list(filters: AuditFilters): Promise<AuditPageResult> {
    const params = filterParams(filters);
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.before != null) params.set("before", filters.before);
    const payload = await this.client.get<AuditPageResult>(withQuery("/audit", params));
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      next_cursor:
        typeof payload.next_cursor === "string" && payload.next_cursor.length > 0
          ? payload.next_cursor
          : null,
    };
  }

  async clear(filters: AuditFilters): Promise<number> {
    const payload = await this.client.delete<{ deleted: number }>(
      withQuery("/audit", filterParams(filters)),
    );
    return typeof payload.deleted === "number" ? payload.deleted : 0;
  }
}
