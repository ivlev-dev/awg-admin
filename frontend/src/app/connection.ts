import { reactive } from "@ivlev-dev/silent-core";

export type ConnectionNotice = "offline" | "restored" | null;

export const RESTORED_NOTICE_MS = 3000;

export class ConnectionMonitor {
  @reactive accessor online: boolean = readOnline();
  @reactive accessor notice: ConnectionNotice = null;

  private timer: number | null = null;
  private listening = false;

  constructor() {
    if (!this.online) this.notice = "offline";
  }

  listen(): void {
    if (this.listening || typeof window === "undefined") return;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    this.listening = true;
  }

  dispose(): void {
    if (this.listening && typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.listening = false;
    this.clearTimer();
  }

  private readonly handleOnline = (): void => {
    this.online = true;
    this.notice = "restored";
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.online) this.notice = null;
    }, RESTORED_NOTICE_MS);
  };

  private readonly handleOffline = (): void => {
    this.online = false;
    this.notice = "offline";
    this.clearTimer();
  };

  private clearTimer(): void {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }
}

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
