import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { DevicesService } from "@/application/devices/service";
import type { GroupsService } from "@/application/groups/service";
import type { InterfacesService } from "@/application/interfaces/service";
import { formatRateBps } from "@/application/stats/rate";
import type { StatsService } from "@/application/stats/service";
import type { UsersService } from "@/application/users/service";
import type { DeviceStats } from "@/domain/devices/types";
import type { Device, Group, InterfaceInfo, StatsPoint, TrafficTotals, User } from "@/domain/types";
import { csvCell } from "@/domain/format";
import type { LiveStats } from "@/infrastructure/stats";
import { t, type TranslationKey } from "@/i18n";
import { formatBytesI18n } from "@/i18n/format";

type Scope = "global" | "user" | "group" | "interface" | "device";
type RangeKey = "24h" | "7d" | "30d" | "90d";
type DeltaDirection = "up" | "down" | "flat";

export interface TrafficComparison {
  current: number;
  previous: number | null;
  deltaPercent: number | null;
  direction: DeltaDirection;
}

export interface StatsComparison {
  rx: TrafficComparison;
  tx: TrafficComparison;
}

interface ScopeOption {
  value: Scope;
  label: string;
}

interface EntityOption {
  id: string;
  label: string;
}

interface DeviceRow {
  device: Device;
  today: TrafficTotals;
  month: TrafficTotals;
  failed: boolean;
}

interface DeviceStatsCacheEntry {
  stats: DeviceStats;
  expires: number;
}

const DEVICE_STATS_CONCURRENCY = 4;
const DEVICE_STATS_CACHE_TTL_MS = 15_000;

export interface DeviceRowView {
  id: string;
  name: string;
  addresses: string;
  todayRx: string;
  todayTx: string;
  monthRx: string;
  monthTx: string;
  failed: boolean;
}

const RANGE_SECONDS: Record<RangeKey, number> = {
  "24h": 24 * 3600,
  "7d": 7 * 24 * 3600,
  "30d": 30 * 24 * 3600,
  "90d": 90 * 24 * 3600,
};

const RANGE_LABELS: Record<RangeKey, TranslationKey> = {
  "24h": "stats.range.24h",
  "7d": "stats.range.7d",
  "30d": "stats.range.30d",
  "90d": "stats.range.90d",
};

function compareTotals(current: number, previous: number | null): TrafficComparison {
  if (previous === null || previous === 0) {
    return { current, previous, deltaPercent: null, direction: "flat" };
  }
  const deltaPercent = ((current - previous) / previous) * 100;
  const rounded = Math.round(deltaPercent);
  const direction: DeltaDirection = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  return { current, previous, deltaPercent, direction };
}

function deltaLabel(deltaPercent: number | null): string {
  if (deltaPercent === null) return "=";
  const rounded = Math.round(Math.abs(deltaPercent));
  if (rounded === 0) return "=";
  const sign = deltaPercent > 0 ? "+" : "\u2212";
  return `${sign}${rounded}%`;
}

