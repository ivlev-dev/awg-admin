import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, liveStats, router, session, toasts } from "@/app/container";
import { formatBytes } from "@/domain/format";
import type { Device, Group, InterfaceInfo, StatsPoint, TrafficTotals, User } from "@/domain/types";

type Scope = "global" | "user" | "group" | "interface" | "device";
type RangeKey = "24h" | "7d" | "30d";

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
};

const RANGE_LABELS: Record<RangeKey, string> = {
  "24h": "24 часа",
  "7d": "7 дней",
  "30d": "30 дней",
};

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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

export class StatsVM {
  @reactive accessor scope: Scope = session.isAdmin ? "global" : "user";
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
  @reactive accessor liveEnabled = false;

  private seriesRequest = 0;
  private statsRequest = 0;

  async created(): Promise<void> {
    await this.loadEntities();
    this.ensureEntityId();
    await Promise.all([this.loadSeries(), this.loadDeviceStats()]);
  }

  unmounted(): void {
    if (!this.liveEnabled) return;
    liveStats.disconnect();
    liveStats.reset();
  }

  @computed
  get isAdmin(): boolean {
    return session.isAdmin;
  }

  @computed
  get scopeOptions(): ScopeOption[] {
    if (this.isAdmin) {
      return [
        { value: "global", label: "Все устройства" },
        { value: "user", label: "Пользователь" },
        { value: "group", label: "Группа" },
        { value: "interface", label: "Интерфейс" },
        { value: "device", label: "Устройство" },
      ];
    }
    return [
      { value: "user", label: "Мой аккаунт" },
      { value: "device", label: "Моё устройство" },
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
      return this.users.map((user) => ({ id: user.id, label: user.login }));
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
    if (this.scope === "user") return "Пользователь";
    if (this.scope === "group") return "Группа";
    if (this.scope === "interface") return "Интерфейс";
    if (this.scope === "device") return "Устройство";
    return "Сущность";
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
    return RANGE_LABELS[this.rangeKey];
  }

  @computed
  get scopeId(): string | null {
    if (this.scope === "global") return null;
    if (this.scope === "user") {
      return this.isAdmin ? this.entityId : session.user?.id ?? null;
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
    return formatBytes(this.totalRx);
  }

  @computed
  get totalTxLabel(): string {
    return formatBytes(this.totalTx);
  }

  @computed
  get points(): number {
    return this.series.length;
  }

  @computed
  get liveConnected(): boolean {
    return liveStats.connected;
  }

  @computed
  get liveBadgeClass(): string {
    return this.liveEnabled && liveStats.connected ? "badge--green" : "badge--amber";
  }

  @computed
  get liveBadgeLabel(): string {
    if (!this.liveEnabled) return "офлайн";
    return liveStats.connected ? "LIVE" : "подключение…";
  }

  @computed
  get liveError(): string | null {
    return liveStats.error;
  }

  @computed
  get liveTodayRx(): string {
    return formatBytes(liveStats.today.rx);
  }

  @computed
  get liveTodayTx(): string {
    return formatBytes(liveStats.today.tx);
  }

  @computed
  get liveTodayTotal(): string {
    return formatBytes(liveStats.today.rx + liveStats.today.tx);
  }

  @computed
  get liveMonthTotal(): string {
    return formatBytes(liveStats.month.rx + liveStats.month.tx);
  }

  @computed
  get deviceRowsView(): DeviceRowView[] {
    return this.deviceRows.map((row) => ({
      id: row.device.id,
      name: row.device.name,
      addresses: row.device.addresses.join(", "),
      todayRx: formatBytes(row.today.rx),
      todayTx: formatBytes(row.today.tx),
      monthRx: formatBytes(row.month.rx),
      monthTx: formatBytes(row.month.tx),
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
    void this.loadSeries();
  }

  toggleLive(): void {
    if (this.liveEnabled) {
      this.liveEnabled = false;
      liveStats.disconnect();
      return;
    }
    if (this.requiresEntity && !this.scopeId) {
      toasts.error("Выберите сущность для Live-режима");
      return;
    }
    this.liveEnabled = true;
    liveStats.reset();
    liveStats.connect(this.scope, this.scopeId);
  }

  async loadEntities(): Promise<void> {
    this.entitiesLoading = true;
    this.entitiesError = null;
    try {
      if (this.isAdmin) {
        const [users, groups, interfaces, devices] = await Promise.all([
          api.listUsers(),
          api.listGroups(),
          api.listInterfaces(),
          api.listDevices(),
        ]);
        this.users = users;
        this.groups = groups;
        this.interfaces = interfaces;
        this.devices = devices;
      } else {
        this.devices = await api.listDevices();
      }
    } catch (error) {
      this.entitiesError = error instanceof Error ? error.message : "Не удалось загрузить списки";
      toasts.error(this.entitiesError);
    } finally {
      this.entitiesLoading = false;
    }
  }

  async loadSeries(): Promise<void> {
    const request = ++this.seriesRequest;
    if (this.requiresEntity && !this.scopeId) {
      this.series = [];
      this.seriesLoading = false;
      return;
    }
    this.seriesLoading = true;
    this.error = null;
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - this.rangeSeconds;
      const points = await api.series(this.scope, this.scopeId, from, to);
      if (request !== this.seriesRequest) return;
      this.series = points;
    } catch (error) {
      if (request !== this.seriesRequest) return;
      this.error = error instanceof Error ? error.message : "Не удалось загрузить статистику";
      toasts.error(this.error);
    } finally {
      if (request === this.seriesRequest) this.seriesLoading = false;
    }
  }

  async loadDeviceStats(): Promise<void> {
    const request = ++this.statsRequest;
    if (this.devices.length === 0) {
      this.deviceRows = [];
      this.devicesLoading = false;
      return;
    }
    this.devicesLoading = true;
    try {
      const rows = await mapWithLimit(this.devices, 4, async (device) => {
        try {
          const stats = await api.deviceStats(device.id);
          return { device, today: stats.today, month: stats.month, failed: false };
        } catch {
          return {
            device,
            today: { rx: 0, tx: 0 },
            month: { rx: 0, tx: 0 },
            failed: true,
          };
        }
      });
      if (request !== this.statsRequest) return;
      this.deviceRows = rows;
      if (rows.length > 0 && rows.every((row) => row.failed)) {
        toasts.error("Не удалось загрузить статистику устройств");
      }
    } catch (error) {
      if (request === this.statsRequest) {
        this.deviceRows = [];
        toasts.error(
          error instanceof Error ? error.message : "Не удалось загрузить статистику устройств",
        );
      }
    } finally {
      if (request === this.statsRequest) this.devicesLoading = false;
    }
  }

  async refresh(): Promise<void> {
    await Promise.all([this.loadSeries(), this.loadDeviceStats()]);
  }

  exportCsv(): void {
    if (this.series.length === 0) {
      toasts.error("Нет данных для экспорта");
      return;
    }
    const lines = ["at,rx,tx"];
    for (const point of this.series) {
      lines.push(`${csvCell(point.at)},${point.rx},${point.tx}`);
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
    router.navigate(`/clients/${id}`);
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
      liveStats.disconnect();
      return;
    }
    liveStats.reset();
    liveStats.connect(this.scope, this.scopeId);
  }
}
