import { ViewModel, computed, reactive, watch } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import type { InterfacesService } from "@/application/interfaces/service";
import type { QuotaService, QuotaUsageView } from "@/application/quota/service";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import {
  invalidate,
  lookupInterfaces,
  lookupOwnerDevices,
  lookupQuotaForUser,
  lookupQuotaMe,
} from "@/app/lookups";
import type { DevicePeer, DeviceStats } from "@/domain/devices/types";
import type {
  Device,
  InterfaceInfo,
  Profile,
  ShareFormat,
  ShareLink,
  ShareLinkState,
} from "@/domain/types";
import { t } from "@/i18n";

import { EditSection } from "./details/edit";
import { ForwardingSection } from "./details/forwarding";
import { DeviceLifecycle } from "./details/lifecycle";
import { forwardingPayload } from "./details/model";
import { ProfileActions } from "./details/profile-actions";
import { ShareSection } from "./details/share";
import { ClientSummarySection } from "./details/summary";
import { TunnelSection } from "./details/tunnels";
import type { ClientEditState, ForwardingMode, ForwardingPair, ForwardingRow, Option, TunnelRow, TunnelSeed } from "./details/types";

export type { ClientEditState, ForwardingMode, ForwardingPair, ForwardingRow, Option, TunnelRow, TunnelSeed };
export { MAX_SHARE_USES, SHARE_STATE_KEYS } from "./details/types";

export class ClientDetailsVM extends ViewModel {
  @reactive accessor device: Device | null = null;
  @reactive accessor profiles: Profile[] = [];
  @reactive accessor shares: ShareLink[] = [];
  @reactive accessor stats: DeviceStats | null = null;
  @reactive accessor allDevices: Device[] = [];
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor ownerQuota: QuotaUsageView | null = null;
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;

  @reactive accessor activePeerId = "";
  @reactive accessor shareInterfaceId = "";

  private loadGeneration = 0;

  private readonly editSection: EditSection;
  private readonly forwardingSection: ForwardingSection;
  private readonly tunnelSection: TunnelSection;
  private readonly shareSection: ShareSection;
  private readonly summarySection: ClientSummarySection;
  private readonly profileActions: ProfileActions;
  private readonly lifecycle: DeviceLifecycle;

  constructor(
    private readonly devicesService: DevicesService,
    private readonly interfacesService: InterfacesService,
    private readonly quotaService: QuotaService,
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    super();
    const self = this;
    this.editSection = new EditSection();
    this.forwardingSection = new ForwardingSection();
    this.tunnelSection = new TunnelSection();
    this.shareSection = new ShareSection();
    this.summarySection = new ClientSummarySection();
    this.profileActions = new ProfileActions();
    this.lifecycle = new DeviceLifecycle();
    this.editSection.attach({
      get device() {
        return self.device;
      },
      devicesService: this.devicesService,
      toasts: this.toasts,
      setDevice: (device) => {
        self.device = device;
      },
      buildForwarding: (mode, allowed) =>
        forwardingPayload(mode, self.forwardingSection.orderedAllowed(allowed)),
      applyRowFromDevice: (device) => {
        self.forwardingSection.applyRowFromDevice(device);
      },
    });
    this.forwardingSection.attach({
      get device() {
        return self.device;
      },
      get allDevices() {
        return self.allDevices;
      },
      devicesService: this.devicesService,
      toasts: this.toasts,
      setDevice: (device) => {
        self.device = device;
      },
      applyFormForwarding: (mode, allowed) => {
        self.editSection.setForwarding(mode, allowed);
      },
      refreshSnapshotForwarding: (mode, allowed) => {
        self.editSection.refreshForwarding(mode, allowed);
      },
    });
    this.tunnelSection.attach({
      get device() {
        return self.device;
      },
      get profiles() {
        return self.profiles;
      },
      get peers() {
        return self.peers;
      },
      get interfaces() {
        return self.interfaces;
      },
      get activePeerId() {
        return self.activePeerId;
      },
      devicesService: this.devicesService,
      toasts: this.toasts,
      setDevice: (device) => {
        self.device = device;
      },
      setProfiles: (profiles) => {
        self.profiles = profiles;
      },
      setActivePeer: (peerId) => {
        self.activePeerId = peerId;
      },
      interfaceName: (interfaceId) => self.interfaceName(interfaceId),
      syncSelection: () => self.syncTunnelSelection(),
    });
    this.shareSection.attach({
      get device() {
        return self.device;
      },
      get shareInterfaceId() {
        return self.shareInterfaceId;
      },
      get shares() {
        return self.shares;
      },
      set shares(value) {
        self.shares = value;
      },
      devicesService: this.devicesService,
      toasts: this.toasts,
    });
    this.summarySection.attach({
      get device() {
        return self.device;
      },
      get stats() {
        return self.stats;
      },
      get profiles() {
        return self.profiles;
      },
      get allDevices() {
        return self.allDevices;
      },
      get ownerQuota() {
        return self.ownerQuota;
      },
    });
    this.profileActions.attach({
      get device() {
        return self.device;
      },
      get profiles() {
        return self.profiles;
      },
      get peers() {
        return self.peers;
      },
      get activePeerId() {
        return self.activePeerId;
      },
      toasts: this.toasts,
    });
    this.lifecycle.attach({
      get device() {
        return self.device;
      },
      devicesService: this.devicesService,
      toasts: this.toasts,
      back: () => self.back(),
    });
  }

