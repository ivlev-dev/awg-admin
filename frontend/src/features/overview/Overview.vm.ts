import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, liveStats, router, session } from "@/app/container";
import { formatBytes } from "@/domain/format";
import type { Overview } from "@/domain/types";

export class OverviewVM {
  @reactive accessor data: Overview | null = null;
  @reactive accessor series: Array<{ at: string; rx: number; tx: number }> = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;

  created(): void {
    void this.load();
    const scope = this.isAdmin ? "global" : "user";
    liveStats.connect(scope, this.isAdmin ? null : session.user?.id ?? null);
  }

  unmounted(): void {
    liveStats.disconnect();
  }

  get isAdmin(): boolean {
    return session.isAdmin;
  }

  @computed
  get live(): boolean {
    return liveStats.connected;
  }

  @computed
  get todayRx(): string {
    const totals = liveStats.connected ? liveStats.today : this.data?.today;
    return formatBytes(totals?.rx ?? 0);
  }

  @computed
  get todayTx(): string {
    const totals = liveStats.connected ? liveStats.today : this.data?.today;
    return formatBytes(totals?.tx ?? 0);
  }

  @computed
  get monthRx(): string {
    const totals = liveStats.connected ? liveStats.month : this.data?.month;
    return formatBytes(totals?.rx ?? 0);
  }

  @computed
  get monthTx(): string {
    const totals = liveStats.connected ? liveStats.month : this.data?.month;
    return formatBytes(totals?.tx ?? 0);
  }

  @computed
  get todayTotal(): string {
    const totals = liveStats.connected ? liveStats.today : this.data?.today;
    return formatBytes((totals?.rx ?? 0) + (totals?.tx ?? 0));
  }

  @computed
  get monthTotal(): string {
    const totals = liveStats.connected ? liveStats.month : this.data?.month;
    return formatBytes((totals?.rx ?? 0) + (totals?.tx ?? 0));
  }

  @computed
  get spark(): number[] {
    if (liveStats.history.length > 0) {
      return liveStats.history.map((point) => point.rx + point.tx);
    }
    return this.series.map((point) => point.rx + point.tx);
  }

  @computed
  get devices(): number {
    return this.data?.devices ?? 0;
  }

  @computed
  get nodesOnline(): number {
    return this.data?.nodes_online ?? 0;
  }

  @computed
  get nodesTotal(): number {
    return this.data?.nodes_total ?? 0;
  }

  @computed
  get topDevices() {
    return this.data?.top_devices ?? [];
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 24 * 3600;
      const scope = this.isAdmin ? "global" : "user";
      const id = this.isAdmin ? null : session.user?.id ?? null;
      const [overview, series] = await Promise.all([
        api.overview(),
        api.series(scope, id, from, to),
      ]);
      this.data = overview;
      this.series = series.map((point) => ({ at: point.at, rx: point.rx, tx: point.tx }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Не удалось загрузить обзор";
    } finally {
      this.loading = false;
    }
  }

  openDevice(id: string): void {
    router.navigate(`/clients/${id}`);
  }

  openClients(): void {
    router.navigate("/clients");
  }

  openInterfaces(): void {
    router.navigate("/interfaces");
  }

  openStats(): void {
    router.navigate("/stats");
  }
}
