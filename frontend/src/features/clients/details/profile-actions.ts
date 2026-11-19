import { computed, reactive } from "@ivlev-dev/silent-core";

import type { ToastStore } from "@/app/toast";
import { copyText } from "@/domain/clipboard";
import type { DevicePeer } from "@/domain/devices/types";
import type { Device, Profile, ShareLink } from "@/domain/types";
import { t } from "@/i18n";

import { sanitizeFilePart, tunnelLabel } from "./model";

type ProfileHost = {
  readonly device: Device | null;
  readonly profiles: Profile[];
  readonly peers: DevicePeer[];
  readonly activePeerId: string;
  readonly toasts: ToastStore;
};

export class ProfileActions {
  private host!: ProfileHost;

  attach(host: ProfileHost): void {
    this.host = host;
  }

  @reactive accessor qrOpen = false;
  @reactive accessor qrValue = "";
  @reactive accessor qrTitle = "";
  @reactive accessor qrCopyLabel = "";

  @computed
  get activeProfile(): Profile | null {
    const profiles = this.host.profiles;
    const current = profiles.find((profile) => profile.peer_id === this.host.activePeerId);
    return current ?? profiles[0] ?? null;
  }

  @computed
  get canShowVpnQr(): boolean {
    return (this.activeProfile?.vpn_link.length ?? 0) > 0;
  }

  @computed
  get canShowConfQr(): boolean {
    return (this.activeProfile?.conf.length ?? 0) > 0;
  }

  profileLabel(profile: Profile): string {
    return tunnelLabel(profile.label, undefined, profile.interface_name);
  }

  profileInterfaceHint(profile: Profile): string {
    const label = this.profileLabel(profile);
    return label === profile.interface_name ? "" : profile.interface_name;
  }

  interfaceName(interfaceId: string): string {
    const profile = this.host.profiles.find((item) => item.interface_id === interfaceId);
    if (profile) return profile.interface_name;
    const peer = this.host.peers.find((item) => item.interface_id === interfaceId);
    return peer?.interface_name ?? interfaceId;
  }

  async copyText(value: string, label: string): Promise<void> {
    if (!value) {
      this.host.toasts.error(t("clients.copy.empty"));
      return;
    }
    try {
      await copyText(value);
      this.host.toasts.success(t("clients.copy.done", { label }));
    } catch {
      this.host.toasts.error(t("clients.copy.failed"));
    }
  }

  copyProfile(): void {
    const profile = this.activeProfile;
    if (!profile) return;
    void this.copyText(profile.conf, t("clients.copy.configLabel"));
  }

  copyVpn(): void {
    const profile = this.activeProfile;
    if (!profile) return;
    void this.copyText(profile.vpn_link, t("clients.copy.vpnLabel"));
  }

  openShareQr(share: ShareLink): void {
    if (!share.url) return;
    this.qrValue = share.url;
    this.qrTitle = t("clients.details.qr.shareTitle");
    this.qrCopyLabel = t("clients.details.qr.copy");
    this.qrOpen = true;
  }

  openVpnQr(): void {
    const profile = this.activeProfile;
    if (!profile || !profile.vpn_link) return;
    this.qrValue = profile.vpn_link;
    this.qrTitle = t("clients.details.qr.vpnTitle", { name: this.profileLabel(profile) });
    this.qrCopyLabel = t("clients.details.profiles.copyVpn");
    this.qrOpen = true;
  }

  openConfQr(): void {
    const profile = this.activeProfile;
    if (!profile || profile.conf.length === 0) return;
    this.qrValue = profile.conf;
    this.qrTitle = t("clients.details.qr.confTitle", { name: this.profileLabel(profile) });
    this.qrCopyLabel = t("clients.details.profiles.copy");
    this.qrOpen = true;
  }

  closeQr(): void {
    this.qrOpen = false;
    this.qrValue = "";
  }

  resetQr(): void {
    this.qrOpen = false;
    this.qrValue = "";
    this.qrTitle = "";
    this.qrCopyLabel = "";
  }

  copyQrValue(): void {
    void this.copyText(this.qrValue, this.qrCopyLabel);
  }

  downloadProfile(): void {
    const profile = this.activeProfile;
    if (!profile) return;
    const blob = new Blob([profile.conf], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFilePart(this.host.device?.name ?? "device")}-${sanitizeFilePart(this.profileLabel(profile))}.conf`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.host.toasts.success(t("clients.details.toast.downloaded"));
  }
}