  override created(): void {
    void this.load();
  }

  override unmounted(): void {
    this.editSection.dispose();
    this.tunnelSection.dispose();
    this.shareSection.dispose();
  }

  override dispose(): void {
    this.editSection.dispose();
    this.tunnelSection.dispose();
    this.shareSection.dispose();
    super.dispose();
  }

  @computed get deviceId(): string {
    return this.router.params["id"] ?? "";
  }

  @watch((vm: ClientDetailsVM) => vm.deviceId)
  onDeviceChange(next: string, previous: string | undefined): void {
    if (previous === undefined || next === previous || next.length === 0) return;
    void this.load();
  }

  @computed get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed get peers(): DevicePeer[] {
    return this.device?.peers ?? [];
  }

  @computed get activeProfile(): Profile | null {
    return this.profileActions.activeProfile;
  }

  @computed get shareInterfaceOptions(): Option[] {
    return this.summarySection.shareInterfaceOptions;
  }

  @computed get addresses(): string[] {
    return this.summarySection.addresses;
  }

  @computed get interfaceLabel(): string {
    return this.summarySection.interfaceLabel;
  }

  @computed get nodeLabel(): string {
    return this.summarySection.nodeLabel;
  }

  @computed get downLabel(): string {
    return this.summarySection.downLabel;
  }

  @computed get upLabel(): string {
    return this.summarySection.upLabel;
  }

  @computed get forwardingLabel(): string {
    return this.summarySection.forwardingLabel;
  }

  @computed get revoked(): boolean {
    return this.summarySection.revoked;
  }

  @computed get todayRx(): string {
    return this.summarySection.todayRx;
  }

  @computed get todayTx(): string {
    return this.summarySection.todayTx;
  }

  @computed get monthRx(): string {
    return this.summarySection.monthRx;
  }

  @computed get monthTx(): string {
    return this.summarySection.monthTx;
  }

  @computed get quotaView() {
    return this.summarySection.quotaView;
  }

  @computed get quotaExceeded(): boolean {
    return this.summarySection.quotaExceeded;
  }

  @computed get quotaUsageLabel(): string {
    return this.summarySection.quotaUsageLabel;
  }

  @computed get rateLimitHint(): string {
    return this.summarySection.rateLimitHint;
  }

  @computed get otherDevices(): Device[] {
    return this.summarySection.otherDevices;
  }

  @computed get tunnels(): TunnelRow[] { return this.tunnelSection.rows; }

  @computed get tunnelCount(): number { return this.tunnelSection.count; }

  @computed get canRemoveTunnel(): boolean { return this.tunnelSection.canRemove; }

  @computed get tunnelDeleteHint(): string { return this.tunnelSection.deleteHint; }

  @computed get tunnelInterfaceOptions(): Option[] { return this.tunnelSection.interfaceOptions; }

  @computed get addTunnelInterfaceLocked(): boolean { return this.tunnelSection.interfaceLocked; }

