import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { debounce } from "@/app/debounce";
import { compareText, nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import { validateEmail, validatePassword } from "@/application/guards";
import type { QuotaService, UserQuotaSnapshot } from "@/application/quota/service";
import type { NodesService } from "@/application/nodes/service";
import type { TariffsService } from "@/application/tariffs/service";
import type { UsersService } from "@/application/users/service";
import { formatPercent } from "@/domain/format";
import type { NodeInfo, Role, Tariff, User } from "@/domain/types";
import type { UsersBulkAction } from "@/domain/users/repository";
import { t } from "@/i18n";
import { formatBytesI18n, formatDateI18n } from "@/i18n/format";

export type UsersTab = "active" | "pending";

export interface UsersFilters {
  tab: UsersTab;
  query: string;
}

export interface UsersAdvancedFilters {
  role: "all" | Role;
  status: "all" | "active" | "disabled";
  node: string;
}

const SEARCH_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 200;
const FILTER_ID_LIMIT = 100;

const EMPTY_FILTERS: UsersFilters = { tab: "active", query: "" };
const EMPTY_ADVANCED_FILTERS: UsersAdvancedFilters = { role: "all", status: "all", node: "all" };
const PAGE_SIZES = [10, 25, 50, 100] as const;

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
  @reactive accessor pending: User[] = [];
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
  @reactive accessor statusFilter: "all" | "active" | "disabled" = "all";
  @reactive accessor nodeFilter = "all";
  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;
  @reactive accessor page = 1;
  @reactive accessor pageSize = 25;
  @reactive accessor sort: SortState<"email" | "role" | "status"> | null = { key: "email", direction: "asc" };

  private hasLoaded = false;

  private readonly applyQuery = debounce(() => {
    this.appliedQuery = this.query;
  }, SEARCH_DEBOUNCE_MS);

  @reactive accessor modalOpen = false;
  @reactive accessor editingId: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor formError: string | null = null;
  @reactive accessor emailError: string | null = null;
  @reactive accessor passwordError: string | null = null;

  @reactive accessor email = "";
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
    const stored = usersFiltersStorage.read();
    const advanced = usersAdvancedFiltersStorage.read();
    this.tab = stored.tab;
    this.query = stored.query;
    this.appliedQuery = stored.query;
    this.roleFilter = advanced.role;
    this.statusFilter = advanced.status;
    this.nodeFilter = advanced.node;
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
    const firstLoad = !this.hasLoaded;
    this.loading = firstLoad;
    this.refreshing = !firstLoad;
    this.pendingLoading = firstLoad;
    this.error = null;
    this.pendingError = null;
    this.quotaError = null;
    const [usersResult, pendingResult, tariffsResult, nodesResult, quotaResult] = await Promise.allSettled([
      this.usersService.listUsers(),
      this.usersService.listPending(),
      this.tariffsService.listTariffs(),
      this.nodesService.listNodes(),
      this.quotaService.users(),
    ]);
    this.quotas = quotaResult.status === "fulfilled" ? quotaResult.value : [];
    if (quotaResult.status === "rejected") {
      this.quotaError = userMessage(quotaResult.reason, t("quota.error.load"));
    }
    if (pendingResult.status === "fulfilled") {
      this.pending = pendingResult.value;
    } else {
      this.pendingError = userMessage(pendingResult.reason, t("users.pending.error.load"));
    }
    this.pendingLoading = false;
    try {
      if (usersResult.status === "rejected") throw usersResult.reason;
      if (tariffsResult.status === "rejected") throw tariffsResult.reason;
      if (nodesResult.status === "rejected") throw nodesResult.reason;
      this.users = usersResult.value;
      this.tariffs = tariffsResult.value;
      this.nodes = nodesResult.value;
    } catch (error) {
      this.error = userMessage(error, t("users.error.load"));
    } finally {
      this.loading = false;
      this.refreshing = false;
      this.hasLoaded = true;
      this.clampPage();
    }
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
    return this.users.filter(
      (user) => user.status !== "pending_email" && user.status !== "pending_approval",
    );
  }

  @computed
  get pendingCount(): number {
    return this.pending.length;
  }

  @computed
  get adminCount(): number {
    return this.activeUsers.filter((user) => user.role === "admin" && !user.disabled).length;
  }

  private isLastAdmin(user: User): boolean {
    return user.role === "admin" && !user.disabled && this.adminCount <= 1;
  }

  @computed
  get filteredActiveUsers(): User[] {
    const users = this.activeUsers.filter((user) => {
      if (!matchesQuery(user, this.appliedQuery)) return false;
      if (this.roleFilter !== "all" && user.role !== this.roleFilter) return false;
      if (this.statusFilter === "active" && user.disabled) return false;
      if (this.statusFilter === "disabled" && !user.disabled) return false;
      if (this.nodeFilter !== "all" && (user.node_id ?? null) !== this.nodeFilter) return false;
      return true;
    });
    const sort = this.sort;
    if (sort === null) return users;
    const direction = sort.direction;
    return [...users].sort((left, right) => {
      if (sort.key === "email") {
        const byEmail = compareText(this.userEmail(left), this.userEmail(right), direction);
        return byEmail !== 0 ? byEmail : compareText(left.id, right.id, direction);
      }
      if (sort.key === "role") return compareText(left.role, right.role, direction);
      return compareText(this.statusLabel(left), this.statusLabel(right), direction);
    });
  }

  @computed
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredActiveUsers.length / this.pageSize));
  }

  @computed
  get currentPage(): number {
    return Math.min(Math.max(1, this.page), this.pageCount);
  }

  @computed
  get pagedActiveUsers(): User[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredActiveUsers.slice(start, start + this.pageSize);
  }

  @computed
  get pageSummary(): string {
    const total = this.filteredActiveUsers.length;
    if (total === 0) return t("users.pagination.summary", { from: 0, to: 0, total: 0 });
    const from = (this.currentPage - 1) * this.pageSize + 1;
    const to = Math.min(from + this.pageSize - 1, total);
    return t("users.pagination.summary", { from, to, total });
  }

  @computed
  get pageSizeOptions(): Array<{ value: string; label: string }> {
    return PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));
  }

  goToPage(page: number): void {
    this.page = Math.min(Math.max(1, Math.round(page)), this.pageCount);
  }

  setPageSize(value: string): void {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return;
    this.pageSize = size;
    this.page = 1;
  }

  private clampPage(): void {
    if (this.page > this.pageCount) this.page = this.pageCount;
  }

  sortBy(key: "email" | "role" | "status"): void {
    this.sort = nextSort(this.sort, key);
  }

  sortMark(key: "email" | "role" | "status"): string {
    return sortIndicator(this.sort, key);
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

  selectAllFiltered(): void {
    this.selectedIds = this.filteredActiveUsers.map((user) => user.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }

  get allFilteredSelected(): boolean {
    return this.filteredActiveUsers.length > 0
      && this.filteredActiveUsers.every((user) => this.selectedIds.includes(user.id));
  }

  toggleSelectAll(): void {
    if (this.allFilteredSelected) this.clearSelection();
    else this.selectAllFiltered();
  }

  async bulkSetDisabled(disabled: boolean): Promise<void> {
    const skippedLastAdmin = this.activeUsers.some(
      (user) =>
        this.selectedIds.includes(user.id)
        && user.id !== this.selfId
        && user.disabled !== disabled
        && disabled
        && this.isLastAdmin(user),
    );
    const ids = this.activeUsers
      .filter(
        (user) =>
          this.selectedIds.includes(user.id)
          && user.id !== this.selfId
          && user.disabled !== disabled
          && !(disabled && this.isLastAdmin(user)),
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
    ].filter((line) => line.length > 0).join(" ");
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
  get filteredPending(): User[] {
    return this.pending.filter((user) => matchesQuery(user, this.appliedQuery));
  }

  @computed
  get hasActiveFilters(): boolean {
    return this.appliedQuery.trim().length > 0
      || this.roleFilter !== "all"
      || this.statusFilter !== "all"
      || this.nodeFilter !== "all";
  }

  @computed
  get activeCountLabel(): string {
    return t("filters.found", {
      found: this.filteredActiveUsers.length,
      total: this.activeUsers.length,
    });
  }

  @computed
  get pendingCountLabel(): string {
    return t("filters.found", {
      found: this.filteredPending.length,
      total: this.pending.length,
    });
  }

  setTab(value: string): void {
    this.tab = value === "pending" ? "pending" : "active";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    this.page = 1;
    this.clearSelection();
    this.applyQuery();
    this.persistFilters();
  }

  setRoleFilter(value: string): void {
    this.roleFilter = value === "admin" || value === "user" ? value : "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
  }

  setStatusFilter(value: string): void {
    this.statusFilter = value === "active" || value === "disabled" ? value : "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
  }

  setNodeFilter(value: string): void {
    this.nodeFilter = value.length > 0 ? value : "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
  }

  resetFilters(): void {
    this.applyQuery.cancel();
    this.query = "";
    this.appliedQuery = "";
    this.roleFilter = "all";
    this.statusFilter = "all";
    this.nodeFilter = "all";
    this.page = 1;
    this.clearSelection();
    this.persistFilters();
  }

  userEmail(user: User): string {
    return user.email ?? user.login;
  }

  emailLabel(user: User): string {
    return user.email ?? "—";
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
    const limit = quota.quotaBytes === null ? t("common.unlimited") : formatBytesI18n(quota.quotaBytes);
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
    this.password = "";
    this.role = "user";
    this.tariffId = "";
    this.nodeId = "";
    this.disabled = false;
    this.formError = null;
    this.emailError = null;
    this.passwordError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  openEdit(user: User): void {
    this.editingId = user.id;
    this.email = this.userEmail(user);
    this.password = "";
    this.role = user.role;
    this.tariffId = user.tariff_id ?? "";
    this.nodeId = user.node_id ?? "";
    this.disabled = user.disabled;
    this.formError = null;
    this.emailError = null;
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
    try {
      validateEmail(this.email);
    } catch (error) {
      this.emailError = userMessage(error, t("users.form.error.email"));
      this.formError = this.emailError;
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
          email: this.email.trim(),
          role: editingSelf ? this.session.user?.role ?? this.role : this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          node_id: this.nodeId ? this.nodeId : null,
          disabled: this.disabled,
        });
        this.toasts.success(t("users.toast.updated"));
        if (editingSelf) await this.session.reload();
      } else {
        try {
          validatePassword(this.password);
        } catch (error) {
          this.passwordError = userMessage(error, t("users.form.error.password"));
          this.formError = this.passwordError;
          return;
        }
        await this.usersService.createUser({
          email: this.email.trim(),
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
      await this.load();
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
    try {
      validatePassword(this.resetPassword);
    } catch (error) {
      const message = userMessage(error, t("users.reset.error.password"));
      this.resetError = message;
      this.toasts.error(message);
      return;
    }
    const target = this.resetTarget;
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
        message: t("users.confirm.disable", { login: this.userEmail(user) }),
        details: t("users.confirm.disableDetails"),
        confirmLabel: t("users.action.disable"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    try {
      await this.usersService.updateUser(user.id, { disabled: !user.disabled });
      await this.load();
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
      message: t("users.confirm.delete", { login: this.userEmail(user) }),
      details: t("users.confirm.deleteDetails"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.usersService.deleteUser(user.id);
      this.toasts.success(t("users.toast.deleted"));
      await this.load();
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
      await this.load();
    } catch (error) {
      const message = userMessage(error, t("users.pending.error.approve"));
      this.approveError = message;
      this.toasts.error(message);
    } finally {
      this.approveSaving = false;
    }
  }

  async reject(user: User): Promise<void> {
    const login = this.userEmail(user);
    const confirmed = await askConfirm({
      title: t("users.pending.rejectTitle"),
      message: t("users.pending.rejectConfirm", { login }),
      confirmLabel: t("users.pending.reject"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.usersService.rejectUser(user.id);
      this.toasts.success(t("users.pending.rejected"));
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, t("users.pending.error.reject")));
    }
  }

  private persistFilters(): void {
    usersFiltersStorage.write({ tab: this.tab, query: this.query });
    usersAdvancedFiltersStorage.write({
      role: this.roleFilter,
      status: this.statusFilter,
      node: this.nodeFilter,
    });
    this.syncLocation();
  }

  private syncLocation(): void {
    if (typeof window === "undefined") return;
    if (!window.location.pathname.startsWith("/users")) return;
    const params = new URLSearchParams();
    if (this.tab !== "active") params.set("tab", this.tab);
    if (this.query.trim().length > 0) params.set("query", this.query);
    if (this.roleFilter !== "all") params.set("role", this.roleFilter);
    if (this.statusFilter !== "all") params.set("status", this.statusFilter);
    if (this.nodeFilter !== "all") params.set("node", this.nodeFilter);
    const query = params.toString();
    const next = `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}${window.location.hash}`;
    try {
      window.history.replaceState(window.history.state, "", next);
    } catch {
      // История недоступна (sandboxed iframe) — фильтры всё равно сохранены локально.
    }
  }

  private restoreFromLocation(): void {
    if (typeof window === "undefined") return;
    if (!window.location.pathname.startsWith("/users")) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("tab")) {
      const tab = params.get("tab");
      if (tab === "active" || tab === "pending") this.tab = tab;
    }
    if (params.has("query")) {
      const query = params.get("query") ?? "";
      this.query = query;
      this.appliedQuery = query;
    }
    const role = params.get("role");
    if (role === "admin" || role === "user") this.roleFilter = role;
    const status = params.get("status");
    if (status === "active" || status === "disabled") this.statusFilter = status;
    const node = params.get("node");
    if (node !== null && node.length > 0) this.nodeFilter = node;
  }

  private readonly onPopState = (): void => {
    this.restoreFromLocation();
  };
}

function matchesQuery(user: User, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (user.email ?? user.login).toLowerCase().includes(normalized);
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
  const node = stringField(value, "node", FILTER_ID_LIMIT);
  if (node === null) return null;
  if (role !== "all" && role !== "admin" && role !== "user") return null;
  if (status !== "all" && status !== "active" && status !== "disabled") return null;
  return { role, status, node };
}
