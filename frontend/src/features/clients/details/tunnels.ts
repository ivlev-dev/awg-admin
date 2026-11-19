import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import type { ToastStore } from "@/app/toast";
import { PEER_LABEL_MAX } from "@/application/guards";
import type { DevicePeer } from "@/domain/devices/types";
import type { Device, InterfaceInfo, Profile } from "@/domain/types";
import { t } from "@/i18n";
import { pluralI18n } from "@/i18n/format";

import {
  interfaceFitsDevice,
  isConflict,
  tunnelError,
  tunnelLabel,
  withPrimaryPeer,
} from "./model";
import type { Option, TunnelRow } from "./types";

type TunnelHost = {
  readonly device: Device | null;
  readonly profiles: Profile[];
  readonly peers: DevicePeer[];
  readonly interfaces: InterfaceInfo[];
  readonly activePeerId: string;
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  setDevice(device: Device): void;
  setProfiles(profiles: Profile[]): void;
  setActivePeer(peerId: string): void;
  interfaceName(interfaceId: string): string;
  syncSelection(): void;
}

export class TunnelSection {
  private host!: TunnelHost;

  attach(host: TunnelHost): void {
    this.host = host;
  }

  @reactive accessor busy = false;
  @reactive accessor addOpen = false;
  @reactive accessor addInterfaceId = "";
  @reactive accessor addLabel = "";
  @reactive accessor addBusy = false;
  @reactive accessor renameOpen = false;
  @reactive accessor renamePeerId = "";
  @reactive accessor renameLabel = "";
  @reactive accessor renameBusy = false;

  @reactive private accessor addLabelEdited = false;

  @computed
  get rows(): TunnelRow[] {
    const profiles = this.host.profiles;
    if (profiles.length > 0) {
      return withPrimaryPeer(
        profiles.map((profile) => {
          const peer = this.host.peers.find((item) => item.peer_id === profile.peer_id);
          return {
            peerId: profile.peer_id,
            label: tunnelLabel(profile.label, peer?.label, profile.interface_name),
            interfaceId: profile.interface_id,
            interfaceName: profile.interface_name,
            addresses:
              profile.addresses.length > 0 ? [...profile.addresses] : [...(peer?.addresses ?? [])],
            endpoint: profile.endpoint,
            publicKey: peer?.public_key ?? "",
          };
        }),
      );
    }
    return withPrimaryPeer(
      this.host.peers.map((peer) => ({
        peerId: peer.peer_id,
        label: tunnelLabel(peer.label, undefined, peer.interface_name),
        interfaceId: peer.interface_id,
        interfaceName: peer.interface_name,
        addresses: [...peer.addresses],
        endpoint: "",
        publicKey: peer.public_key,
      })),
    );
  }

  @computed
  get count(): number {
    return this.rows.length;
  }

  @computed
  get canRemove(): boolean {
    return this.count > 1 && !this.busy;
  }

  @computed
  get deleteHint(): string {
    return this.count <= 1 ? t("clients.details.tunnels.lastHint") : "";
  }

  @computed
  get interfaceOptions(): Option[] {
    const device = this.host.device;
    if (!device) return [];
    const fromRegistry = this.host.interfaces
      .filter((item) => item.enabled && interfaceFitsDevice(item, device))
      .map((item) => ({ value: item.id, label: item.name }));
    if (fromRegistry.length > 0) return fromRegistry;
    const seen = new Set<string>();
    const fromPeers: Option[] = [];
    for (const peer of this.host.peers) {
      if (seen.has(peer.interface_id)) continue;
      seen.add(peer.interface_id);
      fromPeers.push({ value: peer.interface_id, label: peer.interface_name });
    }
    return fromPeers;
  }

  @computed
  get interfaceLocked(): boolean {
    return this.interfaceOptions.length <= 1;
  }

  @computed
  get addLabelError(): string | null {
    return labelError(this.addLabel);
  }

  @computed
  get canAdd(): boolean {
    return (
      this.addOpen &&
      this.addInterfaceId.length > 0 &&
      this.addLabelError === null &&
      !this.addBusy
    );
  }

  @computed
  get renameLabelError(): string | null {
    return labelError(this.renameLabel);
  }

  @computed
  get canRename(): boolean {
    return (
      this.renameOpen &&
      this.renamePeerId.length > 0 &&
      this.renameLabelError === null &&
      !this.renameBusy
    );
  }

  @computed
  get label(): string {
    const count = this.count;
    return `${count} ${pluralI18n(count, "common.tunnels.one", "common.tunnels.few", "common.tunnels.many")}`;
  }

  @computed
  get countLabel(): string {
    return t("clients.details.tunnelsCount", { count: this.count });
  }

  resetUi(): void {
    this.addOpen = false;
    this.addInterfaceId = "";
    this.addLabel = "";
    this.addLabelEdited = false;
    this.renameOpen = false;
    this.renamePeerId = "";
    this.renameLabel = "";
  }

  openAdd(): void {
    if (this.addBusy || !this.host.device) return;
    const interfaceId = this.defaultInterfaceId();
    this.addInterfaceId = interfaceId;
    this.addLabel = this.interfaceNameFor(interfaceId);
    this.addLabelEdited = false;
    this.addOpen = true;
  }

