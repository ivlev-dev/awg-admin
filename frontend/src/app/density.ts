import { createEffect, createRoot, createSignal, type Accessor } from "@ivlev-dev/silent-core";

import { persistedSignal, type PersistedSignal } from "@/app/persisted";

export type TableDensity = "comfortable" | "compact";

const DEFAULT_DENSITY: TableDensity = "comfortable";
const DENSITY_ATTRIBUTE = "data-density";

export const densityStorage: PersistedSignal<TableDensity> = persistedSignal<TableDensity>(
  "awg.ui.density",
  DEFAULT_DENSITY,
  validateDensity,
);

const [densitySignal, setDensitySignal] = createSignal<TableDensity>(densityStorage.read());

export const density: Accessor<TableDensity> = densitySignal;

let initialized = false;

export function setDensity(value: TableDensity): void {
  densityStorage.write(value);
  setDensitySignal(value);
  applyDensity(value);
}

export function applyDensity(value: TableDensity): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (value === "compact") {
    root.setAttribute(DENSITY_ATTRIBUTE, "compact");
  } else {
    root.removeAttribute(DENSITY_ATTRIBUTE);
  }
}

export function initDensity(): void {
  if (initialized) return;
  initialized = true;
  applyDensity(density());
  createRoot(() => {
    createEffect(() => {
      applyDensity(density());
    });
  });
}

function validateDensity(value: unknown): TableDensity | null {
  return value === "comfortable" || value === "compact" ? value : null;
}
