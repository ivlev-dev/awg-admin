import { reactive } from "@ivlev-dev/silent-core";

import type { TrafficTotals } from "@/domain/types";
import type { TokenStore } from "./storage";

export interface TrafficItem {
  device_id: string;
  user_id: string;
  group_id: string;
  interface_id: string;
  rx: number;
  tx: number;
}

interface HelloPayload {
  type: "hello";
  today: TrafficTotals;
  month: TrafficTotals;
}

interface TrafficPayload {
  type: "traffic";
  at: string;
  items: TrafficItem[];
}

interface PingPayload {
  type: "ping";
  at: string;
}

type Payload = HelloPayload | TrafficPayload | PingPayload;

export class LiveStats {
  @reactive accessor connected = false;
  @reactive accessor error: string | null = null;
  @reactive accessor today: TrafficTotals = { rx: 0, tx: 0 };
  @reactive accessor month: TrafficTotals = { rx: 0, tx: 0 };
  @reactive accessor history: Array<{ at: number; rx: number; tx: number }> = [];

  private socket: WebSocket | null = null;
  private scope: { scope: string; id: string | null } | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private closedByUser = false;

  constructor(private readonly tokens: TokenStore) {
    if (import.meta.env.MODE !== "test") {
      const shared = (globalThis as { __awgLiveStats?: LiveStats }).__awgLiveStats;
      if (shared) return shared;
      (globalThis as { __awgLiveStats?: LiveStats }).__awgLiveStats = this;
    }
  }

  connect(scope: string, id: string | null = null): void {
    if (scope !== "global" && !id) {
      this.disconnect();
      return;
    }
    const changed = this.scope?.scope !== scope || this.scope?.id !== id;
    this.scope = { scope, id };
    this.closedByUser = false;
    if (!changed && this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }

  reset(): void {
    this.history = [];
  }

  private open(): void {
    const token = this.tokens.access();
    if (!token || !this.scope) return;
    this.socket?.close();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({ token, scope: this.scope.scope });
    if (this.scope.id) params.set("id", this.scope.id);
    const url = `${protocol}//${window.location.host}/api/v1/ws/stats?${params.toString()}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.connected = true;
      this.error = null;
      this.attempt = 0;
    });
    socket.addEventListener("message", (event) => {
      try {
        this.handle(JSON.parse(String(event.data)) as Payload);
      } catch {
        // Ignore malformed frames.
      }
    });
    socket.addEventListener("close", () => {
      this.connected = false;
      if (!this.closedByUser) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      this.error = "Нет соединения со статистикой";
    });
  }

  private handle(payload: Payload): void {
    if (payload.type === "hello") {
      this.today = payload.today;
      this.month = payload.month;
      return;
    }
    if (payload.type === "traffic") {
      const rx = payload.items.reduce((sum, item) => sum + item.rx, 0);
      const tx = payload.items.reduce((sum, item) => sum + item.tx, 0);
      this.today = { rx: this.today.rx + rx, tx: this.today.tx + tx };
      this.month = { rx: this.month.rx + rx, tx: this.month.tx + tx };
      const at = new Date(payload.at).getTime();
      const history = [...this.history, { at, rx, tx }];
      this.history = history.slice(-60);
    }
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt, 4));
    this.timer = window.setTimeout(() => this.open(), delay);
  }
}
