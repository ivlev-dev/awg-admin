import { reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import type { ToastStore } from "@/app/toast";
import type { Device } from "@/domain/types";
import { t } from "@/i18n";

type LifecycleHost = {
  readonly device: Device | null;
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  back(): void;
};

export class DeviceLifecycle {
  private host!: LifecycleHost;

  attach(host: LifecycleHost): void {
    this.host = host;
  }

  @reactive accessor busy = false;

  async revoke(): Promise<void> {
    const device = this.host.device;
    if (!device || this.busy) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.revokeTitle"),
      message: t("clients.details.confirm.revoke", { name: device.name }),
      confirmLabel: t("clients.details.revoke"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await this.host.devicesService.updateDevice(device.id, { revoked: true });
      this.host.toasts.success(t("clients.details.toast.revoked"));
      this.host.back();
    } catch (error) {
      this.host.toasts.error(userMessage(error, t("clients.details.error.revoke")));
    } finally {
      this.busy = false;
    }
  }

  async remove(): Promise<void> {
    const device = this.host.device;
    if (!device || this.busy) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.deleteTitle"),
      message: t("clients.details.confirm.delete", { name: device.name }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await this.host.devicesService.deleteDevice(device.id);
      this.host.toasts.success(t("clients.details.toast.deleted"));
      this.host.back();
    } catch (error) {
      this.host.toasts.error(userMessage(error, t("clients.details.error.delete")));
    } finally {
      this.busy = false;
    }
  }
}
