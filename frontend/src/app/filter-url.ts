export type FilterQueryEntry = readonly [key: string, value: string | null];

function matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix === "/" || pathPrefix.length === 0) return true;
  const prefix = pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  if (state !== null && typeof state === "object" && !Array.isArray(state)) {
    return { ...state };
  }
  return {};
}

export function readFilterQuery(pathPrefix: string): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  if (!matchesPathPrefix(window.location.pathname, pathPrefix)) return null;
  return new URLSearchParams(window.location.search);
}

export function syncFilterQuery(pathPrefix: string, entries: readonly FilterQueryEntry[]): void {
  if (typeof window === "undefined") return;
  if (!matchesPathPrefix(window.location.pathname, pathPrefix)) return;
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== null && value.length > 0) params.set(key, value);
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}${window.location.hash}`;
  try {
    window.history.replaceState(historyState(), "", next);
  } catch {
    return;
  }
}
