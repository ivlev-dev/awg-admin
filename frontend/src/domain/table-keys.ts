export type TableKeyAction = "activate" | "next" | "previous" | null;

const ACTIVATION_KEYS: readonly string[] = ["Enter", " ", "Spacebar"];

export function tableKeyAction(key: string): TableKeyAction {
  if (ACTIVATION_KEYS.includes(key)) return "activate";
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  return null;
}

export function isActivation(key: string): boolean {
  return tableKeyAction(key) === "activate";
}

export function isRowInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("input, button, a, select, textarea, label") !== null;
}
