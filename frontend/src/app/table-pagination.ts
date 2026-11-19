export const PAGE_SIZES: readonly number[] = [10, 25, 50, 100];

export interface PageWindow {
  readonly page: number;
  readonly pageCount: number;
  readonly from: number;
  readonly to: number;
}

export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function currentPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function pageWindow(total: number, page: number, pageSize: number): PageWindow {
  const count = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), count);
  if (total <= 0) return { page: current, pageCount: count, from: 0, to: 0 };
  const from = (current - 1) * pageSize + 1;
  return {
    page: current,
    pageCount: count,
    from,
    to: Math.min(from + pageSize - 1, total),
  };
}
