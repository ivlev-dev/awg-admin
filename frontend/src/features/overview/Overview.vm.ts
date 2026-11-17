import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { userMessage } from "@/application/errors";
import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaService, QuotaSnapshot } from "@/application/quota/service";
import { formatRateBps } from "@/application/stats/rate";
import type { StatsService } from "@/application/stats/service";
import { formatDateI18n, formatBytesI18n } from "@/i18n/format";
import type { Overview } from "@/domain/types";
import type { LiveStats } from "@/infrastructure/stats";
import { t } from "@/i18n";

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
    return formatBytesI18n(totals?.rx ?? 0);
  }

  @computed
  get todayTx(): string {
    const totals = this.liveStats.connected ? this.liveStats.today : this.data?.today;
    return formatBytesI18n(totals?.tx ?? 0);
  }

  @computed
  get monthRx(): string {
    const totals = this.liveStats.connected ? this.liveStats.month : this.data?.month;
    return formatBytesI18n(totals?.rx ?? 0);
  }

  @computed
  get monthTx(): string {
    const totals = this.liveStats.connected ? this.liveStats.month : this.data?.month;
    return formatBytesI18n(totals?.tx ?? 0);
  }

  @computed
  get todayTotal(): string {
    const totals = this.liveStats.connected ? this.liveStats.today : this.data?.today;
    return formatBytesI18n((totals?.rx ?? 0) + (totals?.tx ?? 0));
  }

  @computed
  get monthTotal(): string {
    const totals = this.liveStats.connected ? this.liveStats.month : this.data?.month;
    return formatBytesI18n((totals?.rx ?? 0) + (totals?.tx ?? 0));
  }

  @computed
  get rxRate(): string {
    return formatRateBps(this.data?.rx_bps);
  }

  @computed
  get txRate(): string {
    return formatRateBps(this.data?.tx_bps);
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
  get interfaces(): number {
    return this.data?.interfaces ?? 0;
  }

  @computed
  get groups(): number {
    return this.data?.groups ?? 0;
  }

  @computed
  get quotaView(): QuotaDisplay {
    return quotaDisplay(this.quota);
  }

  @computed
  get quotaResetLabel(): string {
    return formatDateI18n(this.quota?.resetAt);
  }

  @computed
  get quotaPeriodLabel(): string {
    if (!this.quota) return "—";
    return `${formatDateI18n(this.quota.periodStart)} — ${formatDateI18n(this.quota.periodEnd)}`;
  }

  @computed
  get quotaUsedLabel(): string {
    return formatBytesI18n(this.quota?.usedBytes ?? 0);
  }

  @computed
  get quotaLimitLabel(): string {
    const limit = this.quota?.quotaBytes;
    return limit === null || limit === undefined ? t("common.unlimited") : formatBytesI18n(limit);
  }

  @computed
  get quotaRemainingLabel(): string {
    const remaining = this.quota?.remainingBytes;
    return remaining === null || remaining === undefined
      ? t("common.unlimited")
      : formatBytesI18n(remaining);
  }

  @computed
  get quotaStatusLabel(): string {
    if (this.quotaView.exceeded) return t("quota.status.exceeded");
    return this.quotaView.hasQuota ? t("quota.status.ok") : t("common.unlimited");
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
        this.quotaError = userMessage(quota.reason, t("quota.error.load"));
      }
      if (overview.status === "rejected") throw overview.reason;
      if (series.status === "rejected") throw series.reason;
      this.data = overview.value;
      this.series = series.value.map((point) => ({ at: point.at, rx: point.rx, tx: point.tx }));
    } catch (error) {
      this.error = userMessage(error, t("overview.error.load"));
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

  openNodes(): void {
    this.router.navigate("/nodes");
  }

  openStats(): void {
    this.router.navigate("/stats");
  }
}
