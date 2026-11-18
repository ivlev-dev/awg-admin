import { computed, reactive } from "@ivlev-dev/silent-core";

import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import type { TariffsService } from "@/application/tariffs/service";
import { compareNumber, compareText, nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import type { TariffInput } from "@/domain/tariffs/types";
import type { Tariff } from "@/domain/types";
import { validateTariff } from "@/domain/validation";
import { t } from "@/i18n";

export type TariffsSortKey =
  | "name"
  | "max_devices"
  | "device_down_kbps"
  | "device_up_kbps"
  | "group_down_kbps"
  | "group_up_kbps"
  | "traffic_quota_bytes";

export class TariffsPageVM {
  @reactive accessor tariffs: Tariff[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;
  @reactive accessor search = "";
  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;
  @reactive accessor sort: SortState<TariffsSortKey> | null = { key: "name", direction: "asc" };

  @reactive accessor modalOpen = false;
  @reactive accessor editingId: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor formError: string | null = null;

  @reactive accessor name = "";
  @reactive accessor description = "";
  @reactive accessor max_devices = 1;
  @reactive accessor device_down_kbps = 0;
  @reactive accessor device_up_kbps = 0;
  @reactive accessor group_down_kbps = 0;
  @reactive accessor group_up_kbps = 0;
  @reactive accessor quotaGb = "";

  constructor(
    private readonly tariffsService: TariffsService,
    private readonly toasts: ToastStore,
  ) {}

  created(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.tariffs = await this.tariffsService.listTariffs();
    } catch (error) {
      this.error = userMessage(error, "Не удалось загрузить тарифы");
    } finally {
      this.loading = false;
    }
  }

  @computed
  get title(): string {
    return this.editingId ? "Редактировать тариф" : "Новый тариф";
  }

  @computed
  get searchActive(): boolean {
    return this.search.trim().length > 0;
  }

  @computed
  get visible(): Tariff[] {
    const query = this.search.trim().toLowerCase();
    const filtered = this.tariffs.filter((tariff) => {
      if (query.length === 0) return true;
      return tariff.name.toLowerCase().includes(query)
        || tariff.description.toLowerCase().includes(query);
    });
    const sort = this.sort;
    if (sort === null) return filtered;
    const direction = sort.direction;
    return [...filtered].sort((left, right) => {
      if (sort.key === "name") return compareText(left.name, right.name, direction);
      if (sort.key === "max_devices") {
        return compareNumber(left.max_devices, right.max_devices, direction);
      }
      if (sort.key === "device_down_kbps") {
        return compareNumber(left.device_down_kbps, right.device_down_kbps, direction);
      }
      if (sort.key === "device_up_kbps") {
        return compareNumber(left.device_up_kbps, right.device_up_kbps, direction);
      }
      if (sort.key === "group_down_kbps") {
        return compareNumber(left.group_down_kbps, right.group_down_kbps, direction);
      }
      if (sort.key === "group_up_kbps") {
        return compareNumber(left.group_up_kbps, right.group_up_kbps, direction);
      }
      return compareNumber(
        quotaSortValue(left.traffic_quota_bytes),
        quotaSortValue(right.traffic_quota_bytes),
        direction,
      );
    });
  }

  sortBy(key: TariffsSortKey): void {
    this.sort = nextSort(this.sort, key);
  }

  sortMark(key: TariffsSortKey): string {
    return sortIndicator(this.sort, key);
  }

  setSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
  }

  resetSearch(): void {
    this.search = "";
  }

  @computed
  get foundLabel(): string {
    return t("tariffs.search.found", { count: this.visible.length });
  }

  @computed
  get selectedCount(): number {
    return this.selectedIds.length;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSelected(id: string): void {
    this.selectedIds = this.isSelected(id)
      ? this.selectedIds.filter((value) => value !== id)
      : [...this.selectedIds, id];
  }

  @computed
  get allVisibleSelected(): boolean {
    return this.visible.length > 0
      && this.visible.every((tariff) => this.selectedIds.includes(tariff.id));
  }

  toggleSelectAll(): void {
    if (this.allVisibleSelected) {
      this.clearSelection();
      return;
    }
    this.selectedIds = this.visible.map((tariff) => tariff.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }

  async bulkDelete(): Promise<void> {
    const ids = this.tariffs
      .filter((tariff) => this.selectedIds.includes(tariff.id))
      .map((tariff) => tariff.id);
    if (ids.length === 0) return;
    if (!window.confirm(t("bulk.confirm.delete", { count: ids.length }))) return;
    this.bulkBusy = true;
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.tariffsService.deleteTariff(id);
        done += 1;
      } catch {
        failed += 1;
      }
    }
    this.bulkBusy = false;
    this.clearSelection();
    this.toasts[failed > 0 ? "error" : "success"](t("bulk.done", { done, failed }));
    await this.load();
  }

  openCreate(): void {
    this.editingId = null;
    this.name = "";
    this.description = "";
    this.max_devices = 1;
    this.device_down_kbps = 0;
    this.device_up_kbps = 0;
    this.group_down_kbps = 0;
    this.group_up_kbps = 0;
    this.quotaGb = "";
    this.formError = null;
    this.modalOpen = true;
  }

  openEdit(tariff: Tariff): void {
    this.editingId = tariff.id;
    this.name = tariff.name;
    this.description = tariff.description;
    this.max_devices = tariff.max_devices;
    this.device_down_kbps = tariff.device_down_kbps;
    this.device_up_kbps = tariff.device_up_kbps;
    this.group_down_kbps = tariff.group_down_kbps;
    this.group_up_kbps = tariff.group_up_kbps;
    this.quotaGb =
      tariff.traffic_quota_bytes === null
        ? ""
        : String(tariff.traffic_quota_bytes / 1024 / 1024 / 1024);
    this.formError = null;
    this.modalOpen = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.modalOpen = false;
  }

  setName(event: Event): void {
    this.name = (event.target as HTMLInputElement).value;
  }

  setDescription(event: Event): void {
    this.description = (event.target as HTMLTextAreaElement).value;
  }

  setMaxDevices(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.max_devices = Number.isFinite(value) ? value : 0;
  }

  setDeviceDown(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.device_down_kbps = Number.isFinite(value) ? value : 0;
  }

  setDeviceUp(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.device_up_kbps = Number.isFinite(value) ? value : 0;
  }

  setGroupDown(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.group_down_kbps = Number.isFinite(value) ? value : 0;
  }

  setGroupUp(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.group_up_kbps = Number.isFinite(value) ? value : 0;
  }

  setQuota(event: Event): void {
    this.quotaGb = (event.target as HTMLInputElement).value;
  }

  private buildInput(): TariffInput {
    const quota = this.quotaGb.trim();
    const bytes =
      quota === "" || Number(quota) === 0
        ? null
        : Math.round(Number(quota) * 1024 * 1024 * 1024);
    return {
      name: this.name,
      description: this.description,
      max_devices: this.max_devices,
      device_down_kbps: this.device_down_kbps,
      device_up_kbps: this.device_up_kbps,
      group_down_kbps: this.group_down_kbps,
      group_up_kbps: this.group_up_kbps,
      traffic_quota_bytes: bytes,
    };
  }

  async submit(): Promise<void> {
    const input = this.buildInput();
    const validationError = validateTariff({
      name: input.name,
      description: input.description,
      max_devices: input.max_devices,
      device_down_kbps: input.device_down_kbps,
      device_up_kbps: input.device_up_kbps,
      group_down_kbps: input.group_down_kbps,
      group_up_kbps: input.group_up_kbps,
      traffic_quota_bytes: input.traffic_quota_bytes,
    });
    if (validationError) {
      this.formError = validationError;
      return;
    }
    this.saving = true;
    this.formError = null;
    try {
      if (this.editingId) {
        await this.tariffsService.updateTariff(this.editingId, input);
        this.toasts.success("Тариф обновлён");
      } else {
        await this.tariffsService.createTariff(input);
        this.toasts.success("Тариф создан");
      }
      this.modalOpen = false;
      await this.load();
    } catch (error) {
      const message = userMessage(error, "Не удалось сохранить тариф");
      this.formError = message;
      this.toasts.error(message);
    } finally {
      this.saving = false;
    }
  }

  async remove(id: string): Promise<void> {
    if (!window.confirm(t("tariffs.confirm.delete"))) return;
    try {
      await this.tariffsService.deleteTariff(id);
      this.toasts.success("Тариф удалён");
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, "Не удалось удалить тариф"));
    }
  }
}

function quotaSortValue(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}
