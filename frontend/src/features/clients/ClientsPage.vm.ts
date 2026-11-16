import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, router, session, toasts } from "@/app/container";
import { plural } from "@/domain/format";
import type { Device, Group, User } from "@/domain/types";

export class ClientsPageVM {
  @reactive accessor devices: Device[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor users: User[] = [];
  @reactive accessor loading = true;
  @reactive accessor query = "";
  @reactive accessor groupFilter = "";

  @reactive accessor createOpen = false;
  @reactive accessor submitting = false;

  @reactive accessor formName = "";
  @reactive accessor formUserId = "";
  @reactive accessor formGroupId = "";
  @reactive accessor formDown = "0";
  @reactive accessor formUp = "0";
  @reactive accessor formForwarding = false;

  created(): void {
    void this.load();
  }

  @computed
  get isAdmin(): boolean {
    return session.isAdmin;
  }

  @computed
  get filteredDevices(): Device[] {
    const query = this.query.trim().toLowerCase();
    const group = this.groupFilter;
    return this.devices.filter((device) => {
      if (group && device.group_id !== group) return false;
      if (!query) return true;
      return [device.name, ...device.addresses].some((value) => value.toLowerCase().includes(query));
    });
  }

  @computed
  get countLabel(): string {
    return `${this.filteredDevices.length} из ${this.devices.length}`;
  }

  @computed
  get canCreate(): boolean {
    if (this.submitting || this.formName.trim().length === 0) return false;
    return !this.isAdmin || this.formUserId.length > 0;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const groupsPromise = this.isAdmin ? api.listGroups() : Promise.resolve<Group[]>([]);
      const usersPromise = this.isAdmin ? api.listUsers() : Promise.resolve<User[]>([]);
      const [devices, groups, users] = await Promise.all([
        api.listDevices(),
        groupsPromise,
        usersPromise,
      ]);
      this.devices = devices;
      this.groups = groups;
      this.users = users;
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось загрузить клиентов"));
    } finally {
      this.loading = false;
    }
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
  }

  setGroupFilter(value: string): void {
    this.groupFilter = value;
  }

  setFormName(event: Event): void {
    this.formName = (event.target as HTMLInputElement).value;
  }

  setFormUser(value: string): void {
    this.formUserId = value;
  }

  setFormGroup(value: string): void {
    this.formGroupId = value;
  }

  setFormDown(event: Event): void {
    this.formDown = (event.target as HTMLInputElement).value;
  }

  setFormUp(event: Event): void {
    this.formUp = (event.target as HTMLInputElement).value;
  }

  setFormForwarding(event: Event): void {
    this.formForwarding = (event.target as HTMLInputElement).checked;
  }

  openCreate(): void {
    this.formName = "";
    this.formUserId = this.isAdmin ? "" : session.user?.id ?? "";
    this.formGroupId = this.isAdmin ? this.groupFilter : "";
    this.formDown = "0";
    this.formUp = "0";
    this.formForwarding = false;
    this.createOpen = true;
  }

  closeCreate(): void {
    if (this.submitting) return;
    this.createOpen = false;
  }

  async create(): Promise<void> {
    if (!this.canCreate) return;
    const userId = this.isAdmin ? this.formUserId : session.user?.id ?? "";
    if (!userId) {
      toasts.error("Не удалось определить пользователя устройства");
      return;
    }
    this.submitting = true;
    try {
      const device = await api.createDevice({
        user_id: userId,
        group_id: this.isAdmin ? this.formGroupId || null : session.user?.group_id ?? null,
        name: this.formName.trim(),
        down_kbps: parseKbps(this.formDown),
        up_kbps: parseKbps(this.formUp),
        forwarding: {
          to_own_devices: this.formForwarding,
          allowed_devices: [],
        },
      });
      this.createOpen = false;
      toasts.success(`Устройство «${device.name}» создано`);
      await this.load();
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось создать устройство"));
    } finally {
      this.submitting = false;
    }
  }

  openDevice(id: string): void {
    router.navigate(`/clients/${id}`);
  }

  userLogin(id: string): string {
    const user = this.users.find((item) => item.id === id);
    if (user) return user.login;
    if (session.user?.id === id) return session.user.login;
    return "—";
  }

  groupName(id: string | null): string {
    if (!id) return "Без группы";
    return this.groups.find((item) => item.id === id)?.name ?? id;
  }

  peersLabel(device: Device): string {
    return `${device.peers.length} ${plural(device.peers.length, "пир", "пира", "пиров")}`;
  }

  interfaceNames(device: Device): string {
    const names = Array.from(new Set(device.peers.map((peer) => peer.interface_name)));
    return names.length > 0 ? names.join(", ") : "—";
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseKbps(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}
