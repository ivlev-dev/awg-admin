import { For, Show } from "@ivlev-dev/silent-core";

import type { UsersPageVM } from "./UsersPage.vm";
import type { UserQuotaSnapshot } from "@/application/quota/service";
import { BulkBar } from "@/components/BulkBar";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import type { SortState } from "@/domain/table-sort";
import type { User } from "@/domain/types";
import { t } from "@/i18n";

function ariaSort(sort: SortState | null, key: string): "ascending" | "descending" | "none" {
  if (sort === null || sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function statusChipClass(user: User): string {
  if (user.disabled && user.status === "active") return "status-chip status-chip--neutral";
  switch (user.status) {
    case "active":
      return "status-chip status-chip--ok";
    case "rejected":
      return "status-chip status-chip--error";
    default:
      return "status-chip status-chip--info";
  }
}

function quotaFill(quota: UserQuotaSnapshot | null): number {
  if (quota === null || quota.percent === null) return 0;
  return Math.min(100, Math.max(0, quota.percent));
}

function quotaMeterClass(quota: UserQuotaSnapshot | null): string {
  if (quota === null) return "meter";
  if (quota.exceeded) return "meter meter--error";
  return quotaFill(quota) >= 90 ? "meter meter--warn" : "meter";
}

function quotaMeterStyle(quota: UserQuotaSnapshot | null): string {
  return `width:${quotaFill(quota)}%`;
}

export function UsersPage(this: { vm: UsersPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Доступ</div>
        <h1>Пользователи</h1>
        <p>Учётки панели, роли, тарифы и привязка к группам интерфейсов.</p>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">
          <div class="row-between wrap">
            <span>{this.vm.error}</span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> Повторить
            </button>
          </div>
        </div>
      </Show>

      <div class="tabs tabs--fill" role="tablist" aria-label="Пользователи">
        <button
          class={`tab ${this.vm.tab === "active" ? "is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={this.vm.tab === "active" ? "true" : "false"}
          onClick={() => this.vm.setTab("active")}
        >
          {t("users.tab.active")} ({this.vm.activeUsers.length})
        </button>
        <button
          class={`tab ${this.vm.tab === "pending" ? "is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={this.vm.tab === "pending" ? "true" : "false"}
          onClick={() => this.vm.setTab("pending")}
        >
          {t("users.tab.pending")} ({this.vm.pendingCount})
        </button>
      </div>

      <Show when={this.vm.tab === "active"}>
        <section class="card card--flush" aria-busy={this.vm.loading ? "true" : "false"}>
          <div class="data-toolbar">
            <div class="data-toolbar__top">
              <div>
                <div class="data-toolbar__title">Учётные записи</div>
                <div class="data-toolbar__sub">{this.vm.activeCountLabel}</div>
              </div>
              <div class="data-toolbar__actions">
                <button class="btn" type="button" onClick={() => this.vm.load()}>
                  <Icon name="refresh" size={14} class="" /> Обновить
                </button>
                <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                  <Icon name="plus" size={16} class="" /> Новый пользователь
                </button>
              </div>
            </div>
            <div class="data-toolbar__bottom">
              <div class="search">
                <Icon name="search" size={18} class="" />
                <input
                  id="users-search"
                  type="search"
                  aria-label={t("filters.search")}
                  placeholder={t("filters.search.users")}
                  value={this.vm.query}
                  onInput={(event: Event) => this.vm.setQuery(event)}
                />
              </div>
              <div class="field">
                <label for="users-role">{t("users.filter.role")}</label>
                <Select
                  id="users-role"
                  value={this.vm.roleFilter}
                  options={[
                    { value: "all", label: t("users.filter.allRoles") },
                    { value: "admin", label: t("users.role.admin") },
                    { value: "user", label: t("users.role.user") },
                  ]}
                  onChange={(value) => { this.vm.roleFilter = value as "all" | "admin" | "user"; }}
                  ariaLabel={t("users.filter.role")}
                />
              </div>
              <div class="field">
                <label for="users-status">{t("users.filter.status")}</label>
                <Select
                  id="users-status"
                  value={this.vm.statusFilter}
                  options={[
                    { value: "all", label: t("users.filter.allStatuses") },
                    { value: "active", label: t("users.status.active") },
                    { value: "disabled", label: t("users.status.disabled") },
                  ]}
                  onChange={(value) => { this.vm.statusFilter = value as "all" | "active" | "disabled"; }}
                  ariaLabel={t("users.filter.status")}
                />
              </div>
              <Show when={this.vm.hasActiveFilters}>
                <button class="btn btn--text btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                  <Icon name="close" size={14} class="" /> {t("filters.reset")}
                </button>
              </Show>
            </div>
          </div>

          <div class="data-scroll table-wrap--cards">
            <Show when={!this.vm.loading} fallback={<SkeletonTable rows={5} columns={7} />}>
              <Show
                when={this.vm.filteredActiveUsers.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__icon"><Icon name="users" size={28} class="" /></div>
                    <div class="empty__title">
                      {this.vm.activeUsers.length === 0 ? "Нет пользователей" : t("filters.emptyTitle")}
                    </div>
                    <div class="empty__text">
                      {this.vm.activeUsers.length === 0
                        ? "Создайте первую учётную запись."
                        : t("filters.emptyText")}
                    </div>
                    <div style="margin-top:14px">
                      <Show
                        when={this.vm.activeUsers.length > 0}
                        fallback={
                          <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.openCreate()}>
                            <Icon name="plus" size={14} class="" /> Новый пользователь
                          </button>
                        }
                      >
                        <button class="btn btn--outlined btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                          <Icon name="close" size={14} class="" /> {t("filters.reset")}
                        </button>
                      </Show>
                    </div>
                  </div>
                }
              >
                <table class="table table--cards table--users table--fixed">
                  <thead>
                    <tr>
                      <th class="cell-select">
                        <input
                          type="checkbox"
                          aria-label={t("users.selectAll")}
                          checked={this.vm.allFilteredSelected}
                          onChange={() => this.vm.toggleSelectAll()}
                        />
                      </th>
                      <th class="is-sortable" aria-sort={ariaSort(this.vm.sort, "login")}>
                        <button type="button" onClick={() => this.vm.sortBy("login")}>
                          Логин <span class="sort-indicator">{this.vm.sortMark("login")}</span>
                        </button>
                      </th>
                      <th class="is-sortable" style="width:140px" aria-sort={ariaSort(this.vm.sort, "role")}>
                        <button type="button" onClick={() => this.vm.sortBy("role")}>
                          Роль <span class="sort-indicator">{this.vm.sortMark("role")}</span>
                        </button>
                      </th>
                      <th style="width:128px">Тариф/группа</th>
                      <th style="width:126px">Квота</th>
                      <th class="is-sortable" style="width:120px" aria-sort={ariaSort(this.vm.sort, "status")}>
                        <button type="button" onClick={() => this.vm.sortBy("status")}>
                          {t("users.column.status")} <span class="sort-indicator">{this.vm.sortMark("status")}</span>
                        </button>
                      </th>
                      <th style="width:230px" aria-label="Действия"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.filteredActiveUsers}>
                      {(user) => (
                        <tr class={this.vm.isSelected(user.id) ? "is-selected" : ""}>
                          <td class="cell-select">
                            <input
                              type="checkbox"
                              aria-label={user.login}
                              checked={this.vm.isSelected(user.id)}
                              onChange={() => this.vm.toggleSelected(user.id)}
                            />
                          </td>
                          <td data-label="Логин">
                            <div class="cell-name">
                              <span class="cell-avatar">{user.login.slice(0, 1).toUpperCase()}</span>
                              <span class="cell-name__text">
                                <span class="strong" title={user.login}>{user.login}</span>
                                <span class="cell-sub xs muted" title={this.vm.emailLabel(user)}>
                                  {this.vm.emailLabel(user)}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td data-label="Роль">
                            <span class={`badge ${user.role === "admin" ? "badge--violet" : "badge--blue"}`}>
                              {user.role === "admin" ? "Администратор" : "Пользователь"}
                            </span>
                          </td>
                          <td data-label="Тариф/группа">
                            <div class="cell-name__text cell-stack">
                              <span class="small strong" title={this.vm.tariffName(user.tariff_id)}>
                                {this.vm.tariffName(user.tariff_id)}
                              </span>
                              <span class="xs muted" title={this.vm.groupName(user.group_id)}>
                                {this.vm.groupName(user.group_id)}
                              </span>
                            </div>
                          </td>
                          <td data-label="Квота">
                            <Show
                              when={this.vm.quotaFor(user.id)}
                              fallback={<span class="xs muted">—</span>}
                            >
                              <div class="stack-sm user-quota" title={this.vm.quotaTitle(user.id)}>
                                <div class={quotaMeterClass(this.vm.quotaFor(user.id))}>
                                  <span style={quotaMeterStyle(this.vm.quotaFor(user.id))}></span>
                                </div>
                                <span class="cell-quota">
                                  {this.vm.quotaPercentLabel(user.id)} · {this.vm.quotaStatusLabel(user.id)}
                                </span>
                              </div>
                            </Show>
                          </td>
                          <td data-label={t("users.column.status")}>
                            <span class={statusChipClass(user)}>
                              <span class="status-chip__dot"></span>
                              {this.vm.statusLabel(user)}
                            </span>
                          </td>
                          <td class="cell-actions">
                            <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openEdit(user)} aria-label="Редактировать">
                              <Icon name="edit" size={14} class="" />
                            </button>
                            <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openReset(user)} aria-label="Сбросить пароль">
                              <Icon name="shield" size={14} class="" />
                            </button>
                            <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.toggleDisabled(user)} aria-label="Включить или отключить">
                              <Icon name={user.disabled ? "check" : "warning"} size={14} class="" />
                            </button>
                            <button
                              class="btn btn--sm btn--danger btn--icon"
                              type="button"
                              disabled={user.id === this.vm.selfId}
                              onClick={() => this.vm.remove(user)}
                              aria-label="Удалить"
                            >
                              <Icon name="trash" size={14} class="" />
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </Show>
          </div>
        </section>
        <Show when={this.vm.selectedCount > 0}>
          <BulkBar
            count={this.vm.selectedCount}
            busy={this.vm.bulkBusy}
            onClear={() => this.vm.clearSelection()}
            actions={[
              { label: t("bulk.block"), onClick: () => { void this.vm.bulkSetDisabled(true); } },
              { label: t("bulk.unblock"), onClick: () => { void this.vm.bulkSetDisabled(false); } },
              { label: t("bulk.delete"), variant: "danger", onClick: () => { void this.vm.bulkDelete(); } },
            ]}
          />
        </Show>
      </Show>

      <Show when={this.vm.tab === "pending"}>
        <Show when={this.vm.pendingError}>
          <div class="alert alert--error">
            <div class="row-between wrap">
              <span>{this.vm.pendingError}</span>
              <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
                <Icon name="refresh" size={14} class="" /> Повторить
              </button>
            </div>
          </div>
        </Show>
        <section class="card card--flush" aria-busy={this.vm.pendingLoading ? "true" : "false"}>
          <div class="data-toolbar">
            <div class="data-toolbar__top">
              <div>
                <div class="data-toolbar__title">{t("users.pending.title")}</div>
                <div class="data-toolbar__sub">{this.vm.pendingCountLabel}</div>
              </div>
              <div class="data-toolbar__actions">
                <button class="btn" type="button" onClick={() => this.vm.load()}>
                  <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
                </button>
              </div>
            </div>
            <div class="data-toolbar__bottom">
              <div class="search">
                <Icon name="search" size={18} class="" />
                <input
                  id="users-pending-search"
                  type="search"
                  aria-label={t("filters.search")}
                  placeholder={t("filters.search.users")}
                  value={this.vm.query}
                  onInput={(event: Event) => this.vm.setQuery(event)}
                />
              </div>
              <Show when={this.vm.hasActiveFilters}>
                <button class="btn btn--text btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                  <Icon name="close" size={14} class="" /> {t("filters.reset")}
                </button>
              </Show>
            </div>
          </div>

          <div class="data-scroll table-wrap--cards">
            <Show when={!this.vm.pendingLoading} fallback={<SkeletonTable rows={3} columns={4} />}>
              <Show
                when={this.vm.filteredPending.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__icon"><Icon name="clock" size={28} class="" /></div>
                    <div class="empty__title">
                      {this.vm.pending.length === 0
                        ? t("users.pending.emptyTitle")
                        : t("filters.emptyTitle")}
                    </div>
                    <div class="empty__text">
                      {this.vm.pending.length === 0
                        ? t("users.pending.emptyText")
                        : t("filters.emptyText")}
                    </div>
                    <Show when={this.vm.pending.length > 0}>
                      <div style="margin-top:14px">
                        <button class="btn btn--outlined btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                          <Icon name="close" size={14} class="" /> {t("filters.reset")}
                        </button>
                      </div>
                    </Show>
                  </div>
                }
              >
                <table class="table table--cards table--users-pending table--fixed">
                  <thead>
                    <tr>
                      <th>{t("users.column.email")}</th>
                      <th class="is-sortable" style="width:180px" aria-sort={ariaSort(this.vm.sort, "login")}>
                        <button type="button" onClick={() => this.vm.sortBy("login")}>
                          Логин <span class="sort-indicator">{this.vm.sortMark("login")}</span>
                        </button>
                      </th>
                      <th style="width:160px">{t("users.pending.createdAt")}</th>
                      <th style="width:268px" aria-label="Действия"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.filteredPending}>
                      {(user) => (
                        <tr>
                          <td data-label={t("users.column.email")}>
                            <div class="cell-name">
                              <span class="cell-avatar">
                                {(user.email ?? user.login).slice(0, 1).toUpperCase()}
                              </span>
                              <span class="cell-name__text">
                                <span class="strong" title={this.vm.emailLabel(user)}>
                                  {this.vm.emailLabel(user)}
                                </span>
                                <span class="cell-sub">{user.login}</span>
                              </span>
                            </div>
                          </td>
                          <td data-label="Логин">{user.login}</td>
                          <td data-label={t("users.pending.createdAt")}>{this.vm.requestDateLabel(user)}</td>
                          <td class="cell-actions">
                            <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openApprove(user)}>
                              <Icon name="check" size={14} class="" /> {t("users.pending.approve")}
                            </button>
                            <button class="btn btn--sm btn--danger" type="button" onClick={() => this.vm.reject(user)}>
                              <Icon name="close" size={14} class="" /> {t("users.pending.reject")}
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </Show>
          </div>
        </section>
      </Show>

      <Modal
        open={this.vm.modalOpen}
        title={this.vm.title}
        onClose={() => this.vm.closeModal()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeModal()} disabled={this.vm.saving}>Отмена</button>
            <button class="btn btn--primary" type="button" onClick={() => this.vm.submit()} disabled={this.vm.saving}>
              <Show when={this.vm.saving} fallback={<span>Сохранить</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>Сохраняем…</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <div class="grid grid--2">
            <div class="field">
              <label>Логин</label>
              <input class="input" type="text" value={this.vm.login} disabled={!!this.vm.editingId} onInput={(event: Event) => this.vm.setLogin(event)} />
            </div>
            <div class="field">
              <label>Роль</label>
              <Select
                value={this.vm.role}
                options={[{ value: "user", label: "Пользователь" }, { value: "admin", label: "Администратор" }]}
                onChange={(value) => this.vm.setRole(value)}
                ariaLabel="Роль"
              />
            </div>
          </div>

          <Show when={!this.vm.editingId}>
            <div class="field">
              <label>Пароль</label>
              <input class="input" type="password" value={this.vm.password} onInput={(event: Event) => this.vm.setPassword(event)} />
              <span class="hint">Минимум 8 символов.</span>
            </div>
          </Show>

          <div class="grid grid--2">
            <div class="field">
              <label>Тариф</label>
              <Select
                value={this.vm.tariffId}
                options={[{ value: "", label: "Не задан" }, ...this.vm.tariffs.map((tariff) => ({ value: tariff.id, label: tariff.name }))]}
                onChange={(value) => this.vm.setTariff(value)}
                ariaLabel="Тариф"
              />
            </div>
            <div class="field">
              <label>Группа интерфейсов</label>
              <Select
                value={this.vm.groupId}
                options={[{ value: "", label: "Не задана" }, ...this.vm.groups.map((group) => ({ value: group.id, label: group.name }))]}
                onChange={(value) => this.vm.setGroup(value)}
                ariaLabel="Группа интерфейсов"
              />
            </div>
          </div>

          <Show when={!!this.vm.editingId}>
            <label class="checkbox">
              <input type="checkbox" checked={this.vm.disabled} onChange={(event: Event) => this.vm.setDisabled(event)} />
              Учётная запись отключена
            </label>
          </Show>

          <Show when={this.vm.formError}>
            <div class="alert alert--error">{this.vm.formError}</div>
          </Show>
        </div>
      </Modal>

      <Modal
        open={this.vm.resetOpen}
        title="Сбросить пароль"
        onClose={() => this.vm.closeReset()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeReset()}>Отмена</button>
            <button class="btn btn--primary" type="button" onClick={() => this.vm.submitReset()}>Обновить пароль</button>
          </div>
        }
      >
        <div class="stack">
          <div class="field">
            <label>Пользователь</label>
            <input class="input" type="text" value={this.vm.resetTarget?.login ?? ""} disabled />
          </div>
          <div class="field">
            <label>Новый пароль</label>
            <input class="input" type="password" value={this.vm.resetPassword} onInput={(event: Event) => this.vm.setResetPassword(event)} />
            <span class="hint">Минимум 8 символов.</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={this.vm.approveOpen}
        title={t("users.pending.approveTitle")}
        onClose={() => this.vm.closeApprove()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeApprove()} disabled={this.vm.approveSaving}>
              {t("common.cancel")}
            </button>
            <button class="btn btn--primary" type="button" onClick={() => this.vm.submitApprove()} disabled={this.vm.approveSaving}>
              <Show when={this.vm.approveSaving} fallback={<span>{t("users.pending.approve")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("common.saving")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <div class="field">
            <label>{t("users.column.email")}</label>
            <input class="input" type="text" value={this.vm.approveTarget?.email ?? ""} disabled />
          </div>
          <div class="grid grid--2">
            <div class="field">
              <label>{t("users.pending.tariff")}</label>
              <Select
                value={this.vm.approveTariffId}
                options={[
                  { value: "", label: "—" },
                  ...this.vm.tariffs.map((tariff) => ({ value: tariff.id, label: tariff.name })),
                ]}
                onChange={(value) => this.vm.setApproveTariff(value)}
                ariaLabel={t("users.pending.tariff")}
              />
            </div>
            <div class="field">
              <label>{t("users.pending.group")}</label>
              <Select
                value={this.vm.approveGroupId}
                options={[
                  { value: "", label: t("users.pending.groupOptional") },
                  ...this.vm.groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onChange={(value) => this.vm.setApproveGroup(value)}
                ariaLabel={t("users.pending.group")}
              />
            </div>
          </div>
          <Show when={this.vm.approveError}>
            <div class="alert alert--error">{this.vm.approveError}</div>
          </Show>
        </div>
      </Modal>
    </div>
  );
}
