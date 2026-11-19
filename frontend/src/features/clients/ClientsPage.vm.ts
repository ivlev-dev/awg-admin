import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { UsersService } from "@/application/users/service";
import { userMessage } from "@/application/errors";
import { askConfirm } from "@/app/confirm";
import { debounce } from "@/app/debounce";
import { nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { readFilterQuery, syncFilterQuery } from "@/app/filter-url";
import { PAGE_SIZES, currentPage, pageCount, pageWindow } from "@/app/table-pagination";
import { ToastStore } from "@/app/toast";
import type { DevicesBulkAction } from "@/domain/devices/repository";
import type { DeviceSortField, DeviceStatusFilter } from "@/domain/devices/types";
import type { Device, InterfaceInfo, User } from "@/domain/types";
import { t } from "@/i18n";
import { pluralI18n } from "@/i18n/format";

const SEARCH_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 200;
const FILTER_ID_LIMIT = 100;
const DEFAULT_PAGE_SIZE = 25;

export interface ClientsFilters {
  query: string;
  interfaceFilter: string;
}

export interface ClientsExtraFilters {
  status: DeviceStatusFilter;
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
const EMPTY_EXTRA_FILTERS: ClientsExtraFilters = { status: "all" };

export const clientsFiltersStorage = persistedSignal<ClientsFilters>(
  "awg.ui.clients.filters",
  EMPTY_FILTERS,
  validateClientsFilters,
  { version: 2 },
);

export const clientsExtraFiltersStorage = persistedSignal<ClientsExtraFilters>(
  "awg.ui.clients.filters.extra",
  EMPTY_EXTRA_FILTERS,
  validateClientsExtraFilters,
);

export class ClientsPageVM extends ViewModel {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly interfacesService: InterfacesService,
    private readonly usersService: UsersService,
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    super();
    const stored = clientsFiltersStorage.read();
    const extra = clientsExtraFiltersStorage.read();
    this.query = stored.query;
    this.appliedQuery = stored.query;
    this.interfaceFilter = stored.interfaceFilter;
    this.statusFilter = extra.status;
    this.restoreFromLocation();
  }

  private listeningPopstate = false;
  private hasLoaded = false;
  private requestSeq = 0;
  private controller: AbortController | null = null;

  @reactive accessor devices: Device[] = [];
  @reactive accessor total = 0;
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor users: User[] = [];
  @reactive accessor loading = true;
  @reactive accessor refreshing = false;
  @reactive accessor error: string | null = null;
  @reactive accessor query = "";
  @reactive accessor appliedQuery = "";
  @reactive accessor interfaceFilter = "";
  @reactive accessor statusFilter: DeviceStatusFilter = "all";
  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;
  @reactive accessor page = 1;
  @reactive accessor pageSize = DEFAULT_PAGE_SIZE;
  @reactive accessor sort: SortState<DeviceSortField> | null = { key: "name", direction: "asc" };

  private readonly applyQuery = debounce(() => {
    this.appliedQuery = this.query;
    void this.reload();
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

  override created(): void {
    void this.load();
  }

  override mounted(): void {
    this.attachPopstate();
  }

  override beforeUnmount(): void {
    this.applyQuery.cancel();
    this.detachPopstate();
  }

  override unmounted(): void {
    this.detachPopstate();
  }

  override dispose(): void {
    this.applyQuery.cancel();
    this.detachPopstate();
    this.controller?.abort();
    this.controller = null;
    super.dispose();
  }

  private attachPopstate(): void {
    if (this.listeningPopstate || typeof window === "undefined") return;
    this.listeningPopstate = true;
    window.addEventListener("popstate", this.onPopState);
  }

  private detachPopstate(): void {
    if (!this.listeningPopstate || typeof window === "undefined") return;
    this.listeningPopstate = false;
    window.removeEventListener("popstate", this.onPopState);
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

  sortBy(key: DeviceSortField): void {
    this.sort = nextSort(this.sort, key);
    this.page = 1;
    this.clearSelection();
    this.syncLocation();
    void this.reload();
  }

  sortMark(key: DeviceSortField): string {
    return sortIndicator(this.sort, key);
  }

  @computed
  get hasActiveFilters(): boolean {
    return (
      this.appliedQuery.trim().length > 0 ||
      this.interfaceFilter.length > 0 ||
      this.statusFilter !== "all"
    );
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
    return this.devices.length > 0 && this.devices.every((device) => this.isSelected(device.id));
  }

  toggleSelectAll(): void {
    this.selectedIds = this.allFilteredSelected ? [] : this.devices.map((device) => device.id);
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
    const count = this.selectedIds.length;
    const confirmed = await askConfirm({
      title: t("clients.confirm.shareRevokeTitle"),
      message: t("clients.confirm.bulkShareRevoke", { count }),
      confirmLabel: t("clients.bulk.revokeShares"),
      tone: "danger",
    });
    if (!confirmed) return;
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
  get pageCount(): number {
    return pageCount(this.total, this.pageSize);
  }

  @computed
  get currentPage(): number {
    return currentPage(this.page, this.total, this.pageSize);
  }

  @computed
  get pagedDevices(): Device[] {
    return this.devices;
  }

  @computed
  get pageSummary(): string {
    const window = pageWindow(this.total, this.currentPage, this.pageSize);
    return t("users.pagination.summary", { from: window.from, to: window.to, total: this.total });
  }

  @computed
  get pageSizeOptions(): Array<{ value: string; label: string }> {
    return PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));
  }

  goToPage(page: number): void {
    const next = Math.min(Math.max(1, Math.round(page)), this.pageCount);
    if (next === this.page) return;
    this.page = next;
    this.clearSelection();
    this.syncLocation();
    void this.reload();
  }

  setPageSize(value: string): void {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0 || size === this.pageSize) return;
    this.pageSize = Math.trunc(size);
    this.page = 1;
    this.clearSelection();
    this.syncLocation();
    void this.reload();
  }

  @computed
  get countLabel(): string {
    return t("filters.foundTotal", { total: this.total });
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
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const seq = ++this.requestSeq;
    const firstLoad = !this.hasLoaded;
    this.loading = firstLoad;
    this.refreshing = !firstLoad;
    this.error = null;
    try {
      const interfacesPromise: Promise<InterfaceInfo[]> = this.isAdmin
        ? this.interfacesService.listInterfaces()
        : this.interfacesService.listInterfaces().catch(() => []);
      const usersPromise = this.isAdmin ? this.usersService.listUsers() : Promise.resolve<User[]>([]);
      const [page, interfaces, users] = await Promise.all([
        this.devicesService.pageDevices(this.pageParams(controller.signal)),
        interfacesPromise,
        usersPromise,
      ]);
      if (seq !== this.requestSeq) return;
      this.devices = page.items;
      this.total = page.total;
      this.interfaces = interfaces;
      this.users = users;
      this.clampPage();
    } catch (error) {
      if (seq !== this.requestSeq || controller.signal.aborted) return;
      const message = userMessage(error, t("clients.error.load"));
      this.error = message;
      this.toasts.error(message);
    } finally {
      if (seq === this.requestSeq) {
        this.loading = false;
        this.refreshing = false;
        this.hasLoaded = true;
      }
    }
  }

  private reload(): Promise<void> {
    return this.load();
  }

  private pageParams(signal: AbortSignal): {
    limit: number;
    offset: number;
    query?: string;
    status?: DeviceStatusFilter;
    interfaceId?: string;
    sort?: DeviceSortField;
    order?: "asc" | "desc";
    signal: AbortSignal;
  } {
    return {
      limit: this.pageSize,
      offset: (this.page - 1) * this.pageSize,
      ...(this.appliedQuery.trim().length > 0 ? { query: this.appliedQuery.trim() } : {}),
      ...(this.statusFilter !== "all" ? { status: this.statusFilter } : {}),
      ...(this.interfaceFilter.length > 0 ? { interfaceId: this.interfaceFilter } : {}),
      ...(this.sort === null ? {} : { sort: this.sort.key, order: this.sort.direction }),
      signal,
    };
  }

  private clampPage(): void {
    const max = pageCount(this.total, this.pageSize);
    if (this.page <= max) return;
    this.page = max;
    this.syncLocation();
    void this.reload();
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    this.page = 1;
    this.selectedIds = [];
    this.applyQuery();
    this.persistFilters();
  }

  setInterfaceFilter(value: string): void {
    this.interfaceFilter = value;
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
    void this.reload();
  }

  setStatusFilter(value: string): void {
    this.statusFilter = value === "active" || value === "revoked" ? value : "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
    void this.reload();
  }

  resetFilters(): void {
    this.applyQuery.cancel();
    this.query = "";
    this.appliedQuery = "";
    this.interfaceFilter = "";
    this.statusFilter = "all";
    this.page = 1;
    this.clearSelection();
    clientsFiltersStorage.clear();
    clientsExtraFiltersStorage.clear();
    this.syncLocation();
    void this.reload();
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
      this.toasts.error(userMessage(error, t("clients.error.create")));
    } finally {
      this.submitting = false;
    }
  }

  openDevice(id: string): void {
    this.router.navigate(`/clients/${id}`);
  }

  userEmail(id: string): string {
    const user = this.users.find((item) => item.id === id);
    if (user) return user.email;
    if (this.session.user?.id === id) return this.session.user.email;
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

  interfaceChips(device: Device): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const peer of device.peers) {
      const name = peer.interface_name || "—";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (counts.size === 0 && device.interface_name) counts.set(device.interface_name, 1);
    return Array.from(counts, ([name, count]) => ({ name, count }));
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
    clientsExtraFiltersStorage.write({ status: this.statusFilter });
    this.syncLocation();
  }

  private syncLocation(): void {
    syncFilterQuery("/clients", [
      ["page", this.page > 1 ? String(this.page) : null],
      ["limit", this.pageSize !== DEFAULT_PAGE_SIZE ? String(this.pageSize) : null],
      ["q", this.query.trim().length > 0 ? this.query : null],
      ["interface", this.interfaceFilter.length > 0 ? this.interfaceFilter : null],
      ["status", this.statusFilter !== "all" ? this.statusFilter : null],
    ]);
  }

  private restoreFromLocation(): void {
    const params = readFilterQuery("/clients");
    if (params === null) return;
    if (params.has("q") || params.has("query")) {
      const query = params.get("q") ?? params.get("query") ?? "";
      this.query = query;
      this.appliedQuery = query;
    }
    const iface = params.get("interface");
    if (iface !== null && iface.length > 0) this.interfaceFilter = iface;
    const status = params.get("status");
    if (status === "active" || status === "revoked") this.statusFilter = status;
    const page = Number(params.get("page"));
    if (Number.isInteger(page) && page > 0) this.page = page;
    const limit = Number(params.get("limit"));
    if (PAGE_SIZES.includes(limit)) this.pageSize = limit;
  }

  private readonly onPopState = (): void => {
    if (readFilterQuery("/clients") === null) return;
    this.restoreFromLocation();
    this.clearSelection();
    void this.reload();
  };
}

function interfaceLabel(item: InterfaceInfo): string {
  return item.node_name.length > 0 ? `${item.name} · ${item.node_name}` : item.name;
}

function isInterfaceOnNode(item: InterfaceInfo, nodeId: string): boolean {
  return nodeId.length === 0 || item.node_id === nodeId;
}

function validateClientsExtraFilters(value: unknown): ClientsExtraFilters | null {
  if (!isRecord(value)) return null;
  const status = value["status"];
  if (status !== "all" && status !== "active" && status !== "revoked") return null;
  return { status };
}

function validateClientsFilters(value: unknown): ClientsFilters | null {
  if (!isRecord(value)) return null;
  const query = stringField(value, "query", QUERY_LIMIT);
  const interfaceFilter = stringField(value, "interfaceFilter", FILTER_ID_LIMIT);
  if (query === null || interfaceFilter === null) return null;
  return { query, interfaceFilter };
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
