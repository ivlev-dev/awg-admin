import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import type { GroupsService } from "@/application/groups/service";
import type { UsersService } from "@/application/users/service";
import { askConfirm } from "@/app/confirm";
import { debounce } from "@/app/debounce";
import { compareBoolean, compareText, nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { DevicesBulkAction } from "@/domain/devices/repository";
import type { Device, Group, User } from "@/domain/types";
import { t } from "@/i18n";
import { pluralI18n } from "@/i18n/format";

const SEARCH_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 200;
const GROUP_ID_LIMIT = 100;

export interface ClientsFilters {
  query: string;
  groupFilter: string;
}

const EMPTY_FILTERS: ClientsFilters = { query: "", groupFilter: "" };

export const clientsFiltersStorage = persistedSignal<ClientsFilters>(
  "awg.ui.clients.filters",
  EMPTY_FILTERS,
  validateClientsFilters,
);

export class ClientsPageVM {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly groupsService: GroupsService,
    private readonly usersService: UsersService,
    private readonly session: Session,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    const stored = clientsFiltersStorage.read();
    this.query = stored.query;
    this.appliedQuery = stored.query;
    this.groupFilter = this.isAdmin ? stored.groupFilter : "";
  }

  @reactive accessor devices: Device[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor users: User[] = [];
  @reactive accessor loading = true;
  @reactive accessor query = "";
  @reactive accessor appliedQuery = "";
  @reactive accessor groupFilter = "";
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
  @reactive accessor formGroupId = "";
  @reactive accessor formDownKbps = 0;
  @reactive accessor formUpKbps = 0;
  @reactive accessor formForwarding = false;

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
  get filteredDevices(): Device[] {
    const query = this.appliedQuery.trim().toLowerCase();
    const group = this.isAdmin ? this.groupFilter : "";
    const filtered = this.devices.filter((device) => {
      if (group && device.group_id !== group) return false;
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
      || (this.isAdmin && this.groupFilter.length > 0)
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
  get canCreate(): boolean {
    if (this.submitting || this.formName.trim().length === 0) return false;
    return !this.isAdmin || this.formUserId.length > 0;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const groupsPromise = this.isAdmin ? this.groupsService.listGroups() : Promise.resolve<Group[]>([]);
      const usersPromise = this.isAdmin ? this.usersService.listUsers() : Promise.resolve<User[]>([]);
      const [devices, groups, users] = await Promise.all([
        this.devicesService.listDevices(),
        groupsPromise,
        usersPromise,
      ]);
      this.devices = devices;
      this.groups = groups;
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

  setGroupFilter(value: string): void {
    this.groupFilter = value;
    this.persistFilters();
  }

  resetFilters(): void {
    this.applyQuery.cancel();
    this.query = "";
    this.appliedQuery = "";
    this.groupFilter = "";
    clientsFiltersStorage.clear();
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
    this.formName = "";
    this.formUserId = this.isAdmin ? "" : this.session.user?.id ?? "";
    this.formGroupId = this.isAdmin ? this.groupFilter : "";
    this.formDownKbps = 0;
    this.formUpKbps = 0;
    this.formForwarding = false;
    this.createOpen = true;
  }

  closeCreate(): void {
    if (this.submitting) return;
    this.createOpen = false;
  }

  async create(): Promise<void> {
    if (!this.canCreate) return;
    const userId = this.isAdmin ? this.formUserId : this.session.user?.id ?? "";
    if (!userId) {
      this.toasts.error(t("clients.error.user"));
      return;
    }
    this.submitting = true;
    try {
      const device = await this.devicesService.createDevice({
        user_id: userId,
        group_id: this.isAdmin ? this.formGroupId || null : this.session.user?.group_id ?? null,
        name: this.formName.trim(),
        down_kbps: this.formDownKbps,
        up_kbps: this.formUpKbps,
        forwarding: {
          to_own_devices: this.formForwarding,
          allowed_devices: [],
        },
      });
      this.createOpen = false;
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

  userLogin(id: string): string {
    const user = this.users.find((item) => item.id === id);
    if (user) return user.login;
    if (this.session.user?.id === id) return this.session.user.login;
    return "—";
  }

  groupName(id: string | null): string {
    if (!id) return t("clients.group.none");
    return this.groups.find((item) => item.id === id)?.name ?? id;
  }

  peersLabel(device: Device): string {
    const count = device.peers.length;
    return `${count} ${pluralI18n(count, "common.peers.one", "common.peers.few", "common.peers.many")}`;
  }

  interfaceNames(device: Device): string {
    const names = Array.from(new Set(device.peers.map((peer) => peer.interface_name)));
    return names.length > 0 ? names.join(", ") : "—";
  }

  private persistFilters(): void {
    clientsFiltersStorage.write({
      query: this.query,
      groupFilter: this.isAdmin ? this.groupFilter : "",
    });
  }
}

function validateClientsFilters(value: unknown): ClientsFilters | null {
  if (!isRecord(value)) return null;
  const query = stringField(value, "query", QUERY_LIMIT);
  const groupFilter = stringField(value, "groupFilter", GROUP_ID_LIMIT);
  if (query === null || groupFilter === null) return null;
  return { query, groupFilter };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sanitizeKbps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
