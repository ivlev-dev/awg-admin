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
import { TunnelForm } from "./tunnels.form";

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
};

export class TunnelSection {
  private host!: TunnelHost;

  readonly form = new TunnelForm({ formId: "device-tunnel", validateOnInput: true });

  attach(host: TunnelHost): void {
    this.host = host;
  }

  @reactive accessor busy = false;
  @reactive accessor addOpen = false;
  @reactive accessor addBusy = false;
  @reactive accessor renameOpen = false;
  @reactive accessor renamePeerId = "";
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
  get addInterfaceId(): string {
    return this.form.interfaceId;
  }

  @computed
  get addLabel(): string {
    return this.form.addLabel;
  }

  @computed
  get renameLabel(): string {
    return this.form.renameLabel;
  }

  @computed
  get addLabelError(): string | null {
    return this.form.getFieldProps("addLabel").error ?? null;
  }

  @computed
  get canAdd(): boolean {
    return (
      this.addOpen &&
      this.form.interfaceId.length > 0 &&
      isAddLabelValid(this.form.addLabel) &&
      this.addLabelError === null &&
      !this.addBusy
    );
  }

  @computed
  get renameLabelError(): string | null {
    return this.form.getFieldProps("renameLabel").error ?? null;
  }

  @computed
  get canRename(): boolean {
    return (
      this.renameOpen &&
      this.renamePeerId.length > 0 &&
      isRenameLabelValid(this.form.renameLabel) &&
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
    this.renameOpen = false;
    this.renamePeerId = "";
    this.addLabelEdited = false;
    this.form.reset();
    this.form.mode = "add";
    this.form.interfaceId = "";
    this.form.addLabel = "";
    this.form.renameLabel = "";
  }

  dispose(): void {
    this.form.dispose();
  }

  openAdd(): void {
    if (this.addBusy || !this.host.device) return;
    this.form.reset();
    this.form.mode = "add";
    const interfaceId = this.defaultInterfaceId();
    this.form.interfaceId = interfaceId;
    this.form.addLabel = this.interfaceNameFor(interfaceId);
    this.addLabelEdited = false;
    this.addOpen = true;
  }

  closeAdd(): void {
    if (this.addBusy) return;
    this.addOpen = false;
  }

  setAddInterface(value: string): void {
    const previous = this.interfaceNameFor(this.form.interfaceId);
    this.form.interfaceId = value;
    if (!this.addLabelEdited || this.form.addLabel.trim() === previous) {
      this.form.addLabel = this.interfaceNameFor(value);
      this.addLabelEdited = false;
    }
    void this.form.validateField("interfaceId");
    void this.form.validateField("addLabel");
  }

  setAddLabel(event: Event): void {
    this.form.getFieldProps("addLabel").onInput(event);
    this.addLabelEdited = true;
  }

  async add(): Promise<void> {
    const device = this.host.device;
    if (!device || !this.canAdd) return;
    this.form.mode = "add";
    await this.form.onSubmit(async (submitted) => {
      if (!submitted.isValid) return;
      const before = new Set(this.host.peers.map((peer) => peer.peer_id));
      this.addBusy = true;
      try {
        const updated = await this.host.devicesService.addTunnel(
          device.id,
          submitted.interfaceId,
          submitted.addLabel.trim(),
        );
        const added = updated.peers.find((peer) => !before.has(peer.peer_id));
        await this.applyUpdate(updated, added?.peer_id);
        this.addOpen = false;
        this.host.toasts.success(
          t("clients.details.toast.tunnelAdded", { label: added?.label ?? submitted.addLabel.trim() }),
        );
      } catch (error) {
        const message = tunnelError(error, t("clients.details.error.tunnelAdd"));
        if (isConflict(error)) submitted.setFieldErrors("addLabel", [message]);
        this.host.toasts.error(message);
      } finally {
        this.addBusy = false;
      }
    })();
  }

  openRename(tunnel: TunnelRow): void {
    if (this.renameBusy) return;
    this.form.reset();
    this.form.mode = "rename";
    this.renamePeerId = tunnel.peerId;
    this.form.renameLabel = tunnel.label;
    this.renameOpen = true;
  }

  closeRename(): void {
    if (this.renameBusy) return;
    this.renameOpen = false;
  }

  setRenameLabel(event: Event): void {
    this.form.getFieldProps("renameLabel").onInput(event);
  }

  async rename(): Promise<void> {
    const device = this.host.device;
    if (!device || !this.canRename) return;
    this.form.mode = "rename";
    await this.form.onSubmit(async (submitted) => {
      if (!submitted.isValid) return;
      const peerId = this.renamePeerId;
      this.renameBusy = true;
      try {
        const updated = await this.host.devicesService.renameTunnel(
          device.id,
          peerId,
          submitted.renameLabel.trim(),
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
        const message = tunnelError(error, t("clients.details.error.tunnelRename"));
        if (isConflict(error)) submitted.setFieldErrors("renameLabel", [message]);
        this.host.toasts.error(message);
      } finally {
        this.renameBusy = false;
      }
    })();
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

function isAddLabelValid(label: string): boolean {
  return [...label].length <= PEER_LABEL_MAX;
}

function isRenameLabelValid(label: string): boolean {
  const trimmed = label.trim();
  return trimmed.length > 0 && [...trimmed].length <= PEER_LABEL_MAX;
}
