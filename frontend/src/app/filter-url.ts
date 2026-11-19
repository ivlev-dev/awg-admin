export type FilterQueryEntry = readonly [key: string, value: string | null];

export function readFilterQuery(pathPrefix: string): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  if (!window.location.pathname.startsWith(pathPrefix)) return null;
  return new URLSearchParams(window.location.search);
}

export function syncFilterQuery(pathPrefix: string, entries: readonly FilterQueryEntry[]): void {
  if (typeof window === "undefined") return;
  if (!window.location.pathname.startsWith(pathPrefix)) return;
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== null && value.length > 0) params.set(key, value);
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}${window.location.hash}`;
  try {
    window.history.replaceState(window.history.state, "", next);
  } catch {
    return;
  }
}
