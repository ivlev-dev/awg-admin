import { reactive } from "@ivlev-dev/silent-core";

import type { IconName } from "@/components/Icon";

export interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  icon?: IconName;
  path?: string;
  run?: () => void;
}

export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return [...items];
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(term)) return true;
    return item.hint !== undefined && item.hint.toLowerCase().includes(term);
  });
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export class CommandStore {
  @reactive accessor open = false;
  @reactive accessor query = "";
  @reactive accessor selected = 0;

  private count = 0;

  openPalette(): void {
    this.open = true;
    this.query = "";
    this.selected = 0;
  }

  close(): void {
    this.open = false;
    this.query = "";
    this.selected = 0;
  }

  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    this.openPalette();
  }

  setQuery(value: string): void {
    this.query = value;
    this.selected = 0;
  }

  setSelected(index: number): void {
    this.selected = clamp(index, 0, Math.max(0, this.count - 1));
  }

  setCount(value: number): void {
    this.count = Math.max(0, value);
    this.selected = clamp(this.selected, 0, this.count - 1);
  }

  move(delta: number): void {
    if (this.count === 0) {
      this.selected = 0;
      return;
    }
    this.selected = clamp(this.selected + delta, 0, this.count - 1);
  }

  selectedItem(items: readonly CommandItem[]): CommandItem | undefined {
    if (items.length === 0) return undefined;
    return items[clamp(this.selected, 0, items.length - 1)];
  }

  runSelected(items: readonly CommandItem[]): CommandItem | undefined {
    const item = this.selectedItem(items);
    if (item === undefined) return undefined;
    item.run?.();
    return item;
  }
}
