import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { debounce } from "@/app/debounce";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { Session } from "@/app/session";
import { readFilterQuery, syncFilterQuery } from "@/app/filter-url";
import { invalidate, lookupNodes, lookupQuotas, lookupTariffs, lookupUsers } from "@/app/lookups";
import { PAGE_SIZES, pageCount, pageWindow } from "@/app/table-pagination";
import { TableController } from "@/app/table-controller";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import {
  normalizeOptionalFullName,
  validateEmail,
  validatePasswordForEmail,
} from "@/application/guards";
import type { QuotaService, UserQuotaSnapshot } from "@/application/quota/service";
import type { NodesService } from "@/application/nodes/service";
import type { TariffsService } from "@/application/tariffs/service";
import type { UsersService } from "@/application/users/service";
import { formatPercent } from "@/domain/format";
import type { NodeInfo, Role, Tariff, User } from "@/domain/types";
import { isPendingUser } from "@/domain/users/query";
import type { UsersBulkAction } from "@/domain/users/repository";
import type { UserPageParams, UserPageStatus, UserPageTab } from "@/domain/users/types";
import { t } from "@/i18n";
import { formatBytesI18n, formatDateI18n } from "@/i18n/format";

export type UsersTab = UserPageTab;

export interface UsersFilters {
  tab: UsersTab;
  query: string;
}

export interface UsersAdvancedFilters {
  role: "all" | Role;
  status: "all" | UserPageStatus;
}

const SEARCH_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 200;
const DEFAULT_PAGE_SIZE = 25;

const EMPTY_FILTERS: UsersFilters = { tab: "active", query: "" };
const EMPTY_ADVANCED_FILTERS: UsersAdvancedFilters = { role: "all", status: "all" };

export const usersFiltersStorage = persistedSignal<UsersFilters>(
  "awg.ui.users.filters",
  EMPTY_FILTERS,
  validateUsersFilters,
);

export const usersAdvancedFiltersStorage = persistedSignal<UsersAdvancedFilters>(
  "awg.ui.users.filters.advanced",
  EMPTY_ADVANCED_FILTERS,
  validateAdvancedFilters,
);

export class UsersPageVM extends ViewModel {
  @reactive accessor users: User[] = [];
  @reactive accessor activeTotal = 0;
  @reactive accessor pending: User[] = [];
  @reactive accessor pendingTotal = 0;
  @reactive accessor adminRoster: User[] = [];
  @reactive accessor tariffs: Tariff[] = [];
  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor quotas: UserQuotaSnapshot[] = [];
  @reactive accessor loading = true;
  @reactive accessor refreshing = false;
  @reactive accessor error: string | null = null;
  @reactive accessor quotaError: string | null = null;
  @reactive accessor pendingLoading = false;
  @reactive accessor pendingError: string | null = null;
  @reactive accessor tab: UsersTab = "active";
  @reactive accessor query = "";
  @reactive accessor appliedQuery = "";
  @reactive accessor roleFilter: "all" | Role = "all";
  @reactive accessor statusFilter: "all" | UserPageStatus = "all";
  @reactive accessor bulkBusy = false;
  @reactive accessor pendingPage = 1;

  private readonly table: TableController;

  private activeLoaded = false;
  private pendingLoaded = false;
  private requestSeq = 0;
  private controller: AbortController | null = null;

  private readonly applyQuery = debounce(() => {
    this.appliedQuery = this.query;
    this.persistFilters();
    void this.reload();
  }, SEARCH_DEBOUNCE_MS);

  @reactive accessor modalOpen = false;
  @reactive accessor editingId: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor formError: string | null = null;
  @reactive accessor emailError: string | null = null;
  @reactive accessor fullNameError: string | null = null;
  @reactive accessor passwordError: string | null = null;

  @reactive accessor email = "";
  @reactive accessor fullName = "";
  @reactive accessor password = "";
  @reactive accessor role: Role = "user";
  @reactive accessor tariffId = "";
  @reactive accessor nodeId = "";
  @reactive accessor disabled = false;

  @reactive accessor resetOpen = false;
  @reactive accessor resetTarget: User | null = null;
  @reactive accessor resetPassword = "";
  @reactive accessor resetSaving = false;
  @reactive accessor resetError: string | null = null;

  @reactive accessor approveOpen = false;
  @reactive accessor approveTarget: User | null = null;
  @reactive accessor approveTariffId = "";
  @reactive accessor approveNodeId = "";
  @reactive accessor approveSaving = false;
  @reactive accessor approveError: string | null = null;

