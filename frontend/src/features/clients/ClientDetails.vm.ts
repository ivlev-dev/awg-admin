import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { api, router, session, toasts } from "@/app/container";
import type { DeviceStats } from "@/application/api";
import { formatBytes, formatRate } from "@/domain/format";
import type { Device, Group, PeerInfo, Profile, ShareFormat, ShareLink } from "@/domain/types";

export class ClientDetailsVM {
  @reactive accessor device: Device | null = null;
  @reactive accessor profiles: Profile[] = [];
  @reactive accessor shares: ShareLink[] = [];
  @reactive accessor stats: DeviceStats | null = null;
  @reactive accessor allDevices: Device[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor actionBusy = false;

  @reactive accessor activeProfileId = "";
  @reactive accessor shareInterfaceId = "";
  @reactive accessor shareFormat: ShareFormat = "conf";
  @reactive accessor shareTtl = 86400;
  @reactive accessor shareBusy = false;

  @reactive accessor editName = "";
  @reactive accessor editDown = "0";
  @reactive accessor editUp = "0";
  @reactive accessor forwardingOwn = false;
  @reactive accessor allowedIds: string[] = [];

  created(): void {
    void this.load();
  }

  @computed
  get deviceId(): string {
    return router.params["id"] ?? "";
  }

  @watch((vm: ClientDetailsVM) => vm.deviceId)
  onDeviceChange(next: string, previous: string | undefined): void {
    if (previous === undefined || next === previous || next.length === 0) return;
    void this.load();
  }

  @computed
  get isAdmin(): boolean {
    return session.isAdmin;
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
    if (!device || !device.group_id) return "Без группы";
    if (!this.isAdmin) {
      return device.group_id === session.user?.group_id ? "Ваша группа" : device.group_id;
    }
    return this.groups.find((group) => group.id === device.group_id)?.name ?? device.group_id;
  }

  @computed
  get downLabel(): string {
    return formatRate(this.device?.down_kbps ?? 0);
  }

  @computed
  get upLabel(): string {
    return formatRate(this.device?.up_kbps ?? 0);
  }

  @computed
  get forwardingLabel(): string {
    const forwarding = this.device?.forwarding;
    if (!forwarding?.to_own_devices) return "Выключено";
    const count = forwarding.allowed_devices.length;
    return count > 0 ? `Свои устройства · ${count}` : "Свои устройства";
  }

  @computed
  get revoked(): boolean {
    return this.device?.revoked ?? false;
  }

  @computed
  get todayRx(): string {
    return formatBytes(this.stats?.today.rx ?? 0);
  }

  @computed
  get todayTx(): string {
    return formatBytes(this.stats?.today.tx ?? 0);
  }

  @computed
  get monthRx(): string {
    return formatBytes(this.stats?.month.rx ?? 0);
  }

  @computed
  get monthTx(): string {
    return formatBytes(this.stats?.month.tx ?? 0);
  }

  @computed
  get otherDevices(): Device[] {
    const device = this.device;
    if (!device) return [];
    return this.allDevices.filter((item) => item.user_id === device.user_id && item.id !== device.id);
  }

  @computed
  get canSave(): boolean {
    return this.device !== null && this.editName.trim().length > 0 && !this.saving;
  }

  @computed
  get canCreateShare(): boolean {
    return this.device !== null && this.shareInterfaceId.length > 0 && !this.shareBusy;
  }

  @computed
  get ttlOptions(): Array<{ value: number; label: string }> {
    return [
      { value: 3600, label: "1 час" },
      { value: 86400, label: "1 день" },
      { value: 604800, label: "7 дней" },
    ];
  }

  @computed
  get formatOptions(): Array<{ value: ShareFormat; label: string }> {
    return [
      { value: "conf", label: "AmneziaWG .conf" },
      { value: "vpn", label: "vpn:// ссылка" },
    ];
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
    this.groups = [];
    this.activeProfileId = "";
    this.shareInterfaceId = "";
    try {
      const groupsPromise: Promise<Group[]> = this.isAdmin ? api.listGroups() : Promise.resolve([]);
      const devicePromise: Promise<Device> = api.getDevice(id);
      const profilesPromise: Promise<Profile[]> = api.listProfiles(id);
      const sharesPromise: Promise<ShareLink[]> = api.listShares(id);
      const statsPromise: Promise<DeviceStats> = api.deviceStats(id);
      const devicesPromise: Promise<Device[]> = api.listDevices();
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
      this.hydrateForm(device);
      if (!profiles.some((profile) => profile.interface_id === this.activeProfileId)) {
        this.activeProfileId = profiles[0]?.interface_id ?? "";
      }
      if (!profiles.some((profile) => profile.interface_id === this.shareInterfaceId)) {
        this.shareInterfaceId = profiles[0]?.interface_id ?? "";
      }
    } catch (error) {
      const message = messageOf(error, "Не удалось загрузить устройство");
      this.error = message;
      toasts.error(message);
    } finally {
      this.loading = false;
    }
  }

  setEditName(event: Event): void {
    this.editName = (event.target as HTMLInputElement).value;
  }

  setEditDown(event: Event): void {
    this.editDown = (event.target as HTMLInputElement).value;
  }

  setEditUp(event: Event): void {
    this.editUp = (event.target as HTMLInputElement).value;
  }

  setForwarding(event: Event): void {
    this.forwardingOwn = (event.target as HTMLInputElement).checked;
  }

  isAllowed(id: string): boolean {
    return this.allowedIds.includes(id);
  }

  toggleAllowed(id: string): void {
    this.allowedIds = this.allowedIds.includes(id)
      ? this.allowedIds.filter((item) => item !== id)
      : [...this.allowedIds, id];
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

  async save(): Promise<void> {
    const device = this.device;
    if (!device || !this.canSave) return;
    const name = this.editName.trim();
    if (!name) {
      toasts.error("Имя устройства не может быть пустым");
      return;
    }
    this.saving = true;
    try {
      const updated = await api.updateDevice(device.id, {
        name,
        down_kbps: parseKbps(this.editDown),
        up_kbps: parseKbps(this.editUp),
        forwarding: {
          to_own_devices: this.forwardingOwn,
          allowed_devices: [...this.allowedIds],
        },
      });
      this.device = updated;
      this.hydrateForm(updated);
      toasts.success("Настройки сохранены");
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось сохранить настройки"));
    } finally {
      this.saving = false;
    }
  }

  async revoke(): Promise<void> {
    const device = this.device;
    if (!device || this.actionBusy) return;
    if (!window.confirm(`Отозвать устройство «${device.name}»?`)) return;
    this.actionBusy = true;
    try {
      await api.updateDevice(device.id, { revoked: true });
      toasts.success("Устройство отозвано");
      this.back();
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось отозвать устройство"));
    } finally {
      this.actionBusy = false;
    }
  }

  async remove(): Promise<void> {
    const device = this.device;
    if (!device || this.actionBusy) return;
    if (!window.confirm(`Удалить устройство «${device.name}»? Действие необратимо.`)) return;
    this.actionBusy = true;
    try {
      await api.deleteDevice(device.id);
      toasts.success("Устройство удалено");
      this.back();
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось удалить устройство"));
    } finally {
      this.actionBusy = false;
    }
  }

  async createShare(): Promise<void> {
    const device = this.device;
    if (!device || !this.canCreateShare) return;
    this.shareBusy = true;
    try {
      const share = await api.createShare(
        device.id,
        this.shareInterfaceId,
        this.shareFormat,
        this.shareTtl,
      );
      this.shares = [share, ...this.shares];
      toasts.success("Временная ссылка создана");
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось создать ссылку"));
    } finally {
      this.shareBusy = false;
    }
  }

  async revokeShare(token: string): Promise<void> {
    if (this.shareBusy) return;
    this.shareBusy = true;
    try {
      await api.revokeShare(token);
      this.shares = this.shares.filter((share) => share.token !== token);
      toasts.success("Ссылка отозвана");
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось отозвать ссылку"));
    } finally {
      this.shareBusy = false;
    }
  }

  async copyText(value: string, label: string): Promise<void> {
    if (!value) {
      toasts.error("Нечего копировать");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toasts.success(`Скопировано: ${label.toLowerCase()}`);
    } catch {
      toasts.error("Не удалось скопировать в буфер обмена");
    }
  }

  copyProfile(): void {
    const profile = this.activeProfile;
    if (!profile) return;
    void this.copyText(profile.conf, "Конфигурация");
  }

  copyVpn(): void {
    const profile = this.activeProfile;
    if (!profile) return;
    void this.copyText(profile.vpn_link, "vpn-ссылка");
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
    toasts.success("Файл профиля скачан");
  }

  interfaceName(interfaceId: string): string {
    return this.profiles.find((profile) => profile.interface_id === interfaceId)?.interface_name ?? interfaceId;
  }

  back(): void {
    router.navigate("/clients");
  }

  private hydrateForm(device: Device): void {
    this.editName = device.name;
    this.editDown = String(device.down_kbps);
    this.editUp = String(device.up_kbps);
    this.forwardingOwn = device.forwarding?.to_own_devices ?? false;
    this.allowedIds = [...(device.forwarding?.allowed_devices ?? [])];
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseKbps(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function sanitizeFilePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "device";
}