function failedRow(device: Device): DeviceRow {
  return {
    device,
    today: { rx: 0, tx: 0 },
    month: { rx: 0, tx: 0 },
    failed: true,
  };
}

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export class StatsVM extends ViewModel {
  @reactive accessor scope: Scope = "user";
  @reactive accessor entityId: string | null = null;
  @reactive accessor rangeKey: RangeKey = "24h";
  @reactive accessor series: StatsPoint[] = [];
  @reactive accessor seriesLoading = false;
  @reactive accessor error: string | null = null;
  @reactive accessor users: User[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor devices: Device[] = [];
  @reactive accessor entitiesLoading = false;
  @reactive accessor entitiesError: string | null = null;
  @reactive accessor deviceRows: DeviceRow[] = [];
  @reactive accessor devicesLoading = false;
  @reactive accessor initialized = false;
  @reactive accessor liveEnabled = false;
  @reactive accessor compareEnabled = false;
  @reactive accessor previousTotals: TrafficTotals | null = null;
  @reactive accessor previousLoading = false;
  @reactive accessor previousError: string | null = null;

  private seriesRequest = 0;
  private statsRequest = 0;
  private previousRequest = 0;
  private deviceStatsAbort: AbortController | null = null;
  private readonly deviceStatsCache = new Map<string, DeviceStatsCacheEntry>();
  private deviceStatsBatchUnavailable = false;

  constructor(
    private readonly statsService: StatsService,
    private readonly devicesService: DevicesService,
    private readonly groupsService: GroupsService,
    private readonly interfacesService: InterfacesService,
    private readonly usersService: UsersService,
    private readonly liveStats: LiveStats,
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    super();
    this.scope = session.isAdmin ? "global" : "user";
  }

  override async created(): Promise<void> {
    if (!this.session.authenticated) {
      this.initialized = true;
      return;
    }
    try {
      this.scope = this.session.isAdmin ? "global" : "user";
      await this.loadEntities();
      this.ensureEntityId();
      await Promise.all([this.loadSeries(), this.loadDeviceStats()]);
    } finally {
      this.initialized = true;
    }
  }

  override unmounted(): void {
    this.cancelDeviceStats();
    if (!this.liveEnabled) return;
    this.liveStats.disconnect();
    this.liveStats.reset();
  }

  override dispose(): void {
    this.cancelDeviceStats();
    super.dispose();
  }

  @computed
  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get scopeOptions(): ScopeOption[] {
    if (this.isAdmin) {
      return [
        { value: "global", label: t("stats.scope.global") },
        { value: "user", label: t("stats.scope.user") },
        { value: "interface", label: t("stats.scope.interface") },
        { value: "device", label: t("stats.scope.device") },
      ];
    }
    return [
      { value: "user", label: t("stats.scope.myAccount") },
      { value: "device", label: t("stats.scope.myDevice") },
    ];
  }

  @computed
  get requiresEntity(): boolean {
    if (this.scope === "global") return false;
    if (this.scope === "user") return this.isAdmin;
    return true;
  }

  @computed
  get entityOptions(): EntityOption[] {
    if (this.scope === "user") {
      return this.users.map((user) => ({ id: user.id, label: user.email ?? user.login }));
    }
    if (this.scope === "group") {
      return this.groups.map((group) => ({ id: group.id, label: group.name }));
    }
    if (this.scope === "interface") {
      return this.interfaces.map((item) => ({
        id: item.id,
        label: `${item.node_name} · ${item.name}`,
      }));
    }
    if (this.scope === "device") {
      return this.devices.map((device) => ({ id: device.id, label: device.name }));
    }
    return [];
  }

  @computed
  get entityLabel(): string {
    if (this.scope === "user") return t("stats.entity.user");
    if (this.scope === "group") return t("stats.entity.group");
    if (this.scope === "interface") return t("stats.entity.interface");
    if (this.scope === "device") return t("stats.entity.device");
    return t("stats.entity.fallback");
  }

  @computed
  get selectedScopeLabel(): string {
    return this.scopeOptions.find((option) => option.value === this.scope)?.label ?? this.scope;
  }

  @computed
  get rangeSeconds(): number {
    return RANGE_SECONDS[this.rangeKey];
  }

  @computed
  get periodLabel(): string {
    return t(RANGE_LABELS[this.rangeKey]);
  }

  @computed
  get scopeId(): string | null {
    if (this.scope === "global") return null;
    if (this.scope === "user") {
      return this.isAdmin ? this.entityId : this.session.user?.id ?? null;
    }
    return this.entityId;
  }

  @computed
  get totalRx(): number {
    return this.series.reduce((sum, point) => sum + point.rx, 0);
  }

  @computed
  get totalTx(): number {
    return this.series.reduce((sum, point) => sum + point.tx, 0);
  }

  @computed
  get totalRxLabel(): string {
    return formatBytesI18n(this.totalRx);
  }

  @computed
  get totalTxLabel(): string {
    return formatBytesI18n(this.totalTx);
  }

  @computed
  get comparison(): StatsComparison {
    return {
      rx: compareTotals(this.totalRx, this.previousTotals?.rx ?? null),
      tx: compareTotals(this.totalTx, this.previousTotals?.tx ?? null),
    };
  }

  @computed
  get compareRxLabel(): string {
    return this.comparisonLabel(this.comparison.rx);
  }

  @computed
  get compareTxLabel(): string {
    return this.comparisonLabel(this.comparison.tx);
  }

  @computed
  get compareRxClass(): string {
    return this.comparisonClass(this.comparison.rx);
  }

  @computed
  get compareTxClass(): string {
    return this.comparisonClass(this.comparison.tx);
  }

  @computed
  get points(): number {
    return this.series.length;
  }

  @computed
  get averageRxLabel(): string {
    return formatRateBps(this.totalRx / this.rangeSeconds);
  }

  @computed
  get averageTxLabel(): string {
    return formatRateBps(this.totalTx / this.rangeSeconds);
  }

  @computed
  get currentRxRate(): string {
    return formatRateBps(this.series.at(-1)?.rx_bps);
  }

  @computed
  get currentTxRate(): string {
    return formatRateBps(this.series.at(-1)?.tx_bps);
  }

  @computed
  get liveConnected(): boolean {
    return this.liveStats.connected;
  }

  @computed
  get liveBadgeClass(): string {
    return this.liveEnabled && this.liveStats.connected ? "badge--green" : "badge--amber";
  }

  @computed
  get liveBadgeLabel(): string {
    if (!this.liveEnabled) return t("stats.live.offline");
    return this.liveStats.connected ? t("stats.live.live") : t("stats.live.connecting");
  }

  @computed
  get liveError(): string | null {
    return this.liveStats.error === null ? null : t("stats.error.live");
  }

  @computed
  get liveTodayRx(): string {
    return formatBytesI18n(this.liveStats.today.rx);
  }

  @computed
  get liveTodayTx(): string {
    return formatBytesI18n(this.liveStats.today.tx);
  }

  @computed
  get liveTodayTotal(): string {
    return formatBytesI18n(this.liveStats.today.rx + this.liveStats.today.tx);
  }

  @computed
  get liveMonthTotal(): string {
    return formatBytesI18n(this.liveStats.month.rx + this.liveStats.month.tx);
  }

  @computed
  get deviceRowsView(): DeviceRowView[] {
    return this.deviceRows.map((row) => ({
      id: row.device.id,
      name: row.device.name,
      addresses: row.device.addresses.join(", "),
      todayRx: formatBytesI18n(row.today.rx),
      todayTx: formatBytesI18n(row.today.tx),
      monthRx: formatBytesI18n(row.month.rx),
      monthTx: formatBytesI18n(row.month.tx),
      failed: row.failed,
    }));
  }

  setScope(value: string): void {
    const next = value as Scope;
    if (!this.scopeOptions.some((option) => option.value === next)) return;
    this.scope = next;
    this.entityId = null;
    this.ensureEntityId();
    this.syncLive();
    void this.loadSeries();
  }

  setEntity(value: string): void {
    this.entityId = value.length > 0 ? value : null;
    this.syncLive();
    void this.loadSeries();
  }

  setRange(key: RangeKey): void {
    if (this.rangeKey === key) return;
    this.rangeKey = key;
    this.cancelDeviceStats();
    void this.loadSeries();
  }

  toggleCompare(): void {
    this.setCompare(!this.compareEnabled);
  }

  setCompare(value: boolean): void {
    if (this.compareEnabled === value) return;
    this.compareEnabled = value;
    if (!value) {
      this.previousRequest += 1;
      this.previousTotals = null;
      this.previousError = null;
      this.previousLoading = false;
      return;
    }
    if (this.requiresEntity && !this.scopeId) {
      this.previousTotals = null;
      this.previousError = null;
      this.previousLoading = false;
      return;
    }
    void this.loadPrevious(this.currentWindow().from);
  }

  toggleLive(): void {
    if (this.liveEnabled) {
      this.liveEnabled = false;
      this.liveStats.disconnect();
      return;
    }
    if (this.requiresEntity && !this.scopeId) {
      this.toasts.error(t("stats.toast.selectEntity"));
      return;
    }
    this.liveEnabled = true;
    this.liveStats.reset();
    this.liveStats.connect(this.scope, this.scopeId);
  }

  async loadEntities(): Promise<void> {
    this.entitiesLoading = true;
    this.entitiesError = null;
    try {
      if (this.isAdmin) {
        const [users, groups, interfaces, devices] = await Promise.all([
          this.usersService.listUsers(),
          this.groupsService.listGroups(),
          this.interfacesService.listInterfaces(),
          this.devicesService.listDevices(),
        ]);
        this.users = users;
        this.groups = groups;
        this.interfaces = interfaces;
        this.devices = devices;
      } else {
        this.devices = await this.devicesService.listDevices();
      }
    } catch (error) {
      this.entitiesError = error instanceof Error ? error.message : t("stats.error.entities");
      this.toasts.error(this.entitiesError);
    } finally {
      this.entitiesLoading = false;
    }
  }

  async loadSeries(): Promise<void> {
    const request = ++this.seriesRequest;
    if (this.requiresEntity && !this.scopeId) {
      this.series = [];
      this.seriesLoading = false;
      this.resetPrevious();
      return;
    }
    this.seriesLoading = true;
    this.error = null;
    const { from, to } = this.currentWindow();
    const seriesTask = this.statsService.series(this.scope, this.scopeId, from, to);
    const previousTask = this.compareEnabled ? this.loadPrevious(from) : null;
    try {
      const points = await seriesTask;
      if (request !== this.seriesRequest) {
        await previousTask;
        return;
      }
      this.series = points;
    } catch (error) {
      if (request !== this.seriesRequest) {
        await previousTask;
        return;
      }
      this.error = error instanceof Error ? error.message : t("stats.error.series");
      this.toasts.error(this.error);
    } finally {
      if (request === this.seriesRequest) this.seriesLoading = false;
    }
    await previousTask;
  }

  async loadDeviceStats(force = false): Promise<void> {
    this.cancelDeviceStats();
    const controller = new AbortController();
    this.deviceStatsAbort = controller;
    const signal = controller.signal;
    const request = ++this.statsRequest;
    if (this.devices.length === 0) {
      this.deviceRows = [];
      this.deviceStatsCache.clear();
      this.devicesLoading = false;
      this.deviceStatsAbort = null;
      return;
    }
    this.devicesLoading = true;
    const now = Date.now();
    if (!force) {
      const cached = this.cachedRows(now);
      if (cached !== null) {
        this.deviceRows = cached;
        this.devicesLoading = false;
        this.deviceStatsAbort = null;
        return;
      }
    }
    try {
      let rows = await this.loadDeviceStatsBatch(signal);
      if (rows === null) rows = await this.loadDeviceStatsFallback(signal);
      if (request !== this.statsRequest || signal.aborted) return;
      this.deviceRows = rows;
      this.cacheRows(rows, now);
      if (rows.length > 0 && rows.every((row) => row.failed)) {
        this.toasts.error(t("stats.error.deviceStats"));
      }
    } catch (error) {
      if (signal.aborted || request !== this.statsRequest) return;
      this.deviceRows = [];
      this.toasts.error(
        error instanceof Error ? error.message : t("stats.error.deviceStats"),
      );
    } finally {
      if (request === this.statsRequest) {
        this.devicesLoading = false;
        if (this.deviceStatsAbort === controller) this.deviceStatsAbort = null;
      }
    }
  }

  private async loadDeviceStatsBatch(signal: AbortSignal): Promise<DeviceRow[] | null> {
    if (this.deviceStatsBatchUnavailable) return null;
    try {
      if (this.statsService.deviceStats === undefined) {
        this.deviceStatsBatchUnavailable = true;
        return null;
      }
      const batch = await this.statsService.deviceStats({ signal });
      if (batch === null) {
        this.deviceStatsBatchUnavailable = true;
        return null;
      }
      const byId = new Map(batch.map((stats) => [stats.device_id, stats]));
      return this.devices.map((device) => {
        const stats = byId.get(device.id);
        return stats === undefined
          ? failedRow(device)
          : { device, today: stats.today, month: stats.month, failed: false };
      });
    } catch (error) {
      if (signal.aborted) throw error;
      return null;
    }
  }

  private loadDeviceStatsFallback(signal: AbortSignal): Promise<DeviceRow[]> {
    return mapWithLimit(this.devices, DEVICE_STATS_CONCURRENCY, async (device) => {
      if (signal.aborted) throw abortError();
      try {
        const stats = await this.devicesService.deviceStats(device.id, { signal });
        return { device, today: stats.today, month: stats.month, failed: false };
      } catch (error) {
        if (signal.aborted) throw abortError();
        return failedRow(device);
      }
    });
  }

  private cachedRows(now: number): DeviceRow[] | null {
    const rows: DeviceRow[] = [];
    for (const device of this.devices) {
      const entry = this.deviceStatsCache.get(device.id);
      if (entry === undefined || entry.expires <= now) return null;
      rows.push({ device, today: entry.stats.today, month: entry.stats.month, failed: false });
    }
    return rows;
  }

  private cacheRows(rows: readonly DeviceRow[], now: number): void {
    for (const row of rows) {
      if (row.failed) continue;
      this.deviceStatsCache.set(row.device.id, {
        stats: { device_id: row.device.id, today: row.today, month: row.month },
        expires: now + DEVICE_STATS_CACHE_TTL_MS,
      });
    }
  }

  private cancelDeviceStats(): void {
    const controller = this.deviceStatsAbort;
    this.deviceStatsAbort = null;
    this.statsRequest += 1;
    this.devicesLoading = false;
    controller?.abort();
  }

  async refresh(): Promise<void> {
    await Promise.all([this.loadSeries(), this.loadDeviceStats(true)]);
  }

  exportCsv(): void {
    if (this.series.length === 0) {
      this.toasts.error(t("stats.toast.noExport"));
      return;
    }
    const lines = ["at,rx,tx,rx_bps,tx_bps"];
    for (const point of this.series) {
      lines.push(
        `${csvCell(point.at)},${point.rx},${point.tx},${point.rx_bps},${point.tx_bps}`,
      );
    }
    const blob = new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stats-${this.scope}-${this.rangeKey}.csv`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  openDevice(id: string): void {
    this.router.navigate(`/clients/${id}`);
  }

  private currentWindow(): { from: number; to: number } {
    const to = Math.floor(Date.now() / 1000);
    return { from: to - this.rangeSeconds, to };
  }

  private async loadPrevious(currentFrom: number): Promise<void> {
    const request = ++this.previousRequest;
    this.previousLoading = true;
    this.previousError = null;
    const to = currentFrom - 1;
    const from = to - this.rangeSeconds;
    try {
      const points = await this.statsService.series(this.scope, this.scopeId, from, to);
      if (request !== this.previousRequest) return;
      this.previousTotals = {
        rx: points.reduce((sum, point) => sum + point.rx, 0),
        tx: points.reduce((sum, point) => sum + point.tx, 0),
      };
    } catch (error) {
      if (request !== this.previousRequest) return;
      this.previousTotals = null;
      this.previousError = error instanceof Error ? error.message : t("stats.compare.failed");
    } finally {
      if (request === this.previousRequest) this.previousLoading = false;
    }
  }

  private resetPrevious(): void {
    this.previousRequest += 1;
    this.previousTotals = null;
    this.previousError = null;
    this.previousLoading = false;
  }

  private comparisonLabel(item: TrafficComparison): string {
    if (item.previous === null || item.previous === 0) return t("stats.compare.noData");
    const previous = t("stats.compare.previous", { value: formatBytesI18n(item.previous) });
    return `${previous} · ${deltaLabel(item.deltaPercent)}`;
  }

  private comparisonClass(item: TrafficComparison): string {
    if (item.previous === null || item.previous === 0) return "stats-compare__delta--flat";
    if (item.direction === "up") return "stats-compare__delta--up";
    if (item.direction === "down") return "stats-compare__delta--down";
    return "stats-compare__delta--flat";
  }

  private ensureEntityId(): void {
    if (!this.requiresEntity) {
      this.entityId = null;
      return;
    }
    const options = this.entityOptions;
    if (this.entityId && options.some((option) => option.id === this.entityId)) return;
    this.entityId = options[0]?.id ?? null;
  }

  private syncLive(): void {
    if (!this.liveEnabled) return;
    if (this.requiresEntity && !this.scopeId) {
      this.liveEnabled = false;
      this.liveStats.disconnect();
      return;
    }
    this.liveStats.reset();
    this.liveStats.connect(this.scope, this.scopeId);
  }
}
