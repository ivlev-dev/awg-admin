import { For, Show } from "@ivlev-dev/silent-core";

import type { UsersPageVM } from "./UsersPage.vm";
import { BulkBar } from "@/components/BulkBar";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

export function UsersPage(this: { vm: UsersPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Доступ</div>
        <div class="row-between wrap">
          <div>
            <h1>Пользователи</h1>
            <p>Учётки панели, роли, тарифы и привязка к группам интерфейсов.</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
              <Icon name="plus" size={16} class="" /> Новый пользователь
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card">
        <div class="card__body">
          <div class="row" style="gap:8px;align-items:flex-end">
            <div class="field" style="flex:1">
              <label for="users-search">{t("filters.search")}</label>
              <input
                id="users-search"
                class="input"
                type="search"
                placeholder={t("filters.search.users")}
                value={this.vm.query}
                onInput={(event: Event) => this.vm.setQuery(event)}
              />
            </div>
            <div class="field field--compact" style="flex:0 1 170px">
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
            <div class="field field--compact" style="flex:0 1 170px">
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
              <button class="btn btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                <Icon name="close" size={14} class="" /> {t("filters.reset")}
              </button>
            </Show>
          </div>
        </div>
      </section>

      <div class="tabs tabs--fill">
        <button
          class={`tab ${this.vm.tab === "active" ? "is-active" : ""}`}
          type="button"
          onClick={() => this.vm.setTab("active")}
        >
          {t("users.tab.active")} ({this.vm.activeUsers.length})
        </button>
        <button
          class={`tab ${this.vm.tab === "pending" ? "is-active" : ""}`}
          type="button"
          onClick={() => this.vm.setTab("pending")}
        >
          {t("users.tab.pending")} ({this.vm.pendingCount})
        </button>
      </div>

      <Show when={this.vm.tab === "active"}>
        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Учётные записи</div>
              <div class="card__sub">{this.vm.activeCountLabel}</div>
            </div>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
          </div>
          <div class="card__body" aria-busy={this.vm.loading ? "true" : "false"}>
            <Show when={!this.vm.loading} fallback={<SkeletonTable rows={5} columns={8} />}>
              <Show
                when={this.vm.filteredActiveUsers.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">
                      {this.vm.activeUsers.length === 0 ? "Нет пользователей" : t("filters.emptyTitle")}
                    </div>
                    <div class="small">
                      {this.vm.activeUsers.length === 0
                        ? "Создайте первую учётную запись."
                        : t("filters.emptyText")}
                    </div>
                    <Show when={this.vm.activeUsers.length > 0}>
                      <div style="margin-top:14px">
                        <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                          <Icon name="close" size={14} class="" /> {t("filters.reset")}
                        </button>
                      </div>
                    </Show>
                  </div>
                }
              >
                <div class="table-wrap table-wrap--cards">
                  <table class="table table--cards table--users">
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
                        <th>Логин</th>
                        <th>{t("users.column.email")}</th>
                        <th>Роль</th>
                        <th>Тариф</th>
                        <th>Группа</th>
                        <th>Квота</th>
                        <th>{t("users.column.status")}</th>
                        <th></th>
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
                              <div class="row" style="gap:10px">
                                <div class="avatar avatar--sm">{user.login.slice(0, 1).toUpperCase()}</div>
                                <span class="strong">{user.login}</span>
                              </div>
                            </td>
                            <td data-label={t("users.column.email")}>{this.vm.emailLabel(user)}</td>
                            <td data-label="Роль">
                              <span class={`badge ${user.role === "admin" ? "badge--violet" : "badge--blue"}`}>
                                {user.role === "admin" ? "Администратор" : "Пользователь"}
                              </span>
                            </td>
                            <td data-label="Тариф">{this.vm.tariffName(user.tariff_id)}</td>
                            <td data-label="Группа">{this.vm.groupName(user.group_id)}</td>
                            <td data-label="Квота">
                              <Show
                                when={this.vm.quotaFor(user.id)}
                                fallback={<span class="xs muted">—</span>}
                              >
                                <div class="stack-sm user-quota" title={this.vm.quotaTitle(user.id)}>
                                  <span class="small mono strong">{this.vm.quotaPercentLabel(user.id)}</span>
                                  <span class={this.vm.quotaBadgeClass(user.id)}>
                                    {this.vm.quotaStatusLabel(user.id)}
                                  </span>
                                </div>
                              </Show>
                            </td>
                            <td data-label={t("users.column.status")}>
                              <span class={this.vm.statusBadgeClass(user)}>
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
                </div>
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
        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">{t("users.pending.title")}</div>
              <div class="card__sub">{this.vm.pendingCountLabel}</div>
            </div>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
          </div>
          <div class="card__body" aria-busy={this.vm.pendingLoading ? "true" : "false"}>
            <Show when={!this.vm.pendingLoading} fallback={<SkeletonTable rows={3} columns={4} />}>
              <Show when={this.vm.pendingError}>
                <div class="alert alert--error">{this.vm.pendingError}</div>
              </Show>
              <Show
                when={this.vm.filteredPending.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">
                      {this.vm.pending.length === 0
                        ? t("users.pending.emptyTitle")
                        : t("filters.emptyTitle")}
                    </div>
                    <div class="small">
                      {this.vm.pending.length === 0
                        ? t("users.pending.emptyText")
                        : t("filters.emptyText")}
                    </div>
                    <Show when={this.vm.pending.length > 0}>
                      <div style="margin-top:14px">
                        <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                          <Icon name="close" size={14} class="" /> {t("filters.reset")}
                        </button>
                      </div>
                    </Show>
                  </div>
                }
              >
                <div class="table-wrap table-wrap--cards">
                  <table class="table table--cards table--users-pending">
                    <thead>
                      <tr>
                        <th>{t("users.column.email")}</th>
                        <th>Логин</th>
                        <th>{t("users.pending.createdAt")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.filteredPending}>
                        {(user) => (
                          <tr>
                            <td data-label={t("users.column.email")}>
                              <span class="strong">{this.vm.emailLabel(user)}</span>
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
                </div>
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
