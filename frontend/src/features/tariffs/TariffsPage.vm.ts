import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, toasts } from "@/app/container";
import { validateTariff } from "@/domain/validation";
import type { Tariff } from "@/domain/types";
import type { TariffInput } from "@/application/api";

export class TariffsPageVM {
  @reactive accessor tariffs: Tariff[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;

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

  created(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.tariffs = await api.listTariffs();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Не удалось загрузить тарифы";
    } finally {
      this.loading = false;
    }
  }

  @computed
  get title(): string {
    return this.editingId ? "Редактировать тариф" : "Новый тариф";
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
        await api.updateTariff(this.editingId, input);
        toasts.success("Тариф обновлён");
      } else {
        await api.createTariff(input);
        toasts.success("Тариф создан");
      }
      this.modalOpen = false;
      await this.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить тариф";
      this.formError = message;
      toasts.error(message);
    } finally {
      this.saving = false;
    }
  }

  async remove(id: string): Promise<void> {
    if (!window.confirm("Удалить тариф?")) return;
    try {
      await api.deleteTariff(id);
      toasts.success("Тариф удалён");
      await this.load();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : "Не удалось удалить тариф");
    }
  }
}