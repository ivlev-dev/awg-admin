import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { invalidate, lookupInterfaces } from "@/app/lookups";
import { ToastStore } from "@/app/toast";
import { SelectionModel } from "@/app/table-controller";
import { issueMessage, userMessage } from "@/application/errors";
import type { InterfacesService } from "@/application/interfaces/service";
import type { TariffsService } from "@/application/tariffs/service";
import { compareNumber, compareText, nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import type { TariffInput } from "@/domain/tariffs/types";
import type { InterfaceInfo, Tariff } from "@/domain/types";
import { validateTariff } from "@/domain/validation";
import { t } from "@/i18n";

import { TariffForm } from "./tariff.form";

export type TariffsSortKey =
  | "name"
  | "interface_name"
  | "max_devices"
  | "device_down_kbps"
  | "device_up_kbps"
  | "group_down_kbps"
  | "group_up_kbps"
  | "traffic_quota_bytes";

export class TariffsPageVM extends ViewModel {
  @reactive accessor tariffs: Tariff[] = [];
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor loading = true;
  @reactive accessor refreshing = false;
  @reactive accessor error: string | null = null;
  @reactive accessor search = "";
  @reactive accessor bulkBusy = false;
  private readonly selection = new SelectionModel(() => this.visible);
  @reactive accessor sort: SortState<TariffsSortKey> | null = { key: "name", direction: "asc" };

  @reactive accessor modalOpen = false;
  @reactive accessor editingId: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor formError: string | null = null;

  readonly tariffForm: TariffForm;

  private formSnapshot = "";

  private hasLoaded = false;

  constructor(
    private readonly tariffsService: TariffsService,
    private readonly interfacesService: InterfacesService,
    private readonly toasts: ToastStore,
  ) {
    super();
    this.tariffForm = new TariffForm();
  }

  override created(): void {
    void this.load();
  }

  override unmounted(): void {
    this.tariffForm.dispose();
  }

  override dispose(): void {
    this.tariffForm.dispose();
    super.dispose();
  }

  async load(): Promise<void> {
    this.loading = !this.hasLoaded;
    this.refreshing = this.hasLoaded;
    this.error = null;
    try {
      const [tariffs, interfaces] = await Promise.all([
        this.tariffsService.listTariffs(),
        lookupInterfaces(this.interfacesService),
      ]);
      this.tariffs = tariffs;
      this.interfaces = interfaces;
    } catch (error) {
      this.error = userMessage(error, t("tariffs.error.load"));
    } finally {
      this.loading = false;
      this.refreshing = false;
      this.hasLoaded = true;
    }
  }

  @computed
  get interfaceOptions(): Array<{ value: string; label: string }> {
    const options = [{ value: "", label: t("tariffs.form.interfaceNone") }];
    for (const iface of this.interfaces) {
      options.push({
        value: iface.id,
        label: `${iface.name} · ${iface.group_name} · ${iface.node_name}`,
      });
    }
    return options;
  }

  @computed
  get title(): string {
    return this.editingId ? t("tariffs.form.title.edit") : t("tariffs.form.title.create");
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
      if (sort.key === "interface_name") {
        return compareText(left.interface_name ?? "", right.interface_name ?? "", direction);
      }
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

  get selectedIds(): string[] {
    return this.selection.selectedIds;
  }

  set selectedIds(value: string[]) {
    this.selection.selectedIds = value;
  }

  @computed
  get selectedCount(): number {
    return this.selection.selectedCount;
  }

  isSelected(id: string): boolean {
    return this.selection.isSelected(id);
  }

  toggleSelected(id: string): void {
    this.selection.toggleSelected(id);
  }

  @computed
  get allVisibleSelected(): boolean {
    return this.selection.allSelected;
  }

  toggleSelectAll(): void {
    this.selection.toggleSelectAll();
  }

  clearSelection(): void {
    this.selection.clearSelection();
  }

  async bulkDelete(): Promise<void> {
    const ids = this.tariffs
      .filter((tariff) => this.selectedIds.includes(tariff.id))
      .map((tariff) => tariff.id);
    if (ids.length === 0) return;
    const confirmed = await askConfirm({
      title: t("tariffs.bulk.deleteTitle"),
      message: t("bulk.confirm.delete", { count: ids.length }),
      details: t("tariffs.bulk.confirm", { count: ids.length }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;

    this.bulkBusy = true;
    try {
      const result = await this.tariffsService.bulk("delete", ids);
      invalidate("tariffs", this.tariffsService);
      this.toasts[result.failed.length > 0 ? "error" : "success"](
        t("bulk.done", { done: result.done, failed: result.failed.length }),
      );
      await this.load();
      this.clearSelection();
    } catch (error) {
      this.toasts.error(userMessage(error, t("tariffs.error.bulkDelete")));
    } finally {
      this.bulkBusy = false;
    }
  }

  openCreate(): void {
    this.editingId = null;
    this.tariffForm.reset();
    this.tariffForm.setValues({
      name: "",
      description: "",
      maxDevices: 1,
      deviceDownKbps: 0,
      deviceUpKbps: 0,
      groupDownKbps: 0,
      groupUpKbps: 0,
      quotaGb: 0,
      interfaceId: "",
    });
    this.formError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  openEdit(tariff: Tariff): void {
    this.editingId = tariff.id;
    this.tariffForm.reset();
    this.tariffForm.setValues({
      name: tariff.name,
      description: tariff.description,
      maxDevices: tariff.max_devices,
      deviceDownKbps: tariff.device_down_kbps,
      deviceUpKbps: tariff.device_up_kbps,
      groupDownKbps: tariff.group_down_kbps,
      groupUpKbps: tariff.group_up_kbps,
      quotaGb:
        tariff.traffic_quota_bytes === null
          ? 0
          : tariff.traffic_quota_bytes / 1024 / 1024 / 1024,
      interfaceId: tariff.interface_id ?? "",
    });
    this.formError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  formState(): string {
    return JSON.stringify(this.tariffForm.values);
  }

  @computed
  get formDirty(): boolean {
    return this.modalOpen && this.formState() !== this.formSnapshot;
  }

  async closeModal(): Promise<void> {
    if (this.saving) return;
    if (this.formDirty) {
      const confirmed = await askConfirm({
        title: t("tariffs.discard.title"),
        message: t("tariffs.discard.message"),
        confirmLabel: t("tariffs.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.modalOpen = false;
  }

  private interfaceValid(): boolean {
    const interfaceId = this.tariffForm.interfaceId;
    if (interfaceId === "") return true;
    return this.interfaces.some((iface) => iface.id === interfaceId);
  }

  private buildInput(): TariffInput {
    const form = this.tariffForm;
    const quota = form.quotaGb;
    const bytes =
      quota === 0 || String(quota).trim() === ""
        ? null
        : Math.round(Number(quota) * 1024 * 1024 * 1024);
    return {
      name: form.name,
      description: form.description,
      max_devices: form.maxDevices,
      device_down_kbps: form.deviceDownKbps,
      device_up_kbps: form.deviceUpKbps,
      group_down_kbps: form.groupDownKbps,
      group_up_kbps: form.groupUpKbps,
      traffic_quota_bytes: bytes,
      interface_id: form.interfaceId === "" ? null : form.interfaceId,
    };
  }

  async submit(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.formError = null;
    try {
      await this.tariffForm.onSubmit(async () => {
        if (!this.interfaceValid()) {
          this.formError = t("tariffs.form.error.interface");
          return;
        }
        const input = this.buildInput();
        const validationError = validateTariff({
          name: input.name,
          max_devices: input.max_devices,
          device_down_kbps: input.device_down_kbps,
          device_up_kbps: input.device_up_kbps,
          group_down_kbps: input.group_down_kbps,
          group_up_kbps: input.group_up_kbps,
        });
        if (validationError) {
          this.formError = issueMessage(validationError);
          return;
        }
        try {
          if (this.editingId) {
            await this.tariffsService.updateTariff(this.editingId, input);
            invalidate("tariffs", this.tariffsService);
            this.toasts.success(t("tariffs.toast.updated"));
          } else {
            await this.tariffsService.createTariff(input);
            invalidate("tariffs", this.tariffsService);
            this.toasts.success(t("tariffs.toast.created"));
          }
          this.modalOpen = false;
          this.formSnapshot = this.formState();
          await this.load();
        } catch (error) {
          const message = userMessage(error, t("tariffs.form.error.save"));
          this.formError = message;
          this.toasts.error(message);
        }
      })();
    } finally {
      this.saving = false;
    }
  }

  async remove(id: string): Promise<void> {
    const confirmed = await askConfirm({
      title: t("tariffs.confirm.deleteTitle"),
      message: t("tariffs.confirm.delete"),
      details: t("tariffs.confirm.deleteDetails"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.tariffsService.deleteTariff(id);
      invalidate("tariffs", this.tariffsService);
      this.toasts.success(t("tariffs.toast.deleted"));
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, t("tariffs.error.delete")));
    }
  }
}

function quotaSortValue(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}
