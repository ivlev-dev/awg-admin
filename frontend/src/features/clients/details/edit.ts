import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import type { ToastStore } from "@/app/toast";
import type { Device, Forwarding } from "@/domain/types";
import { t } from "@/i18n";

import { DeviceEditForm, DEVICE_NAME_MAX } from "./edit.form";
import {
  FORWARDING_MODE_KEYS,
  FORWARDING_MODES,
  modeOfForwarding,
  parseForwardingMode,
  sameIds,
} from "./model";
import type { ClientEditState, ForwardingMode } from "./types";

type EditHost = {
  readonly device: Device | null;
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  setDevice(device: Device): void;
  buildForwarding(mode: ForwardingMode, allowed: readonly string[]): Forwarding;
  applyRowFromDevice(device: Device): void;
};

export class EditSection {
  private host!: EditHost;

  readonly form = new DeviceEditForm({ formId: "device-edit", validateOnInput: true });

  attach(host: EditHost): void {
    this.host = host;
  }

  @reactive accessor forwardingMode: ForwardingMode = "off";
  @reactive accessor forwardingSelected: string[] = [];
  @reactive accessor saving = false;

  @reactive private accessor snapshot: ClientEditState | null = null;

  @computed
  get forwardingModeOptions(): Array<{ value: ForwardingMode; label: string; hint?: string }> {
    return FORWARDING_MODES.map((value) => ({
      value,
      label: t(FORWARDING_MODE_KEYS[value]),
      ...(value === "all" ? { hint: t("clients.details.forwarding.mode.allHint") } : {}),
    }));
  }

  @computed
  get forwardingError(): string | null {
    if (this.forwardingMode !== "selected") return null;
    const device = this.host.device;
    if (device && this.forwardingSelected.includes(device.id)) {
      return t("clients.details.forwarding.errorSelf");
    }
    if (this.forwardingSelected.length === 0) {
      return t("clients.details.forwarding.errorEmpty");
    }
    return null;
  }

  @computed
  get canSave(): boolean {
    return (
      this.host.device !== null &&
      !this.saving &&
      this.forwardingError === null &&
      isNameValid(this.form.name) &&
      isLimitValid(this.form.downKbps) &&
      isLimitValid(this.form.upKbps)
    );
  }

  @computed
  get dirty(): boolean {
    const snapshot = this.snapshot;
    if (snapshot === null) return false;
    const current = this.state();
    return (
      current.name !== snapshot.name ||
      current.downKbps !== snapshot.downKbps ||
      current.upKbps !== snapshot.upKbps ||
      current.forwardingMode !== snapshot.forwardingMode ||
      !sameIds(current.forwardingSelected, snapshot.forwardingSelected)
    );
  }

  setForwarding(mode: ForwardingMode, allowed: readonly string[]): void {
    this.forwardingMode = mode;
    this.forwardingSelected = [...allowed];
  }

  refreshForwarding(mode: ForwardingMode, allowed: readonly string[]): void {
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    this.snapshot = {
      ...snapshot,
      forwardingMode: mode,
      forwardingSelected: [...allowed],
    };
  }

  setName(event: Event): void {
    this.form.getFieldProps("name").onInput(event);
  }

  setDownKbps(value: number): void {
    const field = this.form.getFieldProps("downKbps");
    field.setValue(value);
    void field.validate();
  }

  setUpKbps(value: number): void {
    const field = this.form.getFieldProps("upKbps");
    field.setValue(value);
    void field.validate();
  }

  setMode(value: string): void {
    this.forwardingMode = parseForwardingMode(value);
  }

  isSelected(id: string): boolean {
    return this.forwardingSelected.includes(id);
  }

  toggleSelected(id: string): void {
    if (this.host.device?.id === id) return;
    this.forwardingSelected = this.forwardingSelected.includes(id)
      ? this.forwardingSelected.filter((item) => item !== id)
      : [...this.forwardingSelected, id];
  }

  hydrate(device: Device): void {
    this.form.reset();
    this.form.name = device.name;
    this.form.downKbps = device.down_kbps;
    this.form.upKbps = device.up_kbps;
    this.forwardingMode = modeOfForwarding(device.forwarding);
    this.forwardingSelected =
      this.forwardingMode === "selected" ? [...device.forwarding.allowed_devices] : [];
    this.snapshot = this.state();
  }

  dispose(): void {
    this.form.dispose();
  }

  async cancel(): Promise<void> {
    if (this.saving) return;
    const device = this.host.device;
    if (!device) return;
    if (this.dirty) {
      const confirmed = await askConfirm({
        title: t("clients.edit.discard.title"),
        message: t("clients.edit.discard.message"),
        confirmLabel: t("clients.edit.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.hydrate(device);
  }

  async save(): Promise<void> {
    const device = this.host.device;
    if (!device || this.saving) return;
    await this.form.onSubmit(async (submitted) => {
      if (!submitted.isValid || this.forwardingError !== null) return;
      const name = submitted.name.trim();
      this.saving = true;
      try {
        const updated = await this.host.devicesService.updateDevice(device.id, {
          name,
          down_kbps: submitted.downKbps,
          up_kbps: submitted.upKbps,
          forwarding: this.host.buildForwarding(this.forwardingMode, this.forwardingSelected),
        });
        this.host.setDevice(updated);
        this.host.applyRowFromDevice(updated);
        this.hydrate(updated);
        this.host.toasts.success(t("clients.details.toast.saved"));
      } catch (error) {
        const message = userMessage(error, t("clients.details.error.save"));
        if (isServerFieldError(error)) submitted.setFieldErrors("name", [message]);
        this.host.toasts.error(message);
      } finally {
        this.saving = false;
      }
    })();
  }

  private state(): ClientEditState {
    return {
      name: this.form.name,
      downKbps: this.form.downKbps,
      upKbps: this.form.upKbps,
      forwardingMode: this.forwardingMode,
      forwardingSelected: [...this.forwardingSelected],
    };
  }
}

function isNameValid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= DEVICE_NAME_MAX;
}

function isLimitValid(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isServerFieldError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = Reflect.get(error, "status");
  return status === 400 || status === 409 || status === 422;
}
