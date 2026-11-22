import { For, Show } from "@ivlev-dev/silent-core";

import type { UsersPageVM } from "./UsersPage.vm";
import type { UserQuotaSnapshot } from "@/application/quota/service";
import { BulkBar } from "@/components/BulkBar";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import type { User } from "@/domain/types";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/domain/validation";
import { t } from "@/i18n";

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
  const form = this.vm.userForm;
  const email = form.getFieldProps("email");
  const fullName = form.getFieldProps("fullName");
  const password = form.getFieldProps("password");
  const tariff = form.getFieldProps("tariffId");
  const node = form.getFieldProps("nodeId");
  const disabled = form.getFieldProps("disabled");
  const resetForm = this.vm.resetForm;
  const newPassword = resetForm.getFieldProps("newPassword");

  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("users.eyebrow")}</div>
        <h1>{t("users.title")}</h1>
        <p>{t("users.subtitle")}</p>
      </div>

      <Show when={this.vm.error && this.vm.users.length > 0}>
        <ErrorState message={this.vm.error ?? ""} onRetry={() => { void this.vm.load(); }} />
      </Show>

      <div class="tabs tabs--fill" role="group" aria-label={t("users.tabsLabel")}>
        <button
          class={`tab ${this.vm.tab === "active" ? "is-active" : ""}`}
          type="button"
          aria-pressed={this.vm.tab === "active" ? "true" : "false"}
          onClick={() => this.vm.setTab("active")}
        >
          {t("users.tab.active")} ({this.vm.activeTotal})
        </button>
        <button
          class={`tab ${this.vm.tab === "pending" ? "is-active" : ""}`}
          type="button"
          aria-pressed={this.vm.tab === "pending" ? "true" : "false"}
          onClick={() => this.vm.setTab("pending")}
        >
          {t("users.tab.pending")} ({this.vm.pendingCount})
        </button>
      </div>

      <Show when={this.vm.tab === "active"}>
        <section class="card card--flush" aria-busy={this.vm.loading || this.vm.refreshing ? "true" : "false"}>
          <div class="data-toolbar">
            <div class="data-toolbar__top">
              <div>
                <div class="data-toolbar__title">{t("users.table.title")}</div>
                <div class="data-toolbar__sub">{this.vm.activeCountLabel}</div>
              </div>
              <div class="data-toolbar__actions">
                <button
                  class="btn"
                  type="button"
                  disabled={this.vm.loading || this.vm.refreshing}
                  onClick={() => { void this.vm.load(); }}
                >
                  <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
                </button>
                <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                  <Icon name="plus" size={16} class="" /> {t("users.new")}
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
                  placeholder={t("users.filter.email")}
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
                  onChange={(value) => this.vm.setRoleFilter(value)}
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
                  onChange={(value) => this.vm.setStatusFilter(value)}
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

          <Show when={this.vm.quotaError}>
            <div class="alert alert--warn alert--with-action">
              <Icon name="warning" size={16} class="" />
              <span>{t("quota.error.load")}</span>
              <button class="btn btn--sm" type="button" onClick={() => { void this.vm.load(); }}>
                {t("common.retry")}
              </button>
            </div>
          </Show>

          <div class="data-scroll table-wrap--cards">
            <Show when={!this.vm.loading} fallback={<SkeletonTable rows={5} columns={8} />}>
              <Show
                when={!(this.vm.error && this.vm.users.length === 0)}
                fallback={
                  <div class="empty" role="alert">
                    <div class="empty__icon"><Icon name="warning" size={28} class="" /></div>
                    <div class="empty__title">{t("users.error.load")}</div>
                    <div class="empty__text">{this.vm.error}</div>
                    <div style="margin-top:14px">
                      <button class="btn btn--primary btn--sm" type="button" onClick={() => { void this.vm.load(); }}>
                        <Icon name="refresh" size={14} class="" /> {t("common.retry")}
                      </button>
                    </div>
                  </div>
                }
              >
                <Show
                  when={this.vm.users.length > 0}
                  fallback={
                    <div class="empty">
                      <div class="empty__icon"><Icon name="users" size={28} class="" /></div>
                      <div class="empty__title">
                        {this.vm.hasActiveFilters ? t("filters.emptyTitle") : t("users.empty.title")}
                      </div>
                      <div class="empty__text">
                        {this.vm.hasActiveFilters ? t("filters.emptyText") : t("users.empty.text")}
                      </div>
                      <div style="margin-top:14px">
                        <Show
                          when={this.vm.hasActiveFilters}
                          fallback={
                            <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.openCreate()}>
                              <Icon name="plus" size={14} class="" /> {t("users.new")}
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
                  <table class="table table--cards table--users table--desktop" aria-label={t("users.table.title")}>
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
                        <th class="col-user" aria-sort="none">{t("users.column.fullName")}</th>
                        <th class="col-email" aria-sort="none">{t("users.column.email")}</th>
                        <th class="col-role" aria-sort="none">{t("users.column.role")}</th>
                        <th class="col-tariff" aria-sort="none">{t("users.column.tariffNode")}</th>
                        <th class="col-quota" aria-sort="none">{t("users.column.quota")}</th>
                        <th class="col-status" aria-sort="none">{t("users.column.status")}</th>
                        <th class="col-actions" aria-label={t("users.column.actions")}></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.pagedActiveUsers}>
                        {(user) => (
                          <tr class={this.vm.isSelected(user.id) ? "is-selected" : ""}>
                            <td class="cell-select">
                              <input
                                type="checkbox"
                                aria-label={t("users.selectRow", { email: this.vm.userEmail(user) })}
                                checked={this.vm.isSelected(user.id)}
                                onChange={() => this.vm.toggleSelected(user.id)}
                              />
                            </td>
                            <td class="col-user" data-label={t("users.column.fullName")}>
                              <div class="cell-name">
                                <span class="cell-avatar">{this.vm.userFullName(user).slice(0, 1).toUpperCase()}</span>
                                <span class="cell-name__text">
                                  <span class="strong" title={this.vm.userFullName(user)}>
                                    {this.vm.userFullName(user)}
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td class="col-email" data-label={t("users.column.email")}>
                              <span class="small" title={this.vm.userEmail(user)}>
                                {this.vm.userEmail(user)}
                              </span>
                            </td>
                            <td class="col-role" data-label={t("users.column.role")}>
                              <span class={`badge ${user.role === "admin" ? "badge--violet" : "badge--blue"}`}>
                                {user.role === "admin" ? t("users.role.admin") : t("users.role.user")}
                              </span>
                            </td>
                            <td class="col-tariff" data-label={t("users.column.tariffNode")}>
                              <div class="cell-name__text cell-stack">
                                <span class="small strong" title={this.vm.tariffName(user.tariff_id)}>
                                  {this.vm.tariffName(user.tariff_id)}
                                </span>
                                <span class="xs muted" title={this.vm.nodeName(user.node_id)}>
                                  {this.vm.nodeName(user.node_id)}
                                </span>
                              </div>
                            </td>
                            <td class="col-quota" data-label={t("users.column.quota")}>
                              <Show
                                when={this.vm.quotaFor(user.id)}
                                fallback={
                                  <span class="xs muted">
                                    {this.vm.quotaError !== null ? t("users.quota.missing") : "—"}
                                  </span>
                                }
                              >
                                <div class="stack-sm user-quota" title={this.vm.quotaTitle(user.id)}>
                                  <Show when={this.vm.quotaHasPercent(user.id)}>
                                    <div class={quotaMeterClass(this.vm.quotaFor(user.id))}>
                                      <span style={quotaMeterStyle(this.vm.quotaFor(user.id))}></span>
                                    </div>
                                  </Show>
                                  <span class="cell-quota">
                                    {this.vm.quotaPercentLabel(user.id)} · {this.vm.quotaStatusLabel(user.id)}
                                  </span>
                                </div>
                              </Show>
                            </td>
                            <td class="col-status cell-status" data-label={t("users.column.status")}>
                              <span class={statusChipClass(user)}>
                                <span class="status-chip__dot"></span>
                                {this.vm.statusLabel(user)}
                              </span>
                            </td>
                            <td class="cell-actions col-actions">
                              <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openEdit(user)} aria-label={t("users.action.edit")} title={t("users.action.edit")}>
                                <Icon name="edit" size={14} class="" />
                              </button>
                              <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openReset(user)} aria-label={t("users.action.reset")} title={t("users.action.reset")}>
                                <Icon name="shield" size={14} class="" />
                              </button>
                              <button
                                class="btn btn--sm btn--ghost btn--icon"
                                type="button"
                                disabled={user.id === this.vm.selfId}
                                title={user.id === this.vm.selfId ? t("users.selfDisable") : user.disabled ? t("users.action.enable") : t("users.action.disable")}
                                onClick={() => { void this.vm.toggleDisabled(user); }}
                                aria-label={t("users.action.toggle")}
                              >
                                <Icon name={user.disabled ? "check" : "warning"} size={14} class="" />
                              </button>
                              <button
                                class="btn btn--sm btn--danger btn--icon"
                                type="button"
                                disabled={user.id === this.vm.selfId}
                                onClick={() => { void this.vm.remove(user); }}
                                aria-label={t("users.action.delete")} title={t("users.action.delete")}
                              >
                                <Icon name="trash" size={14} class="" />
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>

                  <div class="data-pagination">
                    <span class="small muted" aria-live="polite">{this.vm.pageSummary}</span>
                    <div class="row" style="gap:8px;align-items:center">
                      <span class="small muted">{t("users.pagination.size")}</span>
                      <Select
                        value={String(this.vm.pageSize)}
                        options={this.vm.pageSizeOptions}
                        onChange={(value) => this.vm.setPageSize(value)}
                        ariaLabel={t("users.pagination.size")}
                      />
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("users.pagination.prev")}
                        disabled={this.vm.currentPage <= 1}
                        onClick={() => this.vm.goToPage(this.vm.currentPage - 1)}
                      >
                        <Icon name="chevron" size={14} class="" />
                      </button>
                      <span class="small" aria-label={t("users.pagination.page", { page: this.vm.currentPage, pages: this.vm.pageCount })}>
                        {this.vm.currentPage} / {this.vm.pageCount}
                      </span>
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("users.pagination.next")}
                        disabled={this.vm.currentPage >= this.vm.pageCount}
                        onClick={() => this.vm.goToPage(this.vm.currentPage + 1)}
                      >
                        <Icon name="chevron" size={14} class="" />
                      </button>
                    </div>
                  </div>
                </Show>
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
        <Show when={this.vm.pendingError && this.vm.pending.length > 0}>
          <ErrorState message={this.vm.pendingError ?? ""} onRetry={() => { void this.vm.load(); }} />
        </Show>
        <section class="card card--flush" aria-busy={this.vm.pendingLoading || this.vm.refreshing ? "true" : "false"}>
          <div class="data-toolbar">
            <div class="data-toolbar__top">
              <div>
                <div class="data-toolbar__title">{t("users.pending.title")}</div>
                <div class="data-toolbar__sub">{this.vm.pendingCountLabel}</div>
              </div>
              <div class="data-toolbar__actions">
                <button
                  class="btn"
                  type="button"
                  disabled={this.vm.pendingLoading || this.vm.refreshing}
                  onClick={() => { void this.vm.load(); }}
                >
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
                  placeholder={t("users.filter.email")}
                  value={this.vm.query}
                  onInput={(event: Event) => this.vm.setQuery(event)}
                />
              </div>
              <Show when={this.vm.hasPendingFilters}>
                <button class="btn btn--text btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                  <Icon name="close" size={14} class="" /> {t("filters.reset")}
                </button>
              </Show>
            </div>
          </div>

          <div class="data-scroll table-wrap--cards">
            <Show when={!this.vm.pendingLoading} fallback={<SkeletonTable rows={3} columns={5} />}>
              <Show
                when={!(this.vm.pendingError && this.vm.pending.length === 0)}
                fallback={
                  <div class="empty" role="alert">
                    <div class="empty__icon"><Icon name="warning" size={28} class="" /></div>
                    <div class="empty__title">{t("users.pending.error.load")}</div>
                    <div class="empty__text">{this.vm.pendingError}</div>
                    <div style="margin-top:14px">
                      <button class="btn btn--primary btn--sm" type="button" onClick={() => { void this.vm.load(); }}>
                        <Icon name="refresh" size={14} class="" /> {t("common.retry")}
                      </button>
                    </div>
                  </div>
                }
              >
                <Show
                  when={this.vm.pending.length > 0}
                  fallback={
                    <div class="empty">
                      <div class="empty__icon"><Icon name="clock" size={28} class="" /></div>
                      <div class="empty__title">
                        {this.vm.appliedQuery.trim().length > 0
                          ? t("filters.emptyTitle")
                          : t("users.pending.emptyTitle")}
                      </div>
                      <div class="empty__text">
                        {this.vm.appliedQuery.trim().length > 0
                          ? t("filters.emptyText")
                          : t("users.pending.emptyText")}
                      </div>
                      <Show when={this.vm.appliedQuery.trim().length > 0}>
                        <div style="margin-top:14px">
                          <button class="btn btn--outlined btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                            <Icon name="close" size={14} class="" /> {t("filters.reset")}
                          </button>
                        </div>
                      </Show>
                    </div>
                  }
                >
                  <table class="table table--cards table--users-pending table--desktop" aria-label={t("users.pending.title")}>
                    <thead>
                      <tr>
                        <th class="col-user" aria-sort="none">{t("users.column.fullName")}</th>
                        <th class="col-email" aria-sort="none">{t("users.column.email")}</th>
                        <th class="col-created" aria-sort="none">{t("users.pending.createdAt")}</th>
                        <th class="col-actions" aria-label={t("users.column.actions")}></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.pending}>
                        {(user) => (
                          <tr>
                            <td class="col-user" data-label={t("users.column.fullName")}>
                              <div class="cell-name">
                                <span class="cell-avatar">
                                  {this.vm.userFullName(user).slice(0, 1).toUpperCase()}
                                </span>
                                <span class="cell-name__text">
                                  <span class="strong" title={this.vm.userFullName(user)}>
                                    {this.vm.userFullName(user)}
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td class="col-email" data-label={t("users.column.email")}>
                              <span class="small" title={this.vm.userEmail(user)}>
                                {this.vm.userEmail(user)}
                              </span>
                            </td>
                            <td class="col-created" data-label={t("users.pending.createdAt")}>{this.vm.requestDateLabel(user)}</td>
                            <td class="cell-actions col-actions">
                              <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openApprove(user)}>
                                <Icon name="check" size={14} class="" /> {t("users.pending.approve")}
                              </button>
                              <button class="btn btn--sm btn--danger" type="button" onClick={() => { void this.vm.reject(user); }}>
                                <Icon name="close" size={14} class="" /> {t("users.pending.reject")}
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>

                  <div class="data-pagination">
                    <span class="small muted" aria-live="polite">{this.vm.pendingPageSummary}</span>
                    <div class="row" style="gap:8px;align-items:center">
                      <span class="small muted">{t("users.pagination.size")}</span>
                      <Select
                        value={String(this.vm.pageSize)}
                        options={this.vm.pageSizeOptions}
                        onChange={(value) => this.vm.setPageSize(value)}
                        ariaLabel={t("users.pagination.size")}
                      />
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("users.pagination.prev")}
                        disabled={this.vm.pendingCurrentPage <= 1}
                        onClick={() => this.vm.goToPendingPage(this.vm.pendingCurrentPage - 1)}
                      >
                        <Icon name="chevron" size={14} class="" />
                      </button>
                      <span class="small" aria-label={t("users.pagination.page", { page: this.vm.pendingCurrentPage, pages: this.vm.pendingPageCount })}>
                        {this.vm.pendingCurrentPage} / {this.vm.pendingPageCount}
                      </span>
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("users.pagination.next")}
                        disabled={this.vm.pendingCurrentPage >= this.vm.pendingPageCount}
                        onClick={() => this.vm.goToPendingPage(this.vm.pendingCurrentPage + 1)}
                      >
                        <Icon name="chevron" size={14} class="" />
                      </button>
                    </div>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </section>
      </Show>

      <Modal
        open={this.vm.modalOpen}
        title={this.vm.title}
        onClose={() => { void this.vm.closeModal(); }}
        describedBy={this.vm.formError ? "users-form-error" : undefined}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => { void this.vm.closeModal(); }} disabled={this.vm.saving}>
              {t("common.cancelShort")}
            </button>
            <button class="btn btn--primary" type="submit" form="users-form" disabled={this.vm.saving}>
              <Show when={this.vm.saving} fallback={<span>{t("users.form.save")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("users.form.saving")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <form
          id="users-form"
          class="stack"
          noValidate
          onSubmit={(event: Event) => {
            event.preventDefault();
            void this.vm.submit();
          }}
        >
            <div class="grid grid--2">
              <div class="field">
                <label for="users-form-email">{t("users.form.email")}</label>
                <input
                  id="users-form-email"
                  class="input"
                  type="email"
                  autocomplete="email"
                  required
                  data-autofocus
                  aria-invalid={email.error ? "true" : undefined}
                  aria-describedby={email.error ? "users-form-email-error" : undefined}
                  placeholder={t("auth.register.emailPlaceholder")}
                  value={email.value}
                  onInput={email.onInput}
                />
                <Show when={email.error}>
                  <span class="field-error" id="users-form-email-error" role="alert">{email.error}</span>
                </Show>
              </div>
              <div class="field">
                <label for="users-form-full-name">{t("users.form.fullName")}</label>
                <input
                  id="users-form-full-name"
                  class="input"
                  type="text"
                  autocomplete="name"
                  maxlength={200}
                  aria-invalid={fullName.error ? "true" : undefined}
                  aria-describedby={fullName.error ? "users-form-full-name-error" : "users-form-full-name-hint"}
                  placeholder={t("users.form.fullNamePlaceholder")}
                  value={fullName.value}
                  onInput={fullName.onInput}
                />
                <Show
                  when={fullName.error}
                  fallback={<span class="hint" id="users-form-full-name-hint">{t("users.form.fullNameHint")}</span>}
                >
                  <span class="field-error" id="users-form-full-name-error" role="alert">{fullName.error}</span>
                </Show>
              </div>
              <div class="field">
                <label for="users-form-role">{t("users.form.role")}</label>
              <Select
                id="users-form-role"
                value={form.role}
                options={[
                  { value: "user", label: t("users.role.user") },
                  { value: "admin", label: t("users.role.admin") },
                ]}
                onChange={(value) => this.vm.setRole(value)}
                ariaLabel={t("users.form.role")}
                disabled={this.vm.roleLocked}
              />
              <Show when={this.vm.roleLocked}>
                <span class="hint">{t("users.selfRole")}</span>
              </Show>
            </div>
          </div>

          <Show when={!this.vm.editingId}>
            <div class="field">
              <label for="users-form-password">{t("users.form.password")}</label>
              <input
                id="users-form-password"
                class="input"
                type="password"
                autocomplete="new-password"
                minlength={MIN_PASSWORD_LENGTH}
                maxlength={MAX_PASSWORD_LENGTH}
                aria-invalid={password.error ? "true" : undefined}
                aria-describedby={password.error ? "users-form-password-error" : "users-form-password-hint"}
                value={password.value}
                onInput={password.onInput}
              />
              <Show
                when={password.error}
                fallback={<span class="hint" id="users-form-password-hint">{t("users.form.passwordHint")}</span>}
              >
                <span class="field-error" id="users-form-password-error" role="alert">{password.error}</span>
              </Show>
            </div>
          </Show>

          <div class="grid grid--2">
            <div class="field">
              <label for="users-form-tariff">{t("users.form.tariff")}</label>
              <Select
                id="users-form-tariff"
                value={tariff.value}
                options={[{ value: "", label: t("users.form.tariffNone") }, ...this.vm.tariffs.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(value) => tariff.setValue(value)}
                ariaLabel={t("users.form.tariff")}
                searchable
              />
            </div>
            <div class="field">
              <label for="users-form-node">{t("users.form.node")}</label>
              <Select
                id="users-form-node"
                value={node.value}
                options={[{ value: "", label: t("users.form.nodeOptional") }, ...this.vm.nodes.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(value) => node.setValue(value)}
                ariaLabel={t("users.form.node")}
                searchable
              />
            </div>
          </div>

          <Show when={!!this.vm.editingId}>
            <label class="checkbox">
              <input
                type="checkbox"
                checked={disabled.value}
                disabled={this.vm.editingId === this.vm.selfId}
                onChange={disabled.onChange}
              />
              {t("users.form.disabled")}
              <Show when={this.vm.editingId === this.vm.selfId}>
                <span class="hint">{t("users.selfDisable")}</span>
              </Show>
            </label>
          </Show>

          <Show when={this.vm.formError}>
            <div class="alert alert--error" id="users-form-error" role="alert">{this.vm.formError}</div>
          </Show>

          <button type="submit" class="sr-only">{t("users.form.save")}</button>
        </form>
      </Modal>

      <Modal
        open={this.vm.resetOpen}
        title={t("users.reset.title")}
        onClose={() => this.vm.closeReset()}
        describedBy={newPassword.error ? "users-reset-error" : undefined}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeReset()} disabled={this.vm.resetSaving}>
              {t("common.cancelShort")}
            </button>
            <button class="btn btn--primary" type="submit" form="users-reset-form" disabled={this.vm.resetSaving}>
              <Show when={this.vm.resetSaving} fallback={<span>{t("users.reset.submit")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("users.reset.saving")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <form
          id="users-reset-form"
          class="stack"
          noValidate
          onSubmit={(event: Event) => {
            event.preventDefault();
            void this.vm.submitReset();
          }}
        >
          <div class="field">
            <label for="users-reset-email">{t("users.reset.email")}</label>
            <input
              id="users-reset-email"
              class="input"
              type="email"
              autocomplete="username"
              value={this.vm.resetTargetEmail()}
              disabled
            />
          </div>
          <div class="field">
            <label for="users-reset-password">{t("users.reset.password")}</label>
            <input
              id="users-reset-password"
              class="input"
              type="password"
              autocomplete="new-password"
              minlength={MIN_PASSWORD_LENGTH}
              maxlength={MAX_PASSWORD_LENGTH}
              required
              data-autofocus
              aria-invalid={newPassword.error ? "true" : undefined}
              aria-describedby={newPassword.error ? "users-reset-error" : "users-reset-hint"}
              value={newPassword.value}
              onInput={newPassword.onInput}
            />
            <Show
              when={newPassword.error}
              fallback={<span class="hint" id="users-reset-hint">{t("users.form.passwordHint")}</span>}
            >
              <span class="field-error" id="users-reset-error" role="alert">{newPassword.error}</span>
            </Show>
          </div>
          <button type="submit" class="sr-only">{t("users.reset.submit")}</button>
        </form>
      </Modal>

      <Modal
        open={this.vm.approveOpen}
        title={t("users.pending.approveTitle")}
        onClose={() => this.vm.closeApprove()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeApprove()} disabled={this.vm.approveSaving}>
              {t("common.cancelShort")}
            </button>
            <button class="btn btn--primary" type="button" onClick={() => { void this.vm.submitApprove(); }} disabled={this.vm.approveSaving}>
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
            <label for="users-approve-email">{t("users.column.email")}</label>
            <input id="users-approve-email" class="input" type="email" value={this.vm.approveTargetEmail()} disabled />
          </div>
          <div class="field">
            <label for="users-approve-full-name">{t("users.column.fullName")}</label>
            <input
              id="users-approve-full-name"
              class="input"
              type="text"
              value={this.vm.approveTarget === null ? "" : this.vm.userFullName(this.vm.approveTarget)}
              disabled
            />
          </div>
          <div class="grid grid--2">
            <div class="field">
              <label for="users-approve-tariff">{t("users.pending.tariff")}</label>
              <Select
                id="users-approve-tariff"
                value={this.vm.approveTariffId}
                options={[
                  { value: "", label: "—" },
                  ...this.vm.tariffs.map((tariff) => ({ value: tariff.id, label: tariff.name })),
                ]}
                onChange={(value) => this.vm.setApproveTariff(value)}
                ariaLabel={t("users.pending.tariff")}
                searchable
              />
            </div>
            <div class="field">
              <label for="users-approve-node">{t("users.pending.node")}</label>
              <Select
                id="users-approve-node"
                value={this.vm.approveNodeId}
                options={[
                  { value: "", label: t("users.form.nodeOptional") },
                  ...this.vm.nodes.map((node) => ({ value: node.id, label: node.name })),
                ]}
                onChange={(value) => this.vm.setApproveNode(value)}
                ariaLabel={t("users.pending.node")}
                searchable
              />
            </div>
          </div>
          <Show when={this.vm.approveError}>
            <div class="alert alert--error" role="alert">{this.vm.approveError}</div>
          </Show>
        </div>
      </Modal>
    </div>
  );
}
