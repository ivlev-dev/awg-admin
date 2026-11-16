import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { userMessage } from "@/application/errors";
import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaService, QuotaSnapshot } from "../../application/quota/service";
import type { StatsService } from "../../application/stats/service";
import { formatBytes, formatDateRu } from "@/domain/format";
import type { Overview } from "@/domain/types";
import type { LiveStats } from "@/infrastructure/stats";

export class OverviewVM {
  @reactive accessor data: Overview | null = null;
  @reactive accessor series: Array<{ at: string; rx: number; tx: number }> = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;
  @reactive accessor quota: QuotaSnapshot | null = null;
  @reactive accessor quotaError: string | null = null;

  private started = false;

  constructor(
    private readonly statsService: StatsService,
    private readonly quotaService: QuotaService,
    private readonly liveStats: LiveStats,
    private readonly session: Session,
    private readonly router: Router,
  ) {}

  created(): void {
    this.start();
  }

  @watch((vm: OverviewVM) => vm.session.user?.id)
  onUserChange(): void {
    if (!this.session.authenticated) {
      this.started = false;
      return;
    }
    this.start();
  }

  private start(): void {
    if (!this.session.authenticated || this.started) return;
    this.started = true;
    void this.load();
    const scope = this.isAdmin ? "global" : "user";
    this.liveStats.connect(scope, this.isAdmin ? null : this.session.user?.id ?? null);
  }

  unmounted(): void {
    this.liveStats.disconnect();
  }

  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get live(): boolean {
    return this.liveStats.connected;
  }

  @computed
  get todayRx(): string {
    const totals = this.liveStats.connected ? this.liveStats.today : this.data?.today;
    return formatBytes(totals?.rx ?? 0);
  }

  @computed
  get todayTx(): string {
    const totals = this.liveStats.connected ? this.liveStats.today : this.data?.today;
    return formatBytes(totals?.tx ?? 0);
  }

  @computed
  get monthRx(): string {
    const totals = this.liveStats.connected ? this.liveStats.month : this.data?.month;
    return formatBytes(totals?.rx ?? 0);
  }

  @computed
  get monthTx(): string {
    const totals = this.liveStats.connected ? this.liveStats.month : this.data?.month;
    return formatBytes(totals?.tx ?? 0);
  }

  @computed
  get todayTotal(): string {
    const totals = this.liveStats.connected ? this.liveStats.today : this.data?.today;
    return formatBytes((totals?.rx ?? 0) + (totals?.tx ?? 0));
  }

  @computed
  get monthTotal(): string {
    const totals = this.liveStats.connected ? this.liveStats.month : this.data?.month;
    return formatBytes((totals?.rx ?? 0) + (totals?.tx ?? 0));
  }

  @computed
  get spark(): number[] {
    if (this.liveStats.history.length > 0) {
      return this.liveStats.history.map((point) => point.rx + point.tx);
    }
    return this.series.map((point) => point.rx + point.tx);
  }

  @computed
  get devices(): number {
    return this.data?.devices ?? 0;
  }

  @computed
  get quotaView(): QuotaDisplay {
    return quotaDisplay(this.quota);
  }

  @computed
  get quotaResetLabel(): string {
    return formatDateRu(this.quota?.resetAt);
  }

  @computed
  get quotaPeriodLabel(): string {
    if (!this.quota) return "—";
    return `${formatDateRu(this.quota.periodStart)} — ${formatDateRu(this.quota.periodEnd)}`;
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
    this.quotaError = null;
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 24 * 3600;
      const scope = this.isAdmin ? "global" : "user";
      const id = this.isAdmin ? null : this.session.user?.id ?? null;
      const [overview, series, quota] = await Promise.allSettled([
        this.statsService.overview(),
        this.statsService.series(scope, id, from, to),
        this.quotaService.me(),
      ]);
      if (quota.status === "fulfilled") {
        this.quota = quota.value;
      } else {
        this.quota = null;
        this.quotaError = userMessage(quota.reason, "Не удалось загрузить квоту трафика");
      }
      if (overview.status === "rejected") throw overview.reason;
      if (series.status === "rejected") throw series.reason;
      this.data = overview.value;
      this.series = series.value.map((point) => ({ at: point.at, rx: point.rx, tx: point.tx }));
    } catch (error) {
      this.error = userMessage(error, "Не удалось загрузить обзор");
    } finally {
      this.loading = false;
    }
  }

  openDevice(id: string): void {
    this.router.navigate(`/clients/${id}`);
  }

  openClients(): void {
    this.router.navigate("/clients");
  }

  openInterfaces(): void {
    this.router.navigate("/interfaces");
  }

  openStats(): void {
    this.router.navigate("/stats");
  }
}
