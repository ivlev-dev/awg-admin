import { reactive } from "@ivlev-dev/silent-core";

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastTimer {
  handle: number;
  remaining: number;
  started: number;
}

const MAX_VISIBLE = 4;

let seq = 0;

export class ToastStore {
  @reactive accessor items: ToastItem[] = [];

  private readonly timers = new Map<number, ToastTimer>();

  constructor() {
  }

  push(message: string, kind: ToastKind = "info", ttlMs = 4200): void {
    const duplicate = this.items.find((item) => item.message === message && item.kind === kind);
    if (duplicate !== undefined) this.dismiss(duplicate.id);

    const id = ++seq;
    this.items = [...this.items, { id, kind, message }];
    this.schedule(id, ttlMs);

    const overflow = this.items.slice(0, Math.max(0, this.items.length - MAX_VISIBLE));
    for (const item of overflow) this.dismiss(item.id);
  }

  success(message: string): void {
    this.push(message, "success");
  }

  error(message: string): void {
    this.push(message, "error", 6000);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) window.clearTimeout(timer.handle);
    this.timers.delete(id);
    this.items = this.items.filter((item) => item.id !== id);
  }

  pause(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer.handle);
    const remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
    this.timers.set(id, { handle: 0, remaining, started: 0 });
  }

  resume(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined || timer.handle !== 0) return;
    this.schedule(id, Math.max(0, timer.remaining));
  }

  private schedule(id: number, ttlMs: number): void {
    const started = Date.now();
    const handle = window.setTimeout(() => this.dismiss(id), ttlMs);
    this.timers.set(id, { handle, remaining: ttlMs, started });
  }
}
