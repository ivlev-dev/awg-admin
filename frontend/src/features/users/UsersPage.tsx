import { For, Show } from "@ivlev-dev/silent-core";

import type { UsersPageVM } from "./UsersPage.vm";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";

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
        <div class="card__head">
          <div>
            <div class="card__title">Учётные записи</div>
            <div class="card__sub">Всего: {this.vm.users.length}</div>
          </div>
          <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
            <Icon name="refresh" size={14} class="" /> Обновить
          </button>
        </div>
        <div class="card__body">
          <Show when={!this.vm.loading} fallback={<div class="skeleton" style="height:140px"></div>}>
            <Show
              when={this.vm.users.length > 0}
              fallback={<div class="empty"><div class="empty__title">Нет пользователей</div><div class="small">Создайте первую учётную запись.</div></div>}
            >
              <div class="table-wrap">
                <table class="table table--cards">
                  <thead>
                    <tr>
                      <th>Логин</th>
                      <th>Роль</th>
                      <th>Тариф</th>
                      <th>Группа</th>
                      <th>Квота</th>
                      <th>Статус</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.users}>
                      {(user) => (
                        <tr>
                          <td data-label="Логин">
                            <div class="row" style="gap:10px">
                              <div class="avatar avatar--sm">{user.login.slice(0, 1).toUpperCase()}</div>
                              <span class="strong">{user.login}</span>
                            </div>
                          </td>
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
                              <div class="stack-sm" title={this.vm.quotaTitle(user.id)}>
                                <span class="small mono strong">{this.vm.quotaPercentLabel(user.id)}</span>
                                <span class={this.vm.quotaBadgeClass(user.id)}>
                                  {this.vm.quotaStatusLabel(user.id)}
                                </span>
                              </div>
                            </Show>
                          </td>
                          <td data-label="Статус">
                            <span class={`badge ${user.disabled ? "badge--red" : "badge--green"}`}>
                              {user.disabled ? "Отключён" : "Активен"}
                            </span>
                          </td>
                          <td>
                            <div class="row" style="gap:4px;justify-content:flex-end">
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
                            </div>
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
    </div>
  );
}
