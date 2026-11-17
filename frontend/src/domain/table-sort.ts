export type SortDirection = "asc" | "desc";

export interface SortState<Key extends string = string> {
  readonly key: Key;
  readonly direction: SortDirection;
}

export function nextSort<Key extends string>(
  current: SortState<Key> | null,
  key: Key,
): SortState<Key> {
  if (current === null || current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function compareText(left: string, right: string, direction: SortDirection): number {
  const result = left.localeCompare(right, "ru", { sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

export function compareNumber(left: number, right: number, direction: SortDirection): number {
  return direction === "asc" ? left - right : right - left;
}

export function compareBoolean(left: boolean, right: boolean, direction: SortDirection): number {
  const a = left ? 1 : 0;
  const b = right ? 1 : 0;
  return direction === "asc" ? a - b : b - a;
}

export function sortIndicator(state: SortState | null, key: string): string {
  if (state === null || state.key !== key) return "";
  return state.direction === "asc" ? "▲" : "▼";
}
