import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaService, QuotaUsageView } from "@/application/quota/service";
import type { DevicesService } from "@/application/devices/service";
import type { GroupsService } from "@/application/groups/service";
import { askConfirm } from "@/app/confirm";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { copyText } from "@/domain/clipboard";
import type { DeviceStats } from "@/domain/devices/types";
import type {
  Device,
  Forwarding,
  Group,
  PeerInfo,
  Profile,
  ShareFormat,
  ShareLink,
  ShareLinkState,
} from "@/domain/types";
import { t, type TranslationKey } from "@/i18n";
import { formatBytesI18n, formatRateI18n } from "@/i18n/format";

export type ForwardingMode = "off" | "all" | "selected";

export interface ForwardingRow {
  id: string;
  name: string;
  addresses: string[];
  mode: ForwardingMode;
  allowed: string[];
}

export interface ForwardingPair {
  aId: string;
  bId: string;
  label: string;
  allowed: boolean;
  detail: string;
  disabled: boolean;
}

const FORWARDING_MODES: ForwardingMode[] = ["off", "all", "selected"];

const FORWARDING_MODE_KEYS: Record<ForwardingMode, TranslationKey> = {
  off: "clients.details.forwarding.mode.off",
  all: "clients.details.forwarding.mode.all",
  selected: "clients.details.forwarding.mode.selected",
};

export const SHARE_STATE_KEYS: Record<ShareLinkState, TranslationKey> = {
  active: "clients.details.share.state.active",
  expired: "clients.details.share.state.expired",
  exhausted: "clients.details.share.state.exhausted",
  revoked: "clients.details.share.state.revoked",
};

export const SHARE_MAX_USES_LIMIT = 1000;

export interface ClientEditState {
  readonly name: string;
  readonly downKbps: number;
  readonly upKbps: number;
  readonly forwardingMode: ForwardingMode;
  readonly forwardingSelected: readonly string[];
}

export class ClientDetailsVM {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly groupsService: GroupsService,
    private readonly quotaService: QuotaService,
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {}

