const dirtyForms = new Set<string>();
const predicates = new Map<string, () => boolean>();

export function markDirty(form: string): void {
  dirtyForms.add(form);
}

export function markClean(form: string): void {
  dirtyForms.delete(form);
}

export function registerUnsaved(form: string, isDirty: () => boolean): void {
  predicates.set(form, isDirty);
}

export function unregisterUnsaved(form: string): void {
  predicates.delete(form);
  dirtyForms.delete(form);
}

export function hasUnsavedChanges(): boolean {
  if (dirtyForms.size > 0) return true;
  for (const isDirty of predicates.values()) {
    if (isDirty()) return true;
  }
  return false;
}

export function resetUnsavedRegistry(): void {
  dirtyForms.clear();
  predicates.clear();
}
