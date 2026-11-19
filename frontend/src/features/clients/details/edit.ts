import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import type { ToastStore } from "@/app/toast";
import type { Device, Forwarding } from "@/domain/types";
import { t } from "@/i18n";

import {
  FORWARDING_MODE_KEYS,
  FORWARDING_MODES,
  modeOfForwarding,
  parseForwardingMode,
  sameIds,
  sanitizeKbps,
} from "./model";
import type { ClientEditState, ForwardingMode } from "./types";

type EditHost = {
  readonly device: Device | null;
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  setDevice(device: Device): void;
  buildForwarding(mode: ForwardingMode, allowed: readonly string[]): Forwarding;
  applyRowFromDevice(device: Device): void;
}

export class EditSection {
  private host!: EditHost;

  attach(host: EditHost): void {
    this.host = host;
  }

  @reactive accessor name = "";
  @reactive accessor downKbps = 0;
  @reactive accessor upKbps = 0;
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
      this.name.trim().length > 0 &&
      !this.saving &&
      this.forwardingError === null
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
    this.name = (event.target as HTMLInputElement).value;
  }

  setDownKbps(value: number): void {
    this.downKbps = sanitizeKbps(value);
  }

  setUpKbps(value: number): void {
    this.upKbps = sanitizeKbps(value);
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
    this.name = device.name;
    this.downKbps = device.down_kbps;
    this.upKbps = device.up_kbps;
    this.forwardingMode = modeOfForwarding(device.forwarding);
    this.forwardingSelected =
      this.forwardingMode === "selected" ? [...device.forwarding.allowed_devices] : [];
    this.snapshot = this.state();
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
    if (!device || !this.canSave) return;
    const name = this.name.trim();
    if (!name) {
      this.host.toasts.error(t("clients.details.error.name"));
      return;
    }
    this.saving = true;
    try {
      const updated = await this.host.devicesService.updateDevice(device.id, {
        name,
        down_kbps: this.downKbps,
        up_kbps: this.upKbps,
        forwarding: this.host.buildForwarding(this.forwardingMode, this.forwardingSelected),
      });
      this.host.setDevice(updated);
      this.host.applyRowFromDevice(updated);
      this.hydrate(updated);
      this.host.toasts.success(t("clients.details.toast.saved"));
    } catch (error) {
      this.host.toasts.error(userMessage(error, t("clients.details.error.save")));
    } finally {
      this.saving = false;
    }
  }

  private state(): ClientEditState {
    return {
      name: this.name,
      downKbps: this.downKbps,
      upKbps: this.upKbps,
      forwardingMode: this.forwardingMode,
      forwardingSelected: [...this.forwardingSelected],
    };
  }
}