  @reactive accessor device: Device | null = null;
  @reactive accessor profiles: Profile[] = [];
  @reactive accessor shares: ShareLink[] = [];
  @reactive accessor stats: DeviceStats | null = null;
  @reactive accessor allDevices: Device[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor ownerQuota: QuotaUsageView | null = null;
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor actionBusy = false;

  @reactive accessor activeProfileId = "";
  @reactive accessor shareInterfaceId = "";
  @reactive accessor shareFormat: ShareFormat = "conf";
  @reactive accessor shareTtl = 86400;
  @reactive accessor shareOneTime = false;
  @reactive accessor shareMaxUses = "";
  @reactive accessor shareBusy = false;

  @reactive accessor qrOpen = false;
  @reactive accessor qrValue = "";
  @reactive accessor qrTitle = "";
  @reactive accessor qrCopyLabel = "";

  @reactive accessor editName = "";
  @reactive accessor editDownKbps = 0;
  @reactive accessor editUpKbps = 0;
  @reactive accessor forwardingMode: ForwardingMode = "off";
  @reactive accessor forwardingSelected: string[] = [];
  @reactive accessor forwardingRows: ForwardingRow[] = [];
  @reactive accessor forwardingSymmetric = true;
  @reactive accessor forwardingBusy = false;

  @reactive private accessor editSnapshot: ClientEditState | null = null;

  created(): void {
    void this.load();
  }

  @computed
  get deviceId(): string {
    return this.router.params["id"] ?? "";
  }

  @watch((vm: ClientDetailsVM) => vm.deviceId)
  onDeviceChange(next: string, previous: string | undefined): void {
    if (previous === undefined || next === previous || next.length === 0) return;
    void this.load();
  }

  @computed
  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get activeProfile(): Profile | null {
    const current = this.profiles.find((profile) => profile.interface_id === this.activeProfileId);
    return current ?? this.profiles[0] ?? null;
  }

  @computed
  get peers(): PeerInfo[] {
    return this.device?.peers ?? [];
  }

  @computed
  get addresses(): string[] {
    return this.device?.addresses ?? [];
  }

  @computed
  get groupLabel(): string {
    const device = this.device;
    if (!device || !device.group_id) return t("clients.group.none");
    if (!this.isAdmin) {
      return device.group_id === this.session.user?.group_id
        ? t("clients.details.group.own")
        : device.group_id;
    }
    return this.groups.find((group) => group.id === device.group_id)?.name ?? device.group_id;
  }

  @computed
  get downLabel(): string {
    return formatRateI18n(this.device?.down_kbps ?? 0);
  }

  @computed
  get upLabel(): string {
    return formatRateI18n(this.device?.up_kbps ?? 0);
  }

  @computed
  get forwardingLabel(): string {
    const forwarding = this.device?.forwarding;
    const mode = modeOfForwarding(forwarding);
    if (mode === "all") return t("clients.details.forwarding.all");
    if (mode === "selected") {
      return t("clients.details.forwarding.selected", {
        count: forwarding?.allowed_devices.length ?? 0,
      });
    }
    return t("clients.details.forwarding.none");
  }

  @computed
  get revoked(): boolean {
    return this.device?.revoked ?? false;
  }

  @computed
  get todayRx(): string {
    return formatBytesI18n(this.stats?.today.rx ?? 0);
  }

  @computed
  get todayTx(): string {
    return formatBytesI18n(this.stats?.today.tx ?? 0);
  }

  @computed
  get monthRx(): string {
    return formatBytesI18n(this.stats?.month.rx ?? 0);
  }

  @computed
  get monthTx(): string {
    return formatBytesI18n(this.stats?.month.tx ?? 0);
  }

  @computed
  get quotaView(): QuotaDisplay {
    return quotaDisplay(this.ownerQuota);
  }

  @computed
  get quotaExceeded(): boolean {
    return this.ownerQuota?.exceeded ?? false;
  }

  @computed
  get quotaUsageLabel(): string {
    if (!this.ownerQuota) return "";
    return t("clients.details.quotaUsage", {
      used: this.quotaView.usedLabel,
      limit: this.quotaView.limitLabel,
    });
  }

  @computed
  get rateLimitHint(): string {
    return this.quotaExceeded ? t("clients.details.rateLimit") : "";
  }

  @computed
  get otherDevices(): Device[] {
    const device = this.device;
    if (!device) return [];
    return this.allDevices.filter(
      (item) => item.user_id === device.user_id && item.id !== device.id && !item.revoked,
    );
  }

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
    const device = this.device;
    if (device && this.forwardingSelected.includes(device.id)) {
      return t("clients.details.forwarding.errorSelf");
    }
    if (this.forwardingSelected.length === 0) {
      return t("clients.details.forwarding.errorEmpty");
    }
    return null;
  }

  @computed
  get forwardingBulk(): boolean {
    return this.forwardingRows.some((row) => row.mode === "all");
  }

  @computed
  get forwardingMatrixReady(): boolean {
    return this.forwardingRows.length > 1;
  }

