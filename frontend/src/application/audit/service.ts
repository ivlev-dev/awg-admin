import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditFilters, AuditPageResult } from "@/domain/audit/types";
import { ValidationError } from "../errors";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface AuditService {
  list(filters?: AuditFilters): Promise<AuditPageResult>;
}

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  const integer = Math.trunc(value);
  return Math.min(MAX_LIMIT, Math.max(1, integer));
}

function normalizeTimestamp(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

function normalizeStatus(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  const status = Math.trunc(value);
  return status >= 100 && status <= 599 ? status : undefined;
}

export function normalizeAuditFilters(filters: AuditFilters): AuditFilters {
  const from = normalizeTimestamp(filters.from);
  const to = normalizeTimestamp(filters.to);
  if (from !== undefined && to !== undefined && from > to) {
    throw new ValidationError("Начало периода не может быть позже конца");
  }
  return {
    limit: normalizeLimit(filters.limit),
    before: normalizeText(filters.before),
    action: normalizeText(filters.action),
    entity: normalizeText(filters.entity),
    actor: normalizeText(filters.actor),
    status: normalizeStatus(filters.status),
    from,
    to,
  };
}

export class DefaultAuditService implements AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async list(filters: AuditFilters = {}): Promise<AuditPageResult> {
    return this.repository.list(normalizeAuditFilters(filters));
  }
}
