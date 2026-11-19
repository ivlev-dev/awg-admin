import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import type { ToastStore } from "@/app/toast";
import type { Device, ShareFormat, ShareLink, ShareLinkState } from "@/domain/types";
import { t } from "@/i18n";

import { SHARE_MAX_USES_LIMIT, SHARE_STATE_KEYS } from "./types";

type ShareHost = {
  readonly device: Device | null;
  readonly shareInterfaceId: string;
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  shares: ShareLink[];
}

export class ShareSection {
  private host!: ShareHost;

  attach(host: ShareHost): void {
    this.host = host;
  }

  @reactive accessor format: ShareFormat = "conf";
  @reactive accessor ttl = 86400;
  @reactive accessor oneTime = false;
  @reactive accessor maxUses = "";
  @reactive accessor busy = false;

  @computed
  get canCreate(): boolean {
    return (
      this.host.device !== null &&
      this.host.shareInterfaceId.length > 0 &&
      !this.busy &&
      !this.maxUsesInvalid
    );
  }

  @computed
  get maxUsesInvalid(): boolean {
    if (this.oneTime) return false;
    const raw = this.maxUses.trim();
    if (raw.length === 0) return false;
    const parsed = Number(raw);
    return !Number.isInteger(parsed) || parsed < 1 || parsed > SHARE_MAX_USES_LIMIT;
  }

  @computed
  get maxUsesValue(): number | undefined {
    if (this.oneTime || this.maxUsesInvalid) return undefined;
    const raw = this.maxUses.trim();
    if (raw.length === 0) return undefined;
    return Number(raw);
  }

  @computed
  get hasActive(): boolean {
    return this.host.shares.some((share) => share.state === "active");
  }

  @computed
  get ttlOptions(): Array<{ value: number; label: string }> {
    return [
      { value: 3600, label: t("clients.details.share.ttl.1h") },
      { value: 86400, label: t("clients.details.share.ttl.1d") },
      { value: 604800, label: t("clients.details.share.ttl.7d") },
    ];
  }

  @computed
  get formatOptions(): Array<{ value: ShareFormat; label: string }> {
    return [
      { value: "conf", label: t("clients.details.share.format.conf") },
      { value: "vpn", label: t("clients.details.share.format.vpn") },
    ];
  }

  resetForm(): void {
    this.oneTime = false;
    this.maxUses = "";
  }

  setFormat(value: string): void {
    this.format = value === "vpn" ? "vpn" : "conf";
  }

  setTtl(value: string): void {
    const parsed = Number(value);
    this.ttl = Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
  }

  setOneTime(event: Event): void {
    this.oneTime = (event.target as HTMLInputElement).checked;
  }

  setMaxUses(value: string): void {
    this.maxUses = value;
  }

  stateLabel(state: ShareLinkState): string {
    return t(SHARE_STATE_KEYS[state]);
  }

  stateClass(state: ShareLinkState): string {
    if (state === "active") return "badge badge--green";
    if (state === "exhausted") return "badge badge--amber";
    if (state === "revoked") return "badge badge--red";
    return "badge badge--gray";
  }

  usesLabel(share: ShareLink): string {
    if (share.max_uses === null) {
      return t("clients.details.share.usesUnlimited", { uses: share.uses });
    }
    return t("clients.details.share.usesLimited", {
      uses: share.uses,
      max: share.max_uses,
    });
  }

  async create(): Promise<void> {
    const device = this.host.device;
    if (!device || !this.canCreate) return;
    this.busy = true;
    try {
      const maxUses = this.maxUsesValue;
      const share = await this.host.devicesService.createShare(device.id, {
        interfaceId: this.host.shareInterfaceId,
        format: this.format,
        ttlSecs: this.ttl,
        ...(this.oneTime ? { oneTime: true } : {}),
        ...(!this.oneTime && maxUses !== undefined ? { maxUses } : {}),
      });
      this.host.shares = [share, ...this.host.shares];
      this.host.toasts.success(t("clients.details.toast.shareCreated"));
    } catch (error) {
      this.host.toasts.error(userMessage(error, t("clients.details.error.shareCreate")));
    } finally {
      this.busy = false;
    }
  }

  async revoke(token: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.host.devicesService.revokeShare(token);
      this.host.shares = this.host.shares.filter((share) => share.token !== token);
      this.host.toasts.success(t("clients.details.toast.shareRevoked"));
    } catch (error) {
      this.host.toasts.error(userMessage(error, t("clients.details.error.shareRevoke")));
    } finally {
      this.busy = false;
    }
  }

  async revokeAll(): Promise<void> {
    const device = this.host.device;
    if (!device || this.busy) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.shareRevokeTitle"),
      message: t("clients.details.confirm.shareRevokeAll", { name: device.name }),
      confirmLabel: t("clients.details.revoke"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      const revoked = await this.host.devicesService.revokeAllShares(device.id);
      const revokedAt = new Date().toISOString();
      this.host.shares = this.host.shares.map((share) =>
        share.state === "active"
          ? {
              ...share,
              state: "revoked" as const,
              revoked_at: revokedAt,
              remaining_uses: share.max_uses === null ? null : 0,
            }
          : share,
      );
      this.host.toasts.success(
        t("clients.details.toast.sharesRevoked", { count: revoked }),
      );
    } catch (error) {
      this.host.toasts.error(userMessage(error, t("clients.details.error.sharesRevoke")));
    } finally {
      this.busy = false;
    }
  }
}