  @computed
  get forwardingPairs(): ForwardingPair[] {
    const rows = this.forwardingRows;
    const pairs: ForwardingPair[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i];
      if (!a) continue;
      for (let j = i + 1; j < rows.length; j += 1) {
        const b = rows[j];
        if (!b) continue;
        const forward = this.rowAllows(a, b.id);
        const backward = this.rowAllows(b, a.id);
        const label = `${a.name} ↔ ${b.name}`;
        const detail = forward && backward
          ? t("clients.details.forwarding.pairAllowed")
          : forward
            ? t("clients.details.forwarding.pairOnly", { from: a.name, to: b.name })
            : backward
              ? t("clients.details.forwarding.pairOnly", { from: b.name, to: a.name })
              : t("clients.details.forwarding.pairDenied");
        pairs.push({
          aId: a.id,
          bId: b.id,
          label,
          allowed: forward && backward,
          detail,
          disabled: this.forwardingBusy || a.mode === "all" || b.mode === "all",
        });
      }
    }
    return pairs;
  }

  @computed
  get canSave(): boolean {
    return (
      this.device !== null &&
      this.editName.trim().length > 0 &&
      !this.saving &&
      this.forwardingError === null
    );
  }

  @computed
  get editDirty(): boolean {
    const snapshot = this.editSnapshot;
    if (snapshot === null) return false;
    const current = this.editState();
    return (
      current.name !== snapshot.name ||
      current.downKbps !== snapshot.downKbps ||
      current.upKbps !== snapshot.upKbps ||
      current.forwardingMode !== snapshot.forwardingMode ||
      !sameIds(current.forwardingSelected, snapshot.forwardingSelected)
    );
  }

  @computed
  get canCreateShare(): boolean {
    return (
      this.device !== null &&
      this.shareInterfaceId.length > 0 &&
      !this.shareBusy &&
      !this.shareMaxUsesInvalid
    );
  }

  @computed
  get shareMaxUsesInvalid(): boolean {
    if (this.shareOneTime) return false;
    const raw = this.shareMaxUses.trim();
    if (raw.length === 0) return false;
    const parsed = Number(raw);
    return (
      !Number.isInteger(parsed) || parsed < 1 || parsed > SHARE_MAX_USES_LIMIT
    );
  }

  @computed
  get shareMaxUsesValue(): number | undefined {
    if (this.shareOneTime || this.shareMaxUsesInvalid) return undefined;
    const raw = this.shareMaxUses.trim();
    if (raw.length === 0) return undefined;
    return Number(raw);
  }

  @computed
  get hasActiveShares(): boolean {
    return this.shares.some((share) => share.state === "active");
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

  @computed
  get canShowVpnQr(): boolean {
    return (this.activeProfile?.vpn_link.length ?? 0) > 0;
  }

  async load(): Promise<void> {
    const id = this.deviceId;
    if (!id) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.error = null;
    this.device = null;
    this.profiles = [];
    this.shares = [];
    this.stats = null;
    this.allDevices = [];
    this.forwardingRows = [];
    this.groups = [];
    this.ownerQuota = null;
    this.activeProfileId = "";
    this.shareInterfaceId = "";
    this.shareOneTime = false;
    this.shareMaxUses = "";
    this.qrOpen = false;
    this.qrValue = "";
    this.qrTitle = "";
    this.qrCopyLabel = "";
    try {
      const groupsPromise: Promise<Group[]> = this.isAdmin
        ? this.groupsService.listGroups()
        : Promise.resolve([]);
      const devicePromise: Promise<Device> = this.devicesService.getDevice(id);
      const profilesPromise: Promise<Profile[]> = this.devicesService.listProfiles(id);
      const sharesPromise: Promise<ShareLink[]> = this.devicesService.listShares(id);
      const statsPromise: Promise<DeviceStats> = this.devicesService.deviceStats(id);
      const devicesPromise: Promise<Device[]> = this.devicesService.listDevices();
      const [device, profiles, shares, stats, devices, groups] = await Promise.all([
        devicePromise,
        profilesPromise,
        sharesPromise,
        statsPromise,
        devicesPromise,
        groupsPromise,
      ]);
      this.device = device;
      this.profiles = profiles;
      this.shares = shares;
      this.stats = stats;
      this.allDevices = devices;
      this.groups = groups;
      this.buildForwardingRows(device);
      this.hydrateForm(device);
      await this.loadOwnerQuota(device);
      if (!profiles.some((profile) => profile.interface_id === this.activeProfileId)) {
        this.activeProfileId = profiles[0]?.interface_id ?? "";
      }
      if (!profiles.some((profile) => profile.interface_id === this.shareInterfaceId)) {
        this.shareInterfaceId = profiles[0]?.interface_id ?? "";
      }
    } catch (error) {
      const message = messageOf(error, t("clients.details.error.load"));
      this.error = message;
      this.toasts.error(message);
    } finally {
      this.loading = false;
    }
  }

  setEditName(event: Event): void {
    this.editName = (event.target as HTMLInputElement).value;
  }

  setEditDownKbps(value: number): void {
    this.editDownKbps = sanitizeKbps(value);
  }

  setEditUpKbps(value: number): void {
    this.editUpKbps = sanitizeKbps(value);
  }

  setForwardingMode(value: string): void {
    this.forwardingMode = parseForwardingMode(value);
  }

  setForwardingSymmetric(event: Event): void {
    this.forwardingSymmetric = (event.target as HTMLInputElement).checked;
  }

  isForwardingSelected(id: string): boolean {
    return this.forwardingSelected.includes(id);
  }

  toggleForwardingSelected(id: string): void {
    if (this.device?.id === id) return;
    this.forwardingSelected = this.forwardingSelected.includes(id)
      ? this.forwardingSelected.filter((item) => item !== id)
      : [...this.forwardingSelected, id];
  }

  isForwardingCellChecked(rowId: string, targetId: string): boolean {
    const row = this.findRow(rowId);
    return row ? this.rowAllows(row, targetId) : false;
  }

  isForwardingCellDisabled(rowId: string, targetId: string): boolean {
    if (this.forwardingBusy || rowId === targetId) return true;
    const row = this.findRow(rowId);
    return !row || row.mode !== "selected";
  }

  forwardingPairTitle(rowId: string, targetId: string): string {
    const row = this.findRow(rowId);
    const target = this.findRow(targetId);
    if (!row || !target || row.id === target.id) return "";
    const pair = this.forwardingSymmetric
      ? `${row.name} ↔ ${target.name}`
      : `${row.name} → ${target.name}`;
    const state = this.rowAllows(row, target.id)
      ? t("clients.details.forwarding.pairAllowed")
      : t("clients.details.forwarding.pairDenied");
    return `${pair}: ${state}`;
  }

  async setForwardingRowMode(rowId: string, value: string): Promise<void> {
    if (this.forwardingBusy) return;
    const row = this.findRow(rowId);
    const mode = parseForwardingMode(value);
    if (!row || row.mode === mode) return;
    const snapshot = this.snapshotRows();
    const next: ForwardingRow =
      mode === "off"
        ? { ...row, mode, allowed: [] }
        : { ...row, mode };
    this.replaceRow(next);
    if (mode === "selected" && next.allowed.length === 0) return;
    await this.persistRows(
      [{ rowId: next.id, forwarding: forwardingPayload(next.mode, next.allowed) }],
      snapshot,
    );
  }

  async toggleForwardingCell(rowId: string, targetId: string): Promise<void> {
    if (this.forwardingBusy || rowId === targetId) return;
    const row = this.findRow(rowId);
    const target = this.findRow(targetId);
    if (!row || !target || row.mode !== "selected") return;
    const snapshot = this.snapshotRows();
    const grant = !row.allowed.includes(targetId);
    const nextRow = this.rowWithAllowed(row, grant ? [...row.allowed, targetId] : row.allowed.filter((id) => id !== targetId));
    this.replaceRow(nextRow);
    const changes: Array<{ rowId: string; forwarding: Forwarding }> = [
      { rowId: nextRow.id, forwarding: forwardingPayload(nextRow.mode, nextRow.allowed) },
    ];
    if (this.forwardingSymmetric && target.mode !== "all") {
      const mirrorAllowed = grant
        ? [...target.allowed, rowId]
        : target.allowed.filter((id) => id !== rowId);
      if (target.mode === "selected" || grant) {
        const nextTarget = this.rowWithAllowed(target, mirrorAllowed);
        this.replaceRow(nextTarget);
        changes.push({
          rowId: nextTarget.id,
          forwarding: forwardingPayload(nextTarget.mode, nextTarget.allowed),
        });
      }
    }
    await this.persistRows(changes, snapshot);
  }

  async toggleForwardingPair(aId: string, bId: string): Promise<void> {
    if (this.forwardingBusy || aId === bId) return;
    const a = this.findRow(aId);
    const b = this.findRow(bId);
    if (!a || !b) return;
    if (a.mode === "all" || b.mode === "all") {
      this.toasts.error(t("clients.details.forwarding.bulkError"));
      return;
    }
    const snapshot = this.snapshotRows();
    const bothAllowed = this.rowAllows(a, bId) && this.rowAllows(b, aId);
    const nextA = this.rowWithAllowed(
      a,
      bothAllowed ? a.allowed.filter((id) => id !== bId) : [...a.allowed, bId],
    );
    const nextB = this.rowWithAllowed(
      b,
      bothAllowed ? b.allowed.filter((id) => id !== aId) : [...b.allowed, aId],
    );
    this.replaceRow(nextA);
    this.replaceRow(nextB);
    await this.persistRows(
      [
        { rowId: nextA.id, forwarding: forwardingPayload(nextA.mode, nextA.allowed) },
        { rowId: nextB.id, forwarding: forwardingPayload(nextB.mode, nextB.allowed) },
      ],
      snapshot,
    );
  }

  selectProfile(interfaceId: string): void {
    this.activeProfileId = interfaceId;
  }

  setShareInterface(value: string): void {
    this.shareInterfaceId = value;
  }

  setShareFormat(value: string): void {
    this.shareFormat = value === "vpn" ? "vpn" : "conf";
  }

  setShareTtl(value: string): void {
    const parsed = Number(value);
    this.shareTtl = Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
  }

  setShareOneTime(event: Event): void {
    this.shareOneTime = (event.target as HTMLInputElement).checked;
  }

  setShareMaxUses(value: string): void {
    this.shareMaxUses = value;
  }

  async cancelEdit(): Promise<void> {
    if (this.saving) return;
    const device = this.device;
    if (!device) return;
    if (this.editDirty) {
      const confirmed = await askConfirm({
        title: t("clients.edit.discard.title"),
        message: t("clients.edit.discard.message"),
        confirmLabel: t("clients.edit.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.hydrateForm(device);
  }

  async save(): Promise<void> {
    const device = this.device;
    if (!device || !this.canSave) return;
    const name = this.editName.trim();
    if (!name) {
      this.toasts.error(t("clients.details.error.name"));
      return;
    }
    this.saving = true;
    try {
      const updated = await this.devicesService.updateDevice(device.id, {
        name,
        down_kbps: this.editDownKbps,
        up_kbps: this.editUpKbps,
        forwarding: forwardingPayload(
          this.forwardingMode,
          this.orderedAllowed(this.forwardingSelected),
        ),
      });
      this.device = updated;
      this.applyRowFromDevice(updated);
      this.hydrateForm(updated);
      this.toasts.success(t("clients.details.toast.saved"));
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.details.error.save")));
    } finally {
      this.saving = false;
    }
  }

  async revoke(): Promise<void> {
    const device = this.device;
    if (!device || this.actionBusy) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.revokeTitle"),
      message: t("clients.details.confirm.revoke", { name: device.name }),
      confirmLabel: t("clients.details.revoke"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.actionBusy = true;
    try {
      await this.devicesService.updateDevice(device.id, { revoked: true });
      this.toasts.success(t("clients.details.toast.revoked"));
      this.back();
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.details.error.revoke")));
    } finally {
      this.actionBusy = false;
    }
  }

  async remove(): Promise<void> {
    const device = this.device;
    if (!device || this.actionBusy) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.deleteTitle"),
      message: t("clients.details.confirm.delete", { name: device.name }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.actionBusy = true;
    try {
      await this.devicesService.deleteDevice(device.id);
      this.toasts.success(t("clients.details.toast.deleted"));
      this.back();
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.details.error.delete")));
    } finally {
      this.actionBusy = false;
    }
  }

  async createShare(): Promise<void> {
    const device = this.device;
    if (!device || !this.canCreateShare) return;
    this.shareBusy = true;
    try {
      const maxUses = this.shareMaxUsesValue;
      const share = await this.devicesService.createShare(device.id, {
        interfaceId: this.shareInterfaceId,
        format: this.shareFormat,
        ttlSecs: this.shareTtl,
        ...(this.shareOneTime ? { oneTime: true } : {}),
        ...(!this.shareOneTime && maxUses !== undefined ? { maxUses } : {}),
      });
      this.shares = [share, ...this.shares];
      this.toasts.success(t("clients.details.toast.shareCreated"));
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.details.error.shareCreate")));
    } finally {
      this.shareBusy = false;
    }
  }

  async revokeShare(token: string): Promise<void> {
    if (this.shareBusy) return;
    this.shareBusy = true;
    try {
      await this.devicesService.revokeShare(token);
      this.shares = this.shares.filter((share) => share.token !== token);
      this.toasts.success(t("clients.details.toast.shareRevoked"));
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.details.error.shareRevoke")));
    } finally {
      this.shareBusy = false;
    }
  }

  async revokeAllShares(): Promise<void> {
    const device = this.device;
    if (!device || this.shareBusy) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.shareRevokeTitle"),
      message: t("clients.details.confirm.shareRevokeAll", { name: device.name }),
      confirmLabel: t("clients.details.revoke"),
      tone: "danger",
    });
    if (!confirmed) return;
    this.shareBusy = true;
    try {
      const revoked = await this.devicesService.revokeAllShares(device.id);
      const revokedAt = new Date().toISOString();
      this.shares = this.shares.map((share) =>
        share.state === "active"
          ? {
              ...share,
              state: "revoked" as const,
              revoked_at: revokedAt,
              remaining_uses: share.max_uses === null ? null : 0,
            }
          : share,
      );
      this.toasts.success(
        t("clients.details.toast.sharesRevoked", { count: revoked }),
      );
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.details.error.sharesRevoke")));
    } finally {
      this.shareBusy = false;
    }
  }

  shareStateLabel(state: ShareLinkState): string {
    return t(SHARE_STATE_KEYS[state]);
  }

  shareStateClass(state: ShareLinkState): string {
    if (state === "active") return "badge badge--green";
    if (state === "exhausted") return "badge badge--amber";
    if (state === "revoked") return "badge badge--red";
    return "badge badge--gray";
  }

  shareUsesLabel(share: ShareLink): string {
    if (share.max_uses === null) {
      return t("clients.details.share.usesUnlimited", { uses: share.uses });
    }
    return t("clients.details.share.usesLimited", {
      uses: share.uses,
      max: share.max_uses,
    });
  }

  async copyText(value: string, label: string): Promise<void> {
    if (!value) {
      this.toasts.error(t("clients.copy.empty"));
      return;
    }
    try {
      await copyText(value);
      this.toasts.success(t("clients.copy.done", { label }));
    } catch {
      this.toasts.error(t("clients.copy.failed"));
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
    this.qrTitle = t("clients.details.qr.vpnTitle", { name: profile.interface_name });
    this.qrCopyLabel = t("clients.details.profiles.copyVpn");
    this.qrOpen = true;
  }

  closeQr(): void {
    this.qrOpen = false;
    this.qrValue = "";
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
    link.download = `${sanitizeFilePart(this.device?.name ?? "device")}-${sanitizeFilePart(profile.interface_name)}.conf`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toasts.success(t("clients.details.toast.downloaded"));
  }

  interfaceName(interfaceId: string): string {
    return this.profiles.find((profile) => profile.interface_id === interfaceId)?.interface_name ?? interfaceId;
  }

  back(): void {
    this.router.navigate("/clients");
  }

  private editState(): ClientEditState {
    return {
      name: this.editName,
      downKbps: this.editDownKbps,
      upKbps: this.editUpKbps,
      forwardingMode: this.forwardingMode,
      forwardingSelected: [...this.forwardingSelected],
    };
  }

  private hydrateForm(device: Device): void {
    this.editName = device.name;
    this.editDownKbps = device.down_kbps;
    this.editUpKbps = device.up_kbps;
    this.forwardingMode = modeOfForwarding(device.forwarding);
    this.forwardingSelected =
      this.forwardingMode === "selected" ? [...device.forwarding.allowed_devices] : [];
    this.editSnapshot = this.editState();
  }

  private async loadOwnerQuota(device: Device): Promise<void> {
    try {
      this.ownerQuota = this.isAdmin
        ? await this.quotaService.forUser(device.user_id)
        : await this.quotaService.me();
    } catch {
      this.ownerQuota = null;
    }
  }

  private buildForwardingRows(device: Device): void {
    this.forwardingRows = this.allDevices
      .filter((item) => item.user_id === device.user_id && !item.revoked)
      .map((item) => {
        const mode = modeOfForwarding(item.forwarding);
        return {
          id: item.id,
          name: item.name,
          addresses: [...item.addresses],
          mode,
          allowed: mode === "selected" ? this.orderedAllowed(item.forwarding.allowed_devices) : [],
        };
      });
  }

  private findRow(rowId: string): ForwardingRow | undefined {
    return this.forwardingRows.find((row) => row.id === rowId);
  }

  private rowAllows(row: ForwardingRow, targetId: string): boolean {
    if (row.id === targetId) return false;
    if (row.mode === "all") return true;
    return row.mode === "selected" && row.allowed.includes(targetId);
  }

  private rowWithAllowed(row: ForwardingRow, allowed: string[]): ForwardingRow {
    const unique = this.orderedAllowed(Array.from(new Set(allowed)));
    return { ...row, allowed: unique, mode: unique.length > 0 ? "selected" : "off" };
  }

  private orderedAllowed(ids: string[]): string[] {
    const order = new Map(this.forwardingRows.map((row, index) => [row.id, index]));
    return [...ids].sort(
      (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  private snapshotRows(): ForwardingRow[] {
    return this.forwardingRows.map((row) => ({ ...row, addresses: [...row.addresses], allowed: [...row.allowed] }));
  }

  private replaceRow(next: ForwardingRow): void {
    this.forwardingRows = this.forwardingRows.map((row) => (row.id === next.id ? next : row));
    if (this.device?.id === next.id) this.syncFormForwarding();
  }

  private applyRowFromDevice(device: Device): void {
    const mode = modeOfForwarding(device.forwarding);
    const exists = this.forwardingRows.some((row) => row.id === device.id);
    if (!exists) return;
    this.forwardingRows = this.forwardingRows.map((row) =>
      row.id === device.id
        ? {
            id: row.id,
            name: device.name,
            addresses: [...device.addresses],
            mode,
            allowed: mode === "selected" ? this.orderedAllowed(device.forwarding.allowed_devices) : [],
          }
        : row,
    );
    if (this.device?.id === device.id) {
      this.device = { ...this.device, name: device.name, forwarding: device.forwarding };
      this.syncFormForwarding();
    }
  }

  private syncFormForwarding(): void {
    const device = this.device;
    if (!device) return;
    const row = this.findRow(device.id);
    if (!row) return;
    this.forwardingMode = row.mode;
    this.forwardingSelected = [...row.allowed];
    this.refreshForwardingSnapshot();
  }

  private refreshForwardingSnapshot(): void {
    const snapshot = this.editSnapshot;
    if (snapshot === null) return;
    this.editSnapshot = {
      ...snapshot,
      forwardingMode: this.forwardingMode,
      forwardingSelected: [...this.forwardingSelected],
    };
  }

  private async persistRows(
    changes: Array<{ rowId: string; forwarding: Forwarding }>,
    snapshot: ForwardingRow[],
  ): Promise<void> {
    if (changes.length === 0) return;
    this.forwardingBusy = true;
    try {
      for (let index = 0; index < changes.length; index += 1) {
        const change = changes[index];
        if (!change) continue;
        try {
          const updated = await this.devicesService.updateDevice(change.rowId, {
            forwarding: change.forwarding,
          });
          this.applyRowFromDevice(updated);
        } catch (error) {
          const failed = changes.slice(index).map((item) => item.rowId);
          this.restoreRows(snapshot, failed);
          this.toasts.error(messageOf(error, t("clients.details.error.forwarding")));
          return;
        }
      }
    } finally {
      this.forwardingBusy = false;
    }
  }

  private restoreRows(snapshot: ForwardingRow[], rowIds: string[]): void {
    this.forwardingRows = this.forwardingRows.map((row) => {
      if (!rowIds.includes(row.id)) return row;
      const previous = snapshot.find((item) => item.id === row.id);
      return previous ? { ...previous, addresses: [...previous.addresses], allowed: [...previous.allowed] } : row;
    });
    if (this.device && rowIds.includes(this.device.id)) this.syncFormForwarding();
  }
}

function modeOfForwarding(forwarding: Forwarding | null | undefined): ForwardingMode {
  if (!forwarding) return "off";
  if (forwarding.to_own_devices) return "all";
  return forwarding.allowed_devices.length > 0 ? "selected" : "off";
}

function forwardingPayload(mode: ForwardingMode, allowed: string[]): Forwarding {
  if (mode === "all") return { to_own_devices: true, allowed_devices: [] };
  if (mode === "selected") return { to_own_devices: false, allowed_devices: [...allowed] };
  return { to_own_devices: false, allowed_devices: [] };
}

function parseForwardingMode(value: string): ForwardingMode {
  return value === "all" || value === "selected" ? value : "off";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sanitizeKbps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sanitizeFilePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "device";
}