  private formSnapshot = "";

  constructor(
    private readonly usersService: UsersService,
    private readonly tariffsService: TariffsService,
    private readonly nodesService: NodesService,
    private readonly quotaService: QuotaService,
    private readonly session: Session,
    private readonly toasts: ToastStore,
  ) {
    super();
    this.table = new TableController({
      items: () => this.users,
      total: () => this.activeTotal,
      initialPageSize: DEFAULT_PAGE_SIZE,
      onPageChange: () => {
        this.syncLocation();
        void this.reload();
      },
    });
    const stored = usersFiltersStorage.read();
    const advanced = usersAdvancedFiltersStorage.read();
    this.tab = stored.tab;
    this.query = stored.query;
    this.appliedQuery = stored.query;
    this.roleFilter = advanced.role;
    this.statusFilter = advanced.status;
    this.restoreFromLocation();
  }

  private listeningPopstate = false;

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

  async load(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const seq = ++this.requestSeq;
    const activeTab = this.tab === "active";
    this.loading = activeTab && !this.activeLoaded;
    this.pendingLoading = !activeTab && !this.pendingLoaded;
    this.refreshing = activeTab && this.activeLoaded;
    this.error = null;
    this.pendingError = null;
    this.quotaError = null;
    const [pageResult, tariffsResult, nodesResult, quotaResult, rosterResult] =
      await Promise.allSettled([
        this.usersService.pageUsers(
          activeTab ? this.activeParams(controller.signal) : this.pendingParams(controller.signal),
        ),
        lookupTariffs(this.tariffsService),
        lookupNodes(this.nodesService),
        lookupQuotas(this.quotaService),
        lookupUsers(this.usersService),
      ]);
    if (seq !== this.requestSeq || controller.signal.aborted) return;
    if (quotaResult.status === "fulfilled") {
      this.quotas = quotaResult.value;
    } else {
      this.quotas = [];
      this.quotaError = userMessage(quotaResult.reason, t("quota.error.load"));
    }
    if (rosterResult.status === "fulfilled") this.adminRoster = rosterResult.value;
    if (tariffsResult.status === "fulfilled") {
      this.tariffs = tariffsResult.value;
    } else if (activeTab) {
      this.error = userMessage(tariffsResult.reason, t("users.error.load"));
    }
    if (nodesResult.status === "fulfilled") {
      this.nodes = nodesResult.value;
    } else if (activeTab && this.error === null) {
      this.error = userMessage(nodesResult.reason, t("users.error.load"));
    }
    if (pageResult.status === "fulfilled") {
      if (activeTab) {
        this.users = pageResult.value.items;
        this.activeTotal = pageResult.value.total;
        this.activeLoaded = true;
      } else {
        this.pending = pageResult.value.items;
        this.pendingTotal = pageResult.value.total;
        this.pendingLoaded = true;
      }
    } else if (activeTab) {
      this.error = userMessage(pageResult.reason, t("users.error.load"));
    } else {
      this.pendingError = userMessage(pageResult.reason, t("users.pending.error.load"));
    }
    this.loading = false;
    this.pendingLoading = false;
    this.refreshing = false;
    this.clampPages();
  }

  private reload(): Promise<void> {
    return this.load();
  }

  private activeParams(signal: AbortSignal): UserPageParams {
    return {
      tab: "active",
      limit: this.pageSize,
      offset: (this.page - 1) * this.pageSize,
      ...(this.appliedQuery.trim().length > 0 ? { query: this.appliedQuery.trim() } : {}),
      ...(this.roleFilter === "all" ? {} : { role: this.roleFilter }),
      ...(this.statusFilter === "all" ? {} : { status: this.statusFilter }),
      signal,
    };
  }

  private pendingParams(signal: AbortSignal): UserPageParams {
    return {
      tab: "pending",
      limit: this.pageSize,
      offset: (this.pendingPage - 1) * this.pageSize,
      ...(this.appliedQuery.trim().length > 0 ? { query: this.appliedQuery.trim() } : {}),
      signal,
    };
  }