  @computed get addTunnelLabelError(): string | null { return this.tunnelSection.addLabelError; }

  @computed get canAddTunnel(): boolean { return this.tunnelSection.canAdd; }

  @computed get renameTunnelLabelError(): string | null { return this.tunnelSection.renameLabelError; }

  @computed get canRenameTunnel(): boolean { return this.tunnelSection.canRename; }

  @computed get tunnelsLabel(): string { return this.tunnelSection.label; }

  @computed get tunnelsCountLabel(): string { return this.tunnelSection.countLabel; }

  @computed get forwardingModeOptions(): Array<{ value: ForwardingMode; label: string; hint?: string }> {
    return this.editSection.forwardingModeOptions;
  }

  @computed get forwardingError(): string | null { return this.editSection.forwardingError; }

  @computed get forwardingBulk(): boolean { return this.forwardingSection.bulk; }

  @computed get forwardingMatrixReady(): boolean { return this.forwardingSection.matrixReady; }

  @computed get forwardingPairs(): ForwardingPair[] { return this.forwardingSection.pairs; }

  @computed get canSave(): boolean { return this.editSection.canSave; }

  get editForm() { return this.editSection.form; }

  @computed get editDirty(): boolean { return this.editSection.dirty; }

  @computed get canCreateShare(): boolean { return this.shareSection.canCreate; }

  get shareForm() { return this.shareSection.form; }

  get tunnelForm() { return this.tunnelSection.form; }

  @computed get shareMaxUsesInvalid(): boolean { return this.shareSection.maxUsesInvalid; }

  @computed get shareMaxUsesValue(): number | undefined { return this.shareSection.maxUsesValue; }

  @computed get hasActiveShares(): boolean { return this.shareSection.hasActive; }

  @computed get ttlOptions(): Array<{ value: number; label: string }> { return this.shareSection.ttlOptions; }

  @computed get formatOptions(): Array<{ value: ShareFormat; label: string }> { return this.shareSection.formatOptions; }

  @computed get canShowVpnQr(): boolean { return this.profileActions.canShowVpnQr; }

  @computed get canShowConfQr(): boolean { return this.profileActions.canShowConfQr; }
  get qrOpen(): boolean { return this.profileActions.qrOpen; }
  get qrValue(): string { return this.profileActions.qrValue; }
  get qrTitle(): string { return this.profileActions.qrTitle; }
  get qrCopyLabel(): string { return this.profileActions.qrCopyLabel; }
  get saving(): boolean { return this.editSection.saving; }
  get actionBusy(): boolean { return this.lifecycle.busy; }
  get shareFormat(): ShareFormat { return this.shareSection.format; }
  get shareTtl(): number { return this.shareSection.ttl; }
  get shareOneTime(): boolean { return this.shareSection.oneTime; }
  get shareMaxUses(): string { return this.shareSection.maxUses; }
  get shareBusy(): boolean { return this.shareSection.busy; }
  get tunnelBusy(): boolean { return this.tunnelSection.busy; }
  get addTunnelOpen(): boolean { return this.tunnelSection.addOpen; }
  get addTunnelInterfaceId(): string { return this.tunnelSection.addInterfaceId; }
  get addTunnelLabel(): string { return this.tunnelSection.addLabel; }
  get addTunnelBusy(): boolean { return this.tunnelSection.addBusy; }
  get renameTunnelOpen(): boolean { return this.tunnelSection.renameOpen; }
  get renameTunnelPeerId(): string { return this.tunnelSection.renamePeerId; }
  get renameTunnelLabel(): string { return this.tunnelSection.renameLabel; }
  get renameTunnelBusy(): boolean { return this.tunnelSection.renameBusy; }
  get editName(): string { return this.editSection.form.name; }
  set editName(value: string) { this.editSection.form.name = value; }
  get editDownKbps(): number { return this.editSection.form.downKbps; }
  get editUpKbps(): number { return this.editSection.form.upKbps; }
  get forwardingMode(): ForwardingMode { return this.editSection.forwardingMode; }
  get forwardingSelected(): string[] { return this.editSection.forwardingSelected; }
  get forwardingRows(): ForwardingRow[] { return this.forwardingSection.rows; }
  get forwardingSymmetric(): boolean { return this.forwardingSection.symmetric; }
  get forwardingBusy(): boolean { return this.forwardingSection.busy; }

