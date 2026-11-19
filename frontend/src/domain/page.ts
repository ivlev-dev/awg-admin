export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageRequest {
  limit: number;
  offset: number;
}

export const DEFAULT_PAGE_LIMIT = 25;
export const PAGE_LIMIT_MAX = 200;

export function normalizePageRequest(request: PageRequest): PageRequest {
  const limit = Number.isFinite(request.limit)
    ? Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.trunc(request.limit)))
    : DEFAULT_PAGE_LIMIT;
  const offset = Number.isFinite(request.offset)
    ? Math.max(0, Math.trunc(request.offset))
    : 0;
  return { limit, offset };
}

export function slicePage<T>(items: readonly T[], limit: number, offset: number): Page<T> {
  const normalized = normalizePageRequest({ limit, offset });
  return {
    items: items.slice(normalized.offset, normalized.offset + normalized.limit),
    total: items.length,
    limit: normalized.limit,
    offset: normalized.offset,
  };
}