  private clampPages(): void {
    const maxActive = pageCount(this.activeTotal, this.pageSize);
    const maxPending = pageCount(this.pendingTotal, this.pageSize);
    const activeChanged = this.tab === "active" && this.page > maxActive;
    const pendingChanged = this.tab === "pending" && this.pendingPage > maxPending;
    if (!activeChanged && !pendingChanged) return;
    if (activeChanged) this.page = maxActive;
    if (pendingChanged) this.pendingPage = maxPending;
    this.syncLocation();
    void this.reload();
  }

  @computed
  get title(): string {
    return this.editingId ? t("users.form.title.edit") : t("users.form.title.create");
  }

  @computed
  get selfId(): string {
    return this.session.user?.id ?? "";
  }

  @computed
  get isEditingSelf(): boolean {
    return this.editingId !== null && this.editingId === this.selfId;
  }

  @computed
  get roleLocked(): boolean {
    return this.isEditingSelf;
  }

  @computed
  get activeUsers(): User[] {
    return this.users;
  }

  @computed
  get pendingCount(): number {
    return this.pendingTotal;
  }

  @computed
  get adminCount(): number {
    const roster = this.adminRoster.length > 0 ? this.adminRoster : this.users;
    return roster.filter(
      (user) => user.role === "admin" && !user.disabled && !isPendingUser(user),
    ).length;
  }

  private isLastAdmin(user: User): boolean {
    return user.role === "admin" && !user.disabled && this.adminCount <= 1;
  }

  @computed
  get pageCount(): number {
    return this.table.pageCount;
  }

  @computed
  get currentPage(): number {
    return this.table.currentPage;
  }

  get page(): number {
    return this.table.page;
  }

  set page(value: number) {
    this.table.page = value;
  }

  get pageSize(): number {
    return this.table.pageSize;
  }

  set pageSize(value: number) {
    this.table.pageSize = value;
  }

  @computed
  get pagedActiveUsers(): User[] {
    return this.users;
  }

  @computed
  get pageSummary(): string {
    const window = pageWindow(this.activeTotal, this.currentPage, this.pageSize);
    return t("users.pagination.summary", {
      from: window.from,
      to: window.to,
      total: this.activeTotal,
    });
  }

  @computed
  get pendingPageCount(): number {
    return pageCount(this.pendingTotal, this.pageSize);
  }

  @computed
  get pendingCurrentPage(): number {
    return Math.min(Math.max(1, this.pendingPage), this.pendingPageCount);
  }

  @computed
  get pendingPageSummary(): string {
    const window = pageWindow(this.pendingTotal, this.pendingCurrentPage, this.pageSize);
    return t("users.pagination.summary", {
      from: window.from,
      to: window.to,
      total: this.pendingTotal,
    });
  }

