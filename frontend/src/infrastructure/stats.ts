import { reactive } from "@ivlev-dev/silent-core";

import type { StatsRepository } from "@/domain/stats/repository";
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
  private ticketAbort: AbortController | null = null;
  private closedByUser = false;
  private generation = 0;

  constructor(
    private readonly tokens: TokenStore,
    private readonly tickets: StatsRepository,
  ) {
  }

  connect(scope: string, id: string | null = null): void {
    if (scope !== "global" && !id) {
      this.disconnect();
      return;
    }
    const changed = this.scope?.scope !== scope || this.scope?.id !== id;
    this.scope = { scope, id };
    this.closedByUser = false;
    const reusing = this.socket !== null && this.socket.readyState <= WebSocket.OPEN;
    if (!changed && (this.ticketAbort !== null || reusing)) return;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.generation += 1;
    this.clearTimer();
    this.abortTicket();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.connected = false;
  }

  reset(): void {
    this.history = [];
  }

  private open(): void {
    this.clearTimer();
    const scope = this.scope;
    if (!scope || !this.tokens.access()) return;

    this.generation += 1;
    const generation = this.generation;
    const previous = this.socket;
    this.socket = null;
    this.connected = false;
    previous?.close();
    this.abortTicket();

    const controller = new AbortController();
    this.ticketAbort = controller;
    void this.requestTicket(scope, generation, controller);
  }

  private async requestTicket(
    scope: { scope: string; id: string | null },
    generation: number,
    controller: AbortController,
  ): Promise<void> {
    let ticket: string;
    try {
      ticket = await this.tickets.createWsTicket(scope.scope, scope.id, {
        signal: controller.signal,
      });
    } catch {
      if (generation !== this.generation || this.closedByUser) return;
      this.ticketAbort = null;
      this.error = "live_stats_unavailable";
      this.scheduleReconnect(generation);
      return;
    }
    if (generation !== this.generation || this.closedByUser) return;
    this.ticketAbort = null;
    this.openSocket(ticket, generation);
  }

  private openSocket(ticket: string, generation: number): void {
    if (generation !== this.generation || this.closedByUser) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/v1/ws/stats?ticket=${encodeURIComponent(ticket)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    const isCurrent = (): boolean =>
      this.socket === socket && this.generation === generation;

    socket.addEventListener("open", () => {
      if (!isCurrent()) return;
      this.connected = true;
      this.error = null;
      this.attempt = 0;
    });
    socket.addEventListener("message", (event) => {
      if (!isCurrent()) return;
      try {
        this.handle(JSON.parse(String(event.data)) as Payload);
      } catch {
        // Ignore malformed frames.
      }
    });
    socket.addEventListener("close", () => {
      if (!isCurrent()) return;
      this.connected = false;
      if (!this.closedByUser) this.scheduleReconnect(generation);
    });
    socket.addEventListener("error", () => {
      if (!isCurrent()) return;
      this.error = "live_stats_unavailable";
    });
  }

  private abortTicket(): void {
    const controller = this.ticketAbort;
    this.ticketAbort = null;
    controller?.abort();
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

  private scheduleReconnect(generation: number): void {
    if (generation !== this.generation) return;
    this.attempt += 1;
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt, 4));
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation) return;
      this.open();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }
}