  closeAdd(): void {
    if (this.addBusy) return;
    this.addOpen = false;
  }

  setAddInterface(value: string): void {
    const previous = this.interfaceNameFor(this.addInterfaceId);
    this.addInterfaceId = value;
    if (!this.addLabelEdited || this.addLabel.trim() === previous) {
      this.addLabel = this.interfaceNameFor(value);
      this.addLabelEdited = false;
    }
  }

  setAddLabel(event: Event): void {
    this.addLabel = (event.target as HTMLInputElement).value;
    this.addLabelEdited = true;
  }

  async add(): Promise<void> {
    const device = this.host.device;
    if (!device || !this.canAdd) return;
    const before = new Set(this.host.peers.map((peer) => peer.peer_id));
    this.addBusy = true;
    try {
      const updated = await this.host.devicesService.addTunnel(
        device.id,
        this.addInterfaceId,
        this.addLabel.trim(),
      );
      const added = updated.peers.find((peer) => !before.has(peer.peer_id));
      await this.applyUpdate(updated, added?.peer_id);
      this.addOpen = false;
      this.host.toasts.success(
        t("clients.details.toast.tunnelAdded", { label: added?.label ?? this.addLabel.trim() }),
      );
    } catch (error) {
      this.host.toasts.error(tunnelError(error, t("clients.details.error.tunnelAdd")));
    } finally {
      this.addBusy = false;
    }
  }

  openRename(tunnel: TunnelRow): void {
    if (this.renameBusy) return;
    this.renamePeerId = tunnel.peerId;
    this.renameLabel = tunnel.label;
    this.renameOpen = true;
  }

  closeRename(): void {
    if (this.renameBusy) return;
    this.renameOpen = false;
  }

  setRenameLabel(event: Event): void {
    this.renameLabel = (event.target as HTMLInputElement).value;
  }

  async rename(): Promise<void> {
    const device = this.host.device;
    if (!device || !this.canRename) return;
    const peerId = this.renamePeerId;
    this.renameBusy = true;
    try {
      const updated = await this.host.devicesService.renameTunnel(
        device.id,
        peerId,
        this.renameLabel.trim(),
      );
      const renamed = updated.peers.find((peer) => peer.peer_id === peerId);
      this.host.setDevice(updated);
      this.host.setProfiles(
        this.host.profiles.map((profile) =>
          profile.peer_id === peerId
            ? { ...profile, label: renamed?.label ?? profile.label }
            : profile,
        ),
      );
      this.renameOpen = false;
      this.host.toasts.success(
        t("clients.details.toast.tunnelRenamed", { label: renamed?.label ?? "" }),
      );
    } catch (error) {
      this.host.toasts.error(tunnelError(error, t("clients.details.error.tunnelRename")));
    } finally {
      this.renameBusy = false;
    }
  }

  async remove(peerId: string): Promise<void> {
    const device = this.host.device;
    const tunnel = this.rows.find((item) => item.peerId === peerId);
    if (!device || !tunnel || this.busy) return;
    if (!this.canRemove) {
      this.host.toasts.error(t("clients.details.tunnels.lastError"));
      return;
    }
    const confirmed = await askConfirm({
      title: t("clients.confirm.tunnelDeleteTitle"),
      message: t("clients.details.confirm.tunnelDelete", { label: tunnel.label }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await this.host.devicesService.deleteTunnel(device.id, peerId);
      await this.reload();
      this.host.toasts.success(t("clients.details.toast.tunnelDeleted"));
    } catch (error) {
      if (isConflict(error)) {
        this.host.toasts.error(t("clients.details.tunnels.lastError"));
      } else {
        this.host.toasts.error(userMessage(error, t("clients.details.error.tunnelDelete")));
      }
    } finally {
      this.busy = false;
    }
  }

  private defaultInterfaceId(): string {
    const options = this.interfaceOptions;
    const primary = this.host.device?.interface_id ?? "";
    if (options.some((option) => option.value === primary)) return primary;
    return options[0]?.value ?? "";
  }

  private interfaceNameFor(interfaceId: string): string {
    const option = this.interfaceOptions.find((item) => item.value === interfaceId);
    if (option) return option.label;
    return this.host.interfaceName(interfaceId);
  }

  private async applyUpdate(updated: Device, selectPeerId?: string): Promise<void> {
    this.host.setDevice(updated);
    const profiles = await this.host.devicesService
      .listProfiles(updated.id)
      .catch(() => this.host.profiles);
    this.host.setProfiles(profiles);
    if (selectPeerId && profiles.some((profile) => profile.peer_id === selectPeerId)) {
      this.host.setActivePeer(selectPeerId);
    }
    this.host.syncSelection();
  }

  private async reload(): Promise<void> {
    const device = this.host.device;
    if (!device) return;
    const [fresh, profiles] = await Promise.all([
      this.host.devicesService.getDevice(device.id),
      this.host.devicesService.listProfiles(device.id),
    ]);
    this.host.setDevice(fresh);
    this.host.setProfiles(profiles);
    this.host.syncSelection();
  }
}

function labelError(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed.length === 0) return t("clients.details.tunnels.labelRequired");
  if (trimmed.length > PEER_LABEL_MAX) {
    return t("clients.details.tunnels.labelTooLong", { max: PEER_LABEL_MAX });
  }
  return null;
}
