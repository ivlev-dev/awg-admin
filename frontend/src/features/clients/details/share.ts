import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import type { ToastStore } from "@/app/toast";
import type { Device, ShareFormat, ShareLink, ShareLinkState } from "@/domain/types";
import { t } from "@/i18n";

import { SHARE_FORMAT_VALUES, SHARE_TTL_VALUES, ShareForm } from "./share.form";
import { MAX_SHARE_USES, SHARE_STATE_KEYS } from "./types";

type ShareHost = {
  readonly device: Device | null;
  readonly shareInterfaceId: string;
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  shares: ShareLink[];
};

export class ShareSection {
  private host!: ShareHost;

  readonly form = new ShareForm({ formId: "share-create", validateOnInput: true });

  attach(host: ShareHost): void {
    this.host = host;
  }

  get format(): ShareFormat {
    return this.form.format;
  }

  get ttl(): number {
    return this.form.ttl;
  }

  get oneTime(): boolean {
    return this.form.oneTime;
  }

  get maxUses(): string {
    if (this.form.maxUsesEmpty) return "";
    const value = this.form.maxUses;
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }

  @reactive accessor busy = false;

  @computed
  get canCreate(): boolean {
    return (
      this.host.device !== null &&
      this.host.shareInterfaceId.length > 0 &&
      !this.busy &&
      !this.maxUsesInvalid &&
      isTtlValid(this.form.ttl) &&
      isFormatValid(this.form.format)
    );
  }

  @computed
  get maxUsesInvalid(): boolean {
    if (this.form.oneTime || this.form.maxUsesEmpty) return false;
    const raw = this.form.maxUses;
    if (raw === "" || raw === null || raw === undefined) return false;
    if (typeof raw !== "number") return true;
    return !Number.isInteger(raw) || raw < 1 || raw > MAX_SHARE_USES;
  }

  @computed
  get maxUsesValue(): number | undefined {
    if (this.form.oneTime || this.form.maxUsesEmpty || this.maxUsesInvalid) return undefined;
    const raw = this.form.maxUses;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
    return raw;
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
    const format = this.form.format;
    const ttl = this.form.ttl;
    this.form.reset();
    this.form.maxUsesEmpty = true;
    this.form.format = format;
    this.form.ttl = ttl;
  }

  setFormat(value: string): void {
    this.form.format = value === "vpn" ? "vpn" : "conf";
    void this.form.validateField("format");
  }

  setTtl(value: string): void {
    const parsed = Number(value);
    this.form.ttl = Number.isFinite(parsed) ? parsed : 0;
    void this.form.validateField("ttl");
  }

  setOneTime(event: Event): void {
    this.form.getFieldProps("oneTime").onChange(event);
  }

  setMaxUses(value: string): void {
    const raw = value.trim();
    this.form.maxUsesEmpty = raw.length === 0;
    if (raw.length === 0) {
      this.form.maxUses = 0;
    } else {
      const parsed = Number(raw);
      this.form.maxUses = Number.isFinite(parsed) ? parsed : raw;
    }
    void this.form.validateField("maxUses");
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

  dispose(): void {
    this.form.dispose();
  }

  async create(): Promise<void> {
    const device = this.host.device;
    if (!device || this.busy) return;
    await this.form.onSubmit(async (submitted) => {
      if (!submitted.isValid || !this.canCreate) return;
      this.busy = true;
      try {
        const maxUses = this.maxUsesValue;
        const share = await this.host.devicesService.createShare(device.id, {
          interfaceId: this.host.shareInterfaceId,
          format: submitted.format,
          ttlSecs: submitted.ttl,
          ...(submitted.oneTime ? { oneTime: true } : {}),
          ...(!submitted.oneTime && maxUses !== undefined ? { maxUses } : {}),
        });
        this.host.shares = [share, ...this.host.shares];
        this.host.toasts.success(t("clients.details.toast.shareCreated"));
      } catch (error) {
        const message = userMessage(error, t("clients.details.error.shareCreate"));
        if (isShareValidationError(error)) submitted.setFieldErrors("maxUses", [message]);
        this.host.toasts.error(message);
      } finally {
        this.busy = false;
      }
    })();
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

function isTtlValid(value: number): boolean {
  return (SHARE_TTL_VALUES as readonly number[]).includes(value);
}

function isFormatValid(value: string): boolean {
  return (SHARE_FORMAT_VALUES as readonly string[]).includes(value);
}

function isShareValidationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = Reflect.get(error, "status");
  return status === 400 || status === 409 || status === 422;
}