  @computed
  get pageSizeOptions(): Array<{ value: string; label: string }> {
    return PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));
  }

  goToPage(page: number): void {
    this.table.goToPage(page);
  }

  goToPendingPage(page: number): void {
    const next = Math.min(Math.max(1, Math.round(page)), this.pendingPageCount);
    if (next === this.pendingPage) return;
    this.pendingPage = next;
    this.clearSelection();
    this.syncLocation();
    void this.reload();
  }

  setPageSize(value: string): void {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0 || size === this.pageSize) return;
    this.pendingPage = 1;
    this.table.setPageSize(value);
  }

  @computed
  get selectedCount(): number {
    return this.table.selectedCount;
  }

  get selectedIds(): string[] {
    return this.table.selectedIds;
  }

  set selectedIds(value: string[]) {
    this.table.selectedIds = value;
  }

  isSelected(id: string): boolean {
    return this.table.isSelected(id);
  }

  toggleSelected(id: string): void {
    this.table.toggleSelected(id);
  }

  selectAllFiltered(): void {
    this.selectedIds = this.users.map((user) => user.id);
  }

  clearSelection(): void {
    this.table.clearSelection();
  }

  get allFilteredSelected(): boolean {
    return this.table.allSelected;
  }

  toggleSelectAll(): void {
    this.table.toggleSelectAll();
  }

  async bulkSetDisabled(disabled: boolean): Promise<void> {
    const skippedLastAdmin = this.activeUsers.some(
      (user) =>
        this.selectedIds.includes(user.id) &&
        user.id !== this.selfId &&
        user.disabled !== disabled &&
        disabled &&
        this.isLastAdmin(user),
    );
    const ids = this.activeUsers
      .filter(
        (user) =>
          this.selectedIds.includes(user.id) &&
          user.id !== this.selfId &&
          user.disabled !== disabled &&
          !(disabled && this.isLastAdmin(user)),
      )
      .map((user) => user.id);
    if (ids.length === 0) {
      if (skippedLastAdmin) this.toasts.error(t("users.error.lastAdmin"));
      return;
    }
    if (skippedLastAdmin) this.toasts.error(t("users.error.lastAdmin"));
    await this.runBulk(disabled ? "disable" : "enable", ids);
  }

  async bulkDelete(): Promise<void> {
    const targets = this.activeUsers.filter(
      (user) => this.selectedIds.includes(user.id) && user.id !== this.selfId,
    );
    const lastAdmin = targets.find((user) => this.isLastAdmin(user));
    if (lastAdmin !== undefined) {
      this.toasts.error(t("users.error.lastAdmin"));
      return;
    }
    if (targets.length === 0) return;
    const ids = targets.map((user) => user.id);
    const selfSkipped = this.selectedIds.includes(this.selfId);
    const details = [
      t("users.bulk.deleteDetails"),
      selfSkipped ? t("users.bulk.skipSelf") : "",
    ]
      .filter((line) => line.length > 0)
      .join(" ");
    const confirmed = await askConfirm({
      title: t("users.bulk.delete.title"),
      message: t("bulk.confirm.delete", { count: ids.length }),
      details,
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    await this.runBulk("delete", ids);
  }

  private async runBulk(action: UsersBulkAction, ids: readonly string[]): Promise<void> {
    this.bulkBusy = true;
    try {
      const result = await this.usersService.bulk(action, ids);
      invalidate("users", this.usersService);
      invalidate("quotas", this.quotaService);
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
  get hasActiveFilters(): boolean {
    return (
      this.appliedQuery.trim().length > 0 ||
      this.roleFilter !== "all" ||
      this.statusFilter !== "all"
    );
  }

  @computed
  get hasPendingFilters(): boolean {
    return this.appliedQuery.trim().length > 0;
  }

  @computed
  get activeCountLabel(): string {
    return t("filters.foundTotal", { total: this.activeTotal });
  }

  @computed
  get pendingCountLabel(): string {
    return t("filters.foundTotal", { total: this.pendingTotal });
  }

  setTab(value: string): void {
    this.tab = value === "pending" ? "pending" : "active";
    this.page = 1;
    this.pendingPage = 1;
    this.clearSelection();
    this.persistFilters();
    void this.reload();
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    this.page = 1;
    this.pendingPage = 1;
    this.clearSelection();
    this.applyQuery();
  }

  setRoleFilter(value: string): void {
    this.roleFilter = value === "admin" || value === "user" ? value : "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
    void this.reload();
  }

  setStatusFilter(value: string): void {
    this.statusFilter = value === "active" || value === "disabled" ? value : "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
    void this.reload();
  }

  resetFilters(): void {
    this.applyQuery.cancel();
    this.query = "";
    this.appliedQuery = "";
    this.roleFilter = "all";
    this.statusFilter = "all";
    this.page = 1;
    this.pendingPage = 1;
    this.clearSelection();
    this.persistFilters();
    void this.reload();
  }

  userEmail(user: User): string {
    return user.email;
  }

  userFullName(user: User): string {
    return user.full_name?.trim() || "—";
  }

  resetTargetEmail(): string {
    const target = this.resetTarget;
    return target === null ? "" : this.userEmail(target);
  }

  approveTargetEmail(): string {
    const target = this.approveTarget;
    return target === null ? "" : this.userEmail(target);
  }

  statusLabel(user: User): string {
    if (user.disabled && user.status === "active") return t("users.status.disabled");
    return t(`users.status.${user.status}`);
  }

  statusBadgeClass(user: User): string {
    if (user.disabled && user.status === "active") return "badge badge--red";
    switch (user.status) {
      case "active":
        return "badge badge--green";
      case "rejected":
        return "badge badge--red";
      case "pending_approval":
        return "badge badge--blue";
      case "pending_email":
        return "badge badge--violet";
      default:
        return "badge badge--blue";
    }
  }

  requestDateLabel(user: User): string {
    return formatDateI18n(user.created_at);
  }

  tariffName(id: string | null): string {
    if (!id) return t("users.form.tariffNone");
    return this.tariffs.find((tariff) => tariff.id === id)?.name ?? "—";
  }

  nodeName(id: string | null | undefined): string {
    if (!id) return "—";
    return this.nodes.find((node) => node.id === id)?.name ?? "—";
  }

  quotaFor(userId: string): UserQuotaSnapshot | null {
    return this.quotas.find((quota) => quota.userId === userId) ?? null;
  }

  quotaPercentLabel(userId: string): string {
    const quota = this.quotaFor(userId);
    return quota ? formatPercent(quota.percent) : "—";
  }

  quotaStatusLabel(userId: string): string {
    const quota = this.quotaFor(userId);
    if (!quota) return "";
    if (quota.exceeded) return t("users.quota.exceeded");
    return quota.quotaBytes === null ? t("users.quota.noLimit") : t("users.quota.normal");
  }

  quotaBadgeClass(userId: string): string {
    const quota = this.quotaFor(userId);
    if (!quota) return "badge badge--blue";
    if (quota.exceeded) return "badge badge--red";
    return quota.quotaBytes === null ? "badge badge--blue" : "badge badge--green";
  }

  quotaHasPercent(userId: string): boolean {
    const quota = this.quotaFor(userId);
    return quota !== null && quota.percent !== null;
  }

  quotaTitle(userId: string): string {
    const quota = this.quotaFor(userId);
    if (!quota) return t("users.quota.none");
    const limit =
      quota.quotaBytes === null ? t("common.unlimited") : formatBytesI18n(quota.quotaBytes);
    return t("users.quota.usedOf", { used: formatBytesI18n(quota.usedBytes), limit });
  }

  quotaCellLabel(userId: string): string {
    const quota = this.quotaFor(userId);
    if (quota !== null) return `${this.quotaPercentLabel(userId)} · ${this.quotaStatusLabel(userId)}`;
    return this.quotaError !== null ? t("users.quota.missing") : "—";
  }

  formState(): string {
    return JSON.stringify([
      this.email,
      this.fullName,
      this.password,
      this.role,
      this.tariffId,
      this.nodeId,
      this.disabled,
    ]);
  }

  @computed
  get formDirty(): boolean {
    return this.modalOpen && !this.saving && this.formState() !== this.formSnapshot;
  }

  openCreate(): void {
    this.editingId = null;
    this.email = "";
    this.fullName = "";
    this.password = "";
    this.role = "user";
    this.tariffId = "";
    this.nodeId = "";
    this.disabled = false;
    this.formError = null;
    this.emailError = null;
    this.fullNameError = null;
    this.passwordError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  openEdit(user: User): void {
    this.editingId = user.id;
    this.email = this.userEmail(user);
    this.fullName = user.full_name ?? "";
    this.password = "";
    this.role = user.role;
    this.tariffId = user.tariff_id ?? "";
    this.nodeId = user.node_id ?? "";
    this.disabled = user.disabled;
    this.formError = null;
    this.emailError = null;
    this.fullNameError = null;
    this.passwordError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  async closeModal(): Promise<void> {
    if (this.saving) return;
    if (this.formDirty) {
      const confirmed = await askConfirm({
        title: t("users.discard.title"),
        message: t("users.discard.message"),
        confirmLabel: t("users.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.modalOpen = false;
    this.password = "";
    this.formSnapshot = "";
  }

  setEmail(event: Event): void {
    this.email = (event.target as HTMLInputElement).value;
    this.emailError = null;
  }

  setFullName(event: Event): void {
    this.fullName = (event.target as HTMLInputElement).value;
    this.fullNameError = null;
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
    this.passwordError = null;
  }

  setRole(value: string): void {
    if (this.roleLocked) return;
    this.role = value === "admin" ? "admin" : "user";
  }

  setTariff(value: string): void {
    this.tariffId = value;
  }

  setNode(value: string): void {
    this.nodeId = value;
  }

  setDisabled(event: Event): void {
    this.disabled = (event.target as HTMLInputElement).checked;
  }

  async submit(): Promise<void> {
    if (this.saving) return;
    let email = "";
    try {
      email = validateEmail(this.email);
    } catch (error) {
      this.emailError = userMessage(error, t("users.form.error.email"));
      this.formError = this.emailError;
      return;
    }
    let fullName: string | null = null;
    try {
      fullName = normalizeOptionalFullName(this.fullName) ?? null;
    } catch (error) {
      this.fullNameError = userMessage(error, t("users.form.error.fullName"));
      this.formError = this.fullNameError;
      return;
    }
    const editingSelf = this.isEditingSelf;
    if (this.editingId && this.disabled && !editingSelf) {
      const target = this.users.find((user) => user.id === this.editingId);
      if (target !== undefined && this.isLastAdmin(target)) {
        this.formError = t("users.error.lastAdmin");
        this.toasts.error(t("users.error.lastAdmin"));
        return;
      }
    }
    this.saving = true;
    this.formError = null;
    try {
      if (this.editingId) {
        await this.usersService.updateUser(this.editingId, {
          email,
          full_name: fullName,
          role: editingSelf ? this.session.user?.role ?? this.role : this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          node_id: this.nodeId ? this.nodeId : null,
          disabled: this.disabled,
        });
        this.toasts.success(t("users.toast.updated"));
        if (editingSelf) await this.session.reload();
      } else {
        try {
          validatePasswordForEmail(this.password, email);
        } catch (error) {
          this.passwordError = userMessage(error, t("users.form.error.password"));
          this.formError = this.passwordError;
          return;
        }
        await this.usersService.createUser({
          email,
          full_name: fullName,
          password: this.password,
          role: this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          node_id: this.nodeId ? this.nodeId : null,
        });
        this.toasts.success(t("users.toast.created"));
      }
      this.modalOpen = false;
      this.password = "";
      this.formSnapshot = "";
      await this.reloadAfterMutation();
    } catch (error) {
      const message = userMessage(error, t("users.form.error.save"));
      this.formError = message;
      this.toasts.error(message);
    } finally {
      this.saving = false;
    }
  }

  openReset(user: User): void {
    this.resetTarget = user;
    this.resetPassword = "";
    this.resetError = null;
    this.resetOpen = true;
  }

  closeReset(): void {
    if (this.resetSaving) return;
    this.resetOpen = false;
    this.resetTarget = null;
    this.resetPassword = "";
    this.resetError = null;
  }

  setResetPassword(event: Event): void {
    this.resetPassword = (event.target as HTMLInputElement).value;
    if (this.resetError !== null) this.resetError = null;
  }

  async submitReset(): Promise<void> {
    if (!this.resetTarget || this.resetSaving) return;
    const target = this.resetTarget;
    try {
      validatePasswordForEmail(this.resetPassword, target.email);
    } catch (error) {
      const message = userMessage(error, t("users.reset.error.password"));
      this.resetError = message;
      this.toasts.error(message);
      return;
    }
    this.resetSaving = true;
    this.resetError = null;
    try {
      await this.usersService.resetPassword(target.id, this.resetPassword);
      this.toasts.success(t("users.reset.done"));
      this.resetOpen = false;
      this.resetTarget = null;
      this.resetPassword = "";
    } catch (error) {
      const message = userMessage(error, t("users.reset.error.save"));
      this.resetError = message;
      this.toasts.error(message);
    } finally {
      this.resetSaving = false;
    }
  }

  async toggleDisabled(user: User): Promise<void> {
    if (!user.disabled && this.isLastAdmin(user)) {
      this.toasts.error(t("users.error.lastAdmin"));
      return;
    }
    if (!user.disabled) {
      const confirmed = await askConfirm({
        title: t("users.confirm.disable.title"),
        message: t("users.confirm.disable", { email: this.userEmail(user) }),
        details: t("users.confirm.disableDetails"),
        confirmLabel: t("users.action.disable"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    try {
      await this.usersService.updateUser(user.id, { disabled: !user.disabled });
      await this.reloadAfterMutation();
    } catch (error) {
      this.toasts.error(userMessage(error, t("users.error.toggle")));
    }
  }

  async remove(user: User): Promise<void> {
    if (user.id === this.selfId) {
      this.toasts.error(t("users.error.selfDelete"));
      return;
    }
    if (this.isLastAdmin(user)) {
      this.toasts.error(t("users.error.lastAdmin"));
      return;
    }
    const confirmed = await askConfirm({
      title: t("users.confirm.delete.title"),
      message: t("users.confirm.delete", { email: this.userEmail(user) }),
      details: t("users.confirm.deleteDetails"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.usersService.deleteUser(user.id);
      this.toasts.success(t("users.toast.deleted"));
      await this.reloadAfterMutation();
    } catch (error) {
      this.toasts.error(userMessage(error, t("users.error.delete")));
    }
  }

  openApprove(user: User): void {
    this.approveTarget = user;
    this.approveTariffId = "";
    this.approveNodeId = "";
    this.approveError = null;
    this.approveOpen = true;
  }

  closeApprove(): void {
    if (this.approveSaving) return;
    this.approveOpen = false;
    this.approveTarget = null;
    this.approveError = null;
  }

  setApproveTariff(value: string): void {
    this.approveTariffId = value;
    this.approveError = null;
  }

  setApproveNode(value: string): void {
    this.approveNodeId = value;
  }

  async submitApprove(): Promise<void> {
    if (!this.approveTarget || this.approveSaving) return;
    if (!this.approveTariffId) {
      this.approveError = t("users.pending.error.tariff");
      return;
    }
    this.approveSaving = true;
    this.approveError = null;
    try {
      await this.usersService.approveUser(this.approveTarget.id, {
        tariff_id: this.approveTariffId,
        node_id: this.approveNodeId ? this.approveNodeId : null,
      });
      this.toasts.success(t("users.pending.approved"));
      this.approveOpen = false;
      this.approveTarget = null;
      await this.reloadAfterMutation();
    } catch (error) {
      const message = userMessage(error, t("users.pending.error.approve"));
      this.approveError = message;
      this.toasts.error(message);
    } finally {
      this.approveSaving = false;
    }
  }

  async reject(user: User): Promise<void> {
    const email = this.userEmail(user);
    const confirmed = await askConfirm({
      title: t("users.pending.rejectTitle"),
      message: t("users.pending.rejectConfirm", { email }),
      confirmLabel: t("users.pending.reject"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.usersService.rejectUser(user.id);
      this.toasts.success(t("users.pending.rejected"));
      await this.reloadAfterMutation();
    } catch (error) {
      this.toasts.error(userMessage(error, t("users.pending.error.reject")));
    }
  }

  private async reloadAfterMutation(): Promise<void> {
    invalidate("users", this.usersService);
    invalidate("quotas", this.quotaService);
    await this.load();
  }

  private persistFilters(): void {
    usersFiltersStorage.write({ tab: this.tab, query: this.query });
    usersAdvancedFiltersStorage.write({
      role: this.roleFilter,
      status: this.statusFilter,
    });
    this.syncLocation();
  }

  private syncLocation(): void {
    const visiblePage = this.tab === "pending" ? this.pendingPage : this.page;
    syncFilterQuery("/users", [
      ["tab", this.tab !== "active" ? this.tab : null],
      ["page", visiblePage > 1 ? String(visiblePage) : null],
      ["limit", this.pageSize !== DEFAULT_PAGE_SIZE ? String(this.pageSize) : null],
      ["q", this.appliedQuery.trim().length > 0 ? this.appliedQuery : null],
      ["role", this.roleFilter !== "all" ? this.roleFilter : null],
      ["status", this.statusFilter !== "all" ? this.statusFilter : null],
    ]);
  }

  private restoreFromLocation(): void {
    const params = readFilterQuery("/users");
    if (params === null) return;
    if (params.has("tab")) {
      const tab = params.get("tab");
      if (tab === "active" || tab === "pending") this.tab = tab;
    }
    if (params.has("q") || params.has("query")) {
      const query = params.get("q") ?? params.get("query") ?? "";
      this.query = query;
      this.appliedQuery = query;
    }
    const role = params.get("role");
    if (role === "admin" || role === "user") this.roleFilter = role;
    const status = params.get("status");
    if (status === "active" || status === "disabled") this.statusFilter = status;
    const page = Number(params.get("page"));
    if (Number.isInteger(page) && page > 0) {
      this.page = page;
      this.pendingPage = page;
    }
    const limit = Number(params.get("limit"));
    if (PAGE_SIZES.includes(limit)) this.pageSize = limit;
  }

  private readonly onPopState = (): void => {
    if (readFilterQuery("/users") === null) return;
    this.restoreFromLocation();
    this.clearSelection();
    void this.reload();
  };
}

function validateUsersFilters(value: unknown): UsersFilters | null {
  if (!isRecord(value)) return null;
  const query = stringField(value, "query", QUERY_LIMIT);
  if (query === null) return null;
  const tab = value["tab"];
  if (tab !== "active" && tab !== "pending") return null;
  return { tab, query };
}

function validateAdvancedFilters(value: unknown): UsersAdvancedFilters | null {
  if (!isRecord(value)) return null;
  const role = value["role"];
  const status = value["status"];
  if (role !== "all" && role !== "admin" && role !== "user") return null;
  if (status !== "all" && status !== "active" && status !== "disabled") return null;
  return { role, status };
}
