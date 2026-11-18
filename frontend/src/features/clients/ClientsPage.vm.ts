import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { UsersService } from "@/application/users/service";
import { askConfirm } from "@/app/confirm";
import { debounce } from "@/app/debounce";
import { compareBoolean, compareText, nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { DevicesBulkAction } from "@/domain/devices/repository";
import type { Device, InterfaceInfo, User } from "@/domain/types";
import { t } from "@/i18n";
import { pluralI18n } from "@/i18n/format";

const SEARCH_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 200;
const FILTER_ID_LIMIT = 100;

export interface ClientsFilters {
  query: string;
  interfaceFilter: string;
}

export interface InterfaceOption {
  readonly value: string;
  readonly label: string;
}

export interface InterfaceCheckboxOption extends InterfaceOption {
  readonly disabled: boolean;
  readonly hint: string;
}

export interface ClientFormState {
  readonly name: string;
  readonly userId: string;
  readonly interfaceIds: readonly string[];
  readonly downKbps: number;
  readonly upKbps: number;
  readonly forwarding: boolean;
}

const EMPTY_FILTERS: ClientsFilters = { query: "", interfaceFilter: "" };

export const clientsFiltersStorage = persistedSignal<ClientsFilters>(
  "awg.ui.clients.filters",
  EMPTY_FILTERS,
  validateClientsFilters,
  { version: 2 },
);

export class ClientsPageVM {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly interfacesService: InterfacesService,
    private readonly usersService: UsersService,
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    const stored = clientsFiltersStorage.read();
    this.query = stored.query;
    this.appliedQuery = stored.query;
    this.interfaceFilter = stored.interfaceFilter;
  }

  @reactive accessor devices: Device[] = [];
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor users: User[] = [];
  @reactive accessor loading = true;
  @reactive accessor query = "";
  @reactive accessor appliedQuery = "";
  @reactive accessor interfaceFilter = "";
  @reactive accessor statusFilter: "all" | "active" | "revoked" = "all";
  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;
  @reactive accessor sort: SortState<"name" | "status"> | null = { key: "name", direction: "asc" };

  private readonly applyQuery = debounce(() => {
    this.appliedQuery = this.query;
  }, SEARCH_DEBOUNCE_MS);

  @reactive accessor createOpen = false;
  @reactive accessor submitting = false;

  @reactive accessor formName = "";
  @reactive accessor formUserId = "";
  @reactive accessor formInterfaceIds: string[] = [];
  @reactive accessor formInterfaceQuery = "";
  @reactive accessor formDownKbps = 0;
  @reactive accessor formUpKbps = 0;
  @reactive accessor formForwarding = false;

  @reactive private accessor formSnapshot: ClientFormState | null = null;

  created(): void {
    void this.load();
  }

  beforeUnmount(): void {
    this.applyQuery.cancel();
  }

  @computed
  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get interfaceOptions(): InterfaceOption[] {
    return this.interfaces.map((item) => ({
      value: item.id,
      label: interfaceLabel(item),
    }));
  }

  @computed
  get formInterfaceOptions(): InterfaceOption[] {
    return this.interfacesForNode(this.userNodeId(this.formUserId)).map((item) => ({
      value: item.id,
      label: interfaceLabel(item),
    }));
  }

  @computed
  get formInterfacesPinned(): boolean {
    return this.formInterfaceOptions.length === 1;
  }

  @computed
  get pinnedFormInterfaceId(): string {
    return this.formInterfacesPinned ? this.formInterfaceOptions[0]?.value ?? "" : "";
  }

  @computed
  get selectedFormInterfaceIds(): string[] {
    const available = this.formInterfaceOptions.map((option) => option.value);
    if (this.formInterfacesPinned) return available;
    return available.filter((id) => this.formInterfaceIds.includes(id));
  }

  @computed
  get selectedFormInterfaceCount(): number {
    return this.selectedFormInterfaceIds.length;
  }

  @computed
  get filteredFormInterfaceOptions(): InterfaceCheckboxOption[] {
    const query = this.formInterfaceQuery.trim().toLowerCase();
    return this.formInterfaceOptions
      .filter((option) => query.length === 0 || option.label.toLowerCase().includes(query))
      .map((option) => ({
        ...option,
        disabled: this.isFormInterfaceDisabled(option.value),
        hint: this.formInterfaceHint(option.value),
      }));
  }

  @computed
  get formTunnelsLabel(): string {
    const count = this.selectedFormInterfaceCount;
    return t("clients.form.tunnelsWillCreate", { count });
  }

  @computed
  get filteredDevices(): Device[] {
    const query = this.appliedQuery.trim().toLowerCase();
    const interfaceId = this.interfaceFilter;
    const filtered = this.devices.filter((device) => {
      if (interfaceId && !hasInterface(device, interfaceId)) return false;
      if (this.statusFilter === "active" && device.revoked) return false;
      if (this.statusFilter === "revoked" && !device.revoked) return false;
      if (!query) return true;
      return [device.name, ...device.addresses].some((value) => value.toLowerCase().includes(query));
    });
    const sort = this.sort;
    if (sort === null) return filtered;
    const direction = sort.direction;
    return [...filtered].sort((left, right) => {
      if (sort.key === "name") return compareText(left.name, right.name, direction);
      return compareBoolean(left.revoked, right.revoked, direction);
    });
  }

  sortBy(key: "name" | "status"): void {
    this.sort = nextSort(this.sort, key);
  }

  sortMark(key: "name" | "status"): string {
    return sortIndicator(this.sort, key);
  }

  @computed
  get hasActiveFilters(): boolean {
    return this.appliedQuery.trim().length > 0
      || this.interfaceFilter.length > 0
      || this.statusFilter !== "all";
  }

  @computed
  get selectedCount(): number {
    return this.selectedIds.length;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSelected(id: string): void {
    this.selectedIds = this.isSelected(id)
      ? this.selectedIds.filter((value) => value !== id)
      : [...this.selectedIds, id];
  }

  get allFilteredSelected(): boolean {
    return this.filteredDevices.length > 0 && this.selectedIds.length === this.filteredDevices.length;
  }

  toggleSelectAll(): void {
    this.selectedIds = this.allFilteredSelected ? [] : this.filteredDevices.map((device) => device.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }

  async bulkDelete(): Promise<void> {
    if (this.selectedIds.length === 0) return;
    const confirmed = await askConfirm({
      title: t("clients.confirm.bulkDeleteTitle"),
      message: t("bulk.confirm.delete", { count: this.selectedIds.length }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    await this.runBulk("delete", [...this.selectedIds]);
  }

  async bulkRevokeShares(): Promise<void> {
    if (this.selectedIds.length === 0) return;
    await this.runBulk("revoke_shares", [...this.selectedIds]);
  }

  private async runBulk(action: DevicesBulkAction, ids: readonly string[]): Promise<void> {
    this.bulkBusy = true;
    try {
      const result = await this.devicesService.bulk(action, ids);
      this.clearSelection();
      this.toasts[result.failed.length > 0 ? "error" : "success"](
        t("bulk.done", { done: result.done, failed: result.failed.length }),
      );
    } catch {
      this.clearSelection();
      this.toasts.error(t("bulk.done", { done: 0, failed: ids.length }));
    } finally {
      this.bulkBusy = false;
    }
    await this.load();
  }

  @computed
  get countLabel(): string {
    return t("filters.found", {
      found: this.filteredDevices.length,
      total: this.devices.length,
    });
  }

  @computed
  get formInterfaceGroupId(): string | null {
    const primary = this.selectedFormInterfaceIds[0];
    if (!primary) return null;
    return this.interfaceGroupId(primary) || null;
  }

  @computed
  get canCreate(): boolean {
    if (this.submitting || this.formName.trim().length === 0) return false;
    if (this.isAdmin && this.formUserId.length === 0) return false;
    if (this.isAdmin || this.formInterfaceOptions.length > 0) {
      return this.selectedFormInterfaceCount > 0;
    }
    return true;
  }

  @computed
  get formDirty(): boolean {
    const snapshot = this.formSnapshot;
    if (snapshot === null) return false;
    return !sameClientForm(snapshot, this.formState());
  }

  isFormInterfaceSelected(id: string): boolean {
    return this.selectedFormInterfaceIds.includes(id);
  }

  isFormInterfaceDisabled(id: string): boolean {
    if (this.formInterfacesPinned) return true;
    if (this.isFormInterfaceSelected(id)) return false;
    const groupId = this.formInterfaceGroupId;
    if (groupId === null) return false;
    const optionGroup = this.interfaceGroupId(id);
    return optionGroup.length > 0 && optionGroup !== groupId;
  }

  formInterfaceHint(id: string): string {
    if (this.formInterfacesPinned) return t("clients.form.interfacePinned");
    if (!this.isFormInterfaceDisabled(id)) return "";
    return t("clients.form.interfaceOtherGroup");
  }

  toggleFormInterface(id: string): void {
    if (this.formInterfacesPinned || this.isFormInterfaceDisabled(id)) return;
    this.formInterfaceIds = this.formInterfaceIds.includes(id)
      ? this.formInterfaceIds.filter((value) => value !== id)
      : [...this.formInterfaceIds, id];
  }

  setFormInterfaceQuery(event: Event): void {
    this.formInterfaceQuery = (event.target as HTMLInputElement).value;
  }

  private formState(): ClientFormState {
    return {
      name: this.formName,
      userId: this.formUserId,
      interfaceIds: [...this.formInterfaceIds],
      downKbps: this.formDownKbps,
      upKbps: this.formUpKbps,
      forwarding: this.formForwarding,
    };
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const interfacesPromise: Promise<InterfaceInfo[]> = this.isAdmin
        ? this.interfacesService.listInterfaces()
        : this.interfacesService.listInterfaces().catch(() => []);
      const usersPromise = this.isAdmin ? this.usersService.listUsers() : Promise.resolve<User[]>([]);
      const [devices, interfaces, users] = await Promise.all([
        this.devicesService.listDevices(),
        interfacesPromise,
        usersPromise,
      ]);
      this.devices = devices;
      this.interfaces = interfaces;
      this.users = users;
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.error.load")));
    } finally {
      this.loading = false;
    }
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    this.applyQuery();
    this.persistFilters();
  }

  setInterfaceFilter(value: string): void {
    this.interfaceFilter = value;
    this.persistFilters();
  }

  resetFilters(): void {
    this.applyQuery.cancel();
    this.query = "";
    this.appliedQuery = "";
    this.interfaceFilter = "";
    clientsFiltersStorage.clear();
  }

  setFormName(event: Event): void {
    this.formName = (event.target as HTMLInputElement).value;
  }

  setFormUser(value: string): void {
    this.formUserId = value;
    this.formInterfaceIds = this.defaultInterfaceIds();
  }

  setFormDownKbps(value: number): void {
    this.formDownKbps = sanitizeKbps(value);
  }

  setFormUpKbps(value: number): void {
    this.formUpKbps = sanitizeKbps(value);
  }

  setFormForwarding(event: Event): void {
    this.formForwarding = (event.target as HTMLInputElement).checked;
  }

  openCreate(): void {
    const userId = this.isAdmin ? "" : this.session.user?.id ?? "";
    this.formName = "";
    this.formUserId = userId;
    this.formInterfaceQuery = "";
    this.formInterfaceIds = this.defaultInterfaceIds();
    this.formDownKbps = 0;
    this.formUpKbps = 0;
    this.formForwarding = false;
    this.formSnapshot = this.formState();
    this.createOpen = true;
  }

  async closeCreate(): Promise<void> {
    if (this.submitting) return;
    if (this.formDirty) {
      const confirmed = await askConfirm({
        title: t("clients.create.discard.title"),
        message: t("clients.create.discard.message"),
        confirmLabel: t("clients.create.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.createOpen = false;
    this.formSnapshot = null;
  }

  async create(): Promise<void> {
    if (this.submitting) return;
    const name = this.formName.trim();
    if (name.length === 0) return;
    const userId = this.isAdmin ? this.formUserId : this.session.user?.id ?? "";
    if (userId.length === 0) {
      this.toasts.error(t("clients.error.user"));
      return;
    }
    const interfaceIds = this.selectedFormInterfaceIds;
    if ((this.isAdmin || this.formInterfaceOptions.length > 0) && interfaceIds.length === 0) {
      this.toasts.error(t("clients.error.interface"));
      return;
    }
    this.submitting = true;
    try {
      const device = await this.devicesService.createDevice({
        user_id: userId,
        group_id: this.formInterfaceGroupId,
        ...(interfaceIds.length > 0 ? { interface_ids: [...interfaceIds] } : {}),
        name,
        down_kbps: this.formDownKbps,
        up_kbps: this.formUpKbps,
        forwarding: {
          to_own_devices: this.formForwarding,
          allowed_devices: [],
        },
      });
      this.createOpen = false;
      this.formSnapshot = null;
      this.toasts.success(t("clients.toast.created", { name: device.name }));
      await this.load();
    } catch (error) {
      this.toasts.error(messageOf(error, t("clients.error.create")));
    } finally {
      this.submitting = false;
    }
  }

  openDevice(id: string): void {
    this.router.navigate(`/clients/${id}`);
  }

  userEmail(id: string): string {
    const user = this.users.find((item) => item.id === id);
    if (user) return user.email ?? user.login;
    if (this.session.user?.id === id) return this.session.user.email ?? this.session.user.login;
    return "—";
  }

  interfaceSummary(device: Device): string {
    if (!device.interface_name) return "—";
    return device.node_name
      ? `${device.interface_name} · ${device.node_name}`
      : device.interface_name;
  }

  tunnelCount(device: Device): number {
    if (device.peers.length > 0) return device.peers.length;
    return device.interface_id ? 1 : 0;
  }

  tunnelsLabel(device: Device): string {
    const count = this.tunnelCount(device);
    return `${count} ${pluralI18n(count, "common.tunnels.one", "common.tunnels.few", "common.tunnels.many")}`;
  }

  interfaceNames(device: Device): string {
    return this.interfaceNameList(device).join(", ");
  }

  interfaceNameList(device: Device): string[] {
    const names = Array.from(new Set(device.peers.map((peer) => peer.interface_name)));
    if (names.length > 0) return names;
    return device.interface_name ? [device.interface_name] : [];
  }

  private userNodeId(userId: string): string {
    if (!this.isAdmin) return this.session.user?.node_id ?? "";
    return this.users.find((user) => user.id === userId)?.node_id ?? "";
  }

  private interfacesForNode(nodeId: string): InterfaceInfo[] {
    if (nodeId.length === 0) return this.interfaces;
    return this.interfaces.filter((item) => isInterfaceOnNode(item, nodeId));
  }

  private interfaceGroupId(interfaceId: string): string {
    return this.interfaces.find((item) => item.id === interfaceId)?.group_id ?? "";
  }

  private defaultInterfaceIds(): string[] {
    const pinned = this.pinnedFormInterfaceId;
    if (pinned.length > 0) return [pinned];
    const available = this.formInterfaceOptions.map((option) => option.value);
    if (available.length === 0) return [];
    if (available.includes(this.interfaceFilter)) return [this.interfaceFilter];
    return [];
  }

  private persistFilters(): void {
    clientsFiltersStorage.write({
      query: this.query,
      interfaceFilter: this.interfaceFilter,
    });
  }
}

function interfaceLabel(item: InterfaceInfo): string {
  return item.node_name.length > 0 ? `${item.name} · ${item.node_name}` : item.name;
}

function isInterfaceOnNode(item: InterfaceInfo, nodeId: string): boolean {
  return nodeId.length === 0 || item.node_id === nodeId;
}

function hasInterface(device: Device, interfaceId: string): boolean {
  if (device.interface_id === interfaceId) return true;
  return device.peers.some((peer) => peer.interface_id === interfaceId);
}

function validateClientsFilters(value: unknown): ClientsFilters | null {
  if (!isRecord(value)) return null;
  const query = stringField(value, "query", QUERY_LIMIT);
  const interfaceFilter = stringField(value, "interfaceFilter", FILTER_ID_LIMIT);
  if (query === null || interfaceFilter === null) return null;
  return { query, interfaceFilter };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sanitizeKbps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function sameClientForm(left: ClientFormState, right: ClientFormState): boolean {
  return (
    left.name === right.name &&
    left.userId === right.userId &&
    sameInterfaceIds(left.interfaceIds, right.interfaceIds) &&
    left.downKbps === right.downKbps &&
    left.upKbps === right.upKbps &&
    left.forwarding === right.forwarding
  );
}

function sameInterfaceIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
