import { computed, reactive } from "@ivlev-dev/silent-core";

import { debounce } from "@/app/debounce";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import { validatePassword } from "@/application/guards";
import type { QuotaService, UserQuotaSnapshot } from "../../application/quota/service";
import type { GroupsService } from "../../application/groups/service";
import type { TariffsService } from "../../application/tariffs/service";
import type { UsersService } from "../../application/users/service";
import { formatBytes, formatPercent } from "@/domain/format";
import type { Group, Role, Tariff, User } from "@/domain/types";
import { t } from "@/i18n";
import { formatDateI18n } from "@/i18n/format";

export type UsersTab = "active" | "pending";

export interface UsersFilters {
  tab: UsersTab;
  query: string;
}

const SEARCH_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 200;

const EMPTY_FILTERS: UsersFilters = { tab: "active", query: "" };

export const usersFiltersStorage = persistedSignal<UsersFilters>(
  "awg.ui.users.filters",
  EMPTY_FILTERS,
  validateUsersFilters,
);

export class UsersPageVM {
  @reactive accessor users: User[] = [];
  @reactive accessor pending: User[] = [];
  @reactive accessor tariffs: Tariff[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor quotas: UserQuotaSnapshot[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;
  @reactive accessor pendingLoading = false;
  @reactive accessor pendingError: string | null = null;
  @reactive accessor tab: UsersTab = "active";
  @reactive accessor query = "";
  @reactive accessor appliedQuery = "";

  private readonly applyQuery = debounce(() => {
    this.appliedQuery = this.query;
  }, SEARCH_DEBOUNCE_MS);

  @reactive accessor modalOpen = false;
  @reactive accessor editingId: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor formError: string | null = null;

  @reactive accessor login = "";
  @reactive accessor password = "";
  @reactive accessor role: Role = "user";
  @reactive accessor tariffId = "";
  @reactive accessor groupId = "";
  @reactive accessor disabled = false;

  @reactive accessor resetOpen = false;
  @reactive accessor resetTarget: User | null = null;
  @reactive accessor resetPassword = "";

  @reactive accessor approveOpen = false;
  @reactive accessor approveTarget: User | null = null;
  @reactive accessor approveTariffId = "";
  @reactive accessor approveGroupId = "";
  @reactive accessor approveSaving = false;
  @reactive accessor approveError: string | null = null;

  constructor(
    private readonly usersService: UsersService,
    private readonly tariffsService: TariffsService,
    private readonly groupsService: GroupsService,
    private readonly quotaService: QuotaService,
    private readonly session: Session,
    private readonly toasts: ToastStore,
  ) {
    const stored = usersFiltersStorage.read();
    this.tab = stored.tab;
    this.query = stored.query;
    this.appliedQuery = stored.query;
  }

  created(): void {
    void this.load();
  }

  beforeUnmount(): void {
    this.applyQuery.cancel();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.pendingLoading = true;
    this.error = null;
    this.pendingError = null;
    const [usersResult, pendingResult, tariffsResult, groupsResult, quotaResult] = await Promise.allSettled([
      this.usersService.listUsers(),
      this.usersService.listPending(),
      this.tariffsService.listTariffs(),
      this.groupsService.listGroups(),
      this.quotaService.users(),
    ]);
    this.quotas = quotaResult.status === "fulfilled" ? quotaResult.value : [];
    if (pendingResult.status === "fulfilled") {
      this.pending = pendingResult.value;
    } else {
      this.pending = [];
      this.pendingError = userMessage(pendingResult.reason, t("users.pending.error.load"));
    }
    this.pendingLoading = false;
    try {
      if (usersResult.status === "rejected") throw usersResult.reason;
      if (tariffsResult.status === "rejected") throw tariffsResult.reason;
      if (groupsResult.status === "rejected") throw groupsResult.reason;
      this.users = usersResult.value;
      this.tariffs = tariffsResult.value;
      this.groups = groupsResult.value;
    } catch (error) {
      this.error = userMessage(error, "Не удалось загрузить пользователей");
    } finally {
      this.loading = false;
    }
  }

  @computed
  get title(): string {
    return this.editingId ? "Редактировать пользователя" : "Новый пользователь";
  }

  @computed
  get selfId(): string {
    return this.session.user?.id ?? "";
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
  get filteredActiveUsers(): User[] {
    return this.activeUsers.filter((user) => matchesQuery(user, this.appliedQuery));
  }

  @computed
  get filteredPending(): User[] {
    return this.pending.filter((user) => matchesQuery(user, this.appliedQuery));
  }

  @computed
  get hasActiveFilters(): boolean {
    return this.appliedQuery.trim().length > 0;
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
    this.persistFilters();
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    this.applyQuery();
    this.persistFilters();
  }

  resetFilters(): void {
    this.applyQuery.cancel();
    this.query = "";
    this.appliedQuery = "";
    this.persistFilters();
  }

  emailLabel(user: User): string {
    return user.email ?? "—";
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
    if (!id) return "Не задан";
    return this.tariffs.find((tariff) => tariff.id === id)?.name ?? "—";
  }

  groupName(id: string | null): string {
    if (!id) return "Не задана";
    return this.groups.find((group) => group.id === id)?.name ?? "—";
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
    if (quota.exceeded) return "исчерпана";
    return quota.quotaBytes === null ? "без лимита" : "в норме";
  }

  quotaBadgeClass(userId: string): string {
    const quota = this.quotaFor(userId);
    if (!quota) return "badge badge--blue";
    if (quota.exceeded) return "badge badge--red";
    return quota.quotaBytes === null ? "badge badge--blue" : "badge badge--green";
  }

  quotaTitle(userId: string): string {
    const quota = this.quotaFor(userId);
    if (!quota) return "Квота не задана";
    const limit = quota.quotaBytes === null ? "Без ограничения" : formatBytes(quota.quotaBytes);
    return `Использовано ${formatBytes(quota.usedBytes)} из ${limit}`;
  }

  openCreate(): void {
    this.editingId = null;
    this.login = "";
    this.password = "";
    this.role = "user";
    this.tariffId = "";
    this.groupId = "";
    this.disabled = false;
    this.formError = null;
    this.modalOpen = true;
  }

  openEdit(user: User): void {
    this.editingId = user.id;
    this.login = user.login;
    this.password = "";
    this.role = user.role;
    this.tariffId = user.tariff_id ?? "";
    this.groupId = user.group_id ?? "";
    this.disabled = user.disabled;
    this.formError = null;
    this.modalOpen = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.modalOpen = false;
  }

  setLogin(event: Event): void {
    this.login = (event.target as HTMLInputElement).value;
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  setRole(value: string): void {
    this.role = value === "admin" ? "admin" : "user";
  }

  setTariff(value: string): void {
    this.tariffId = value;
  }

  setGroup(value: string): void {
    this.groupId = value;
  }

  setDisabled(event: Event): void {
    this.disabled = (event.target as HTMLInputElement).checked;
  }

  async submit(): Promise<void> {
    this.saving = true;
    this.formError = null;
    try {
      if (this.editingId) {
        await this.usersService.updateUser(this.editingId, {
          role: this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          group_id: this.groupId ? this.groupId : null,
          disabled: this.disabled,
        });
        this.toasts.success("Пользователь обновлён");
      } else {
        try {
          validatePassword(this.password);
        } catch (error) {
          this.formError = userMessage(error, "Пароль должен быть не короче 8 символов");
          return;
        }
        await this.usersService.createUser({
          login: this.login.trim(),
          password: this.password,
          role: this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          group_id: this.groupId ? this.groupId : null,
        });
        this.toasts.success("Пользователь создан");
      }
      this.modalOpen = false;
      await this.load();
    } catch (error) {
      const message = userMessage(error, "Не удалось сохранить пользователя");
      this.formError = message;
      this.toasts.error(message);
    } finally {
      this.saving = false;
    }
  }

  openReset(user: User): void {
    this.resetTarget = user;
    this.resetPassword = "";
    this.resetOpen = true;
  }

  closeReset(): void {
    this.resetOpen = false;
    this.resetTarget = null;
  }

  setResetPassword(event: Event): void {
    this.resetPassword = (event.target as HTMLInputElement).value;
  }

  async submitReset(): Promise<void> {
    if (!this.resetTarget) return;
    try {
      validatePassword(this.resetPassword);
    } catch (error) {
      this.toasts.error(userMessage(error, "Пароль должен быть не короче 8 символов"));
      return;
    }
    try {
      await this.usersService.resetPassword(this.resetTarget.id, this.resetPassword);
      this.toasts.success("Пароль обновлён");
      this.closeReset();
    } catch (error) {
      this.toasts.error(userMessage(error, "Не удалось сбросить пароль"));
    }
  }

  async toggleDisabled(user: User): Promise<void> {
    try {
      await this.usersService.updateUser(user.id, { disabled: !user.disabled });
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, "Не удалось изменить пользователя"));
    }
  }

  async remove(user: User): Promise<void> {
    if (user.id === this.selfId) {
      this.toasts.error("Нельзя удалить собственную учётную запись");
      return;
    }
    if (!window.confirm(`Удалить пользователя ${user.login}?`)) return;
    try {
      await this.usersService.deleteUser(user.id);
      this.toasts.success("Пользователь удалён");
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, "Не удалось удалить пользователя"));
    }
  }

  openApprove(user: User): void {
    this.approveTarget = user;
    this.approveTariffId = "";
    this.approveGroupId = "";
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

  setApproveGroup(value: string): void {
    this.approveGroupId = value;
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
        group_id: this.approveGroupId ? this.approveGroupId : null,
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
    const login = user.email ?? user.login;
    if (!window.confirm(t("users.pending.rejectConfirm", { login }))) return;
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
  }
}

function matchesQuery(user: User, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (user.login.toLowerCase().includes(normalized)) return true;
  return (user.email ?? "").toLowerCase().includes(normalized);
}

function validateUsersFilters(value: unknown): UsersFilters | null {
  if (!isRecord(value)) return null;
  const query = stringField(value, "query", QUERY_LIMIT);
  if (query === null) return null;
  const tab = value["tab"];
  if (tab !== "active" && tab !== "pending") return null;
  return { tab, query };
}
