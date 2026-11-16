export interface AuditEntry {
  id: string;
  at: string;
  actor_id: string | null;
  actor_login: string;
  action: string;
  entity: string;
  entity_id: string | null;
  status: number;
  ip: string | null;
  details: string | null;
}

export interface AuditPageResult {
  items: AuditEntry[];
  next_cursor: string | null;
}

export interface AuditFilters {
  limit?: number;
  before?: string | null;
  action?: string | null;
  entity?: string | null;
  actor?: string | null;
  status?: number | null;
  from?: number | null;
  to?: number | null;
}
