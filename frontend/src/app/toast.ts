import { reactive } from "@ivlev-dev/silent-core";

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let seq = 0;

export class ToastStore {
  @reactive accessor items: ToastItem[] = [];

  constructor() {
    if (import.meta.env.MODE !== "test") {
      const shared = (globalThis as { __awgToast?: ToastStore }).__awgToast;
      if (shared) return shared;
      (globalThis as { __awgToast?: ToastStore }).__awgToast = this;
    }
  }

  push(message: string, kind: ToastKind = "info", ttlMs = 4200): void {
    const id = ++seq;
    this.items = [...this.items, { id, kind, message }];
    window.setTimeout(() => this.dismiss(id), ttlMs);
  }

  success(message: string): void {
    this.push(message, "success");
  }

  error(message: string): void {
    this.push(message, "error", 6000);
  }

  dismiss(id: number): void {
    this.items = this.items.filter((item) => item.id !== id);
  }
}