  async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const id = this.deviceId;
    if (!id) {
      this.loading = false;
      return;
    }
    const firstLoad = this.device === null;
    this.loading = firstLoad;
    this.error = null;
    this.profileActions.resetQr();
    if (firstLoad) {
      this.profiles = [];
      this.shares = [];
      this.stats = null;
      this.allDevices = [];
      this.interfaces = [];
      this.forwardingSection.rows = [];
      this.ownerQuota = null;
      this.activePeerId = "";
      this.shareInterfaceId = "";
      this.shareSection.resetForm();
      this.tunnelSection.resetUi();
    }
    try {
      const devicePromise: Promise<Device> = this.devicesService.getDevice(id);
      const profilesPromise: Promise<Profile[]> = this.devicesService.listProfiles(id);
      const sharesPromise: Promise<ShareLink[]> = this.devicesService.listShares(id);
      const statsPromise: Promise<DeviceStats> = this.devicesService.deviceStats(id);
      const interfacesPromise: Promise<InterfaceInfo[]> = lookupInterfaces(this.interfacesService)
        .catch(() => []);
      const [device, profiles, shares, stats, interfaces] = await Promise.all([
        devicePromise,
        profilesPromise,
        sharesPromise,
        statsPromise,
        interfacesPromise,
      ]);
      if (generation !== this.loadGeneration) return;
      const devicesPromise: Promise<Device[]> = lookupOwnerDevices(
        this.devicesService,
        device.user_id,
      ).catch(() => [] as Device[]);
      const quotaPromise = this.loadOwnerQuota(device);
      const [devices, quota] = await Promise.all([devicesPromise, quotaPromise]);
      if (generation !== this.loadGeneration) return;
      this.device = device;
      this.profiles = profiles;
      this.shares = shares;
      this.stats = stats;
      this.allDevices = devices;
      this.interfaces = interfaces;
      this.ownerQuota = quota;
      this.forwardingSection.buildRows(device);
      this.editSection.hydrate(device);
      this.syncTunnelSelection();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      const message = userMessage(error, t("clients.details.error.load"));
      this.error = message;
      this.toasts.error(message);
    } finally {
      if (generation === this.loadGeneration) this.loading = false;
    }
  }

  setEditName(event: Event): void { this.editSection.setName(event); }

  setEditDownKbps(value: number): void { this.editSection.setDownKbps(value); }

  setEditUpKbps(value: number): void { this.editSection.setUpKbps(value); }

  setForwardingMode(value: string): void { this.editSection.setMode(value); }

  setForwardingSymmetric(event: Event): void { this.forwardingSection.setSymmetric(event); }

  isForwardingSelected(id: string): boolean { return this.editSection.isSelected(id); }

  toggleForwardingSelected(id: string): void { this.editSection.toggleSelected(id); }

  isForwardingCellChecked(rowId: string, targetId: string): boolean {
    return this.forwardingSection.isCellChecked(rowId, targetId);
  }

  isForwardingCellDisabled(rowId: string, targetId: string): boolean {
    return this.forwardingSection.isCellDisabled(rowId, targetId);
  }

  forwardingPairTitle(rowId: string, targetId: string): string {
    return this.forwardingSection.pairTitle(rowId, targetId);
  }

  async setForwardingRowMode(rowId: string, value: string): Promise<void> {
    await this.forwardingSection.setRowMode(rowId, value);
    this.invalidateDevices();
  }

  async toggleForwardingCell(rowId: string, targetId: string): Promise<void> {
    await this.forwardingSection.toggleCell(rowId, targetId);
    this.invalidateDevices();
  }

  async toggleForwardingPair(aId: string, bId: string): Promise<void> {
    await this.forwardingSection.togglePair(aId, bId);
    this.invalidateDevices();
  }

  selectProfile(peerId: string): void { this.activePeerId = peerId; }

  profileLabel(profile: Profile): string { return this.profileActions.profileLabel(profile); }

  profileInterfaceHint(profile: Profile): string {
    return this.profileActions.profileInterfaceHint(profile);
  }

  openAddTunnel(): void { this.tunnelSection.openAdd(); }

  closeAddTunnel(): void { this.tunnelSection.closeAdd(); }

  setAddTunnelInterface(value: string): void { this.tunnelSection.setAddInterface(value); }

  setAddTunnelLabel(event: Event): void { this.tunnelSection.setAddLabel(event); }

  async addTunnel(): Promise<void> { await this.tunnelSection.add(); this.invalidateDevices(); }

  openRenameTunnel(tunnel: TunnelRow): void { this.tunnelSection.openRename(tunnel); }

  closeRenameTunnel(): void { this.tunnelSection.closeRename(); }

  setRenameTunnelLabel(event: Event): void { this.tunnelSection.setRenameLabel(event); }

  async renameTunnel(): Promise<void> { await this.tunnelSection.rename(); this.invalidateDevices(); }

  async removeTunnel(peerId: string): Promise<void> { await this.tunnelSection.remove(peerId); this.invalidateDevices(); }

  setShareInterface(value: string): void { this.shareInterfaceId = value; }

  setShareFormat(value: string): void { this.shareSection.setFormat(value); }

  setShareTtl(value: string): void { this.shareSection.setTtl(value); }

  setShareOneTime(event: Event): void { this.shareSection.setOneTime(event); }

  setShareMaxUses(value: string): void { this.shareSection.setMaxUses(value); }

  async cancelEdit(): Promise<void> { await this.editSection.cancel(); }

  async save(): Promise<void> { await this.editSection.save(); this.invalidateDevices(); }
  async revoke(): Promise<void> { await this.lifecycle.revoke(); this.invalidateDevices(); }
  async remove(): Promise<void> { await this.lifecycle.remove(); this.invalidateDevices(); }
  async createShare(): Promise<void> { await this.shareSection.create(); }

  async revokeShare(token: string): Promise<void> { await this.shareSection.revoke(token); }

  async revokeAllShares(): Promise<void> { await this.shareSection.revokeAll(); }

  shareStateLabel(state: ShareLinkState): string { return this.shareSection.stateLabel(state); }

  shareStateClass(state: ShareLinkState): string { return this.shareSection.stateClass(state); }

  shareUsesLabel(share: ShareLink): string { return this.shareSection.usesLabel(share); }
  async copyText(value: string, label: string): Promise<void> {
    await this.profileActions.copyText(value, label);
  }

  copyProfile(): void { this.profileActions.copyProfile(); }

  copyVpn(): void { this.profileActions.copyVpn(); }

  openShareQr(share: ShareLink): void { this.profileActions.openShareQr(share); }

  openVpnQr(): void { this.profileActions.openVpnQr(); }

  openConfQr(): void { this.profileActions.openConfQr(); }

  closeQr(): void { this.profileActions.closeQr(); }

  copyQrValue(): void { this.profileActions.copyQrValue(); }

  downloadProfile(): void { this.profileActions.downloadProfile(); }

  interfaceName(interfaceId: string): string {
    return this.profileActions.interfaceName(interfaceId);
  }

  scrollToSection(id: string): void {
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    const heading = target.querySelector<HTMLElement>("h2, h3");
    const focusTarget = heading ?? target;
    focusTarget.focus({ preventScroll: true });
  }

  back(): void {
    this.router.navigate("/clients");
  }

  private syncTunnelSelection(): void {
    const profiles = this.profiles;
    if (!profiles.some((profile) => profile.peer_id === this.activePeerId)) {
      this.activePeerId = profiles[0]?.peer_id ?? "";
    }
    if (!profiles.some((profile) => profile.interface_id === this.shareInterfaceId)) {
      this.shareInterfaceId = profiles[0]?.interface_id ?? "";
    }
  }

  private invalidateDevices(): void {
    invalidate("devices", this.devicesService);
  }

  private async loadOwnerQuota(device: Device): Promise<QuotaUsageView | null> {    try {
      return this.isAdmin
        ? await lookupQuotaForUser(this.quotaService, device.user_id)
        : await lookupQuotaMe(this.quotaService);
    } catch {
      return null;
    }
  }
}
