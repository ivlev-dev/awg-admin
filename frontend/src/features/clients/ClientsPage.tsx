import { For, Show } from "@ivlev-dev/silent-core";

import type { ClientsPageVM } from "./ClientsPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { formatRate } from "@/domain/format";

export function ClientsPage(this: { vm: ClientsPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Клиенты</div>
        <div class="row-between wrap">
          <div>
            <h1>Клиенты</h1>
            <p>Устройства AmneziaWG, их адреса, лимиты и доступ к пирам.</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
            <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
              <Icon name="plus" size={16} class="" /> Новый клиент
            </button>
          </div>
        </div>
      </div>

      <section class="card">
        <div class="card__body">
          <div class="grid grid--2">
            <div class="field">
              <label for="clients-search">Поиск</label>
              <input
                id="clients-search"
                class="input"
                type="search"
                placeholder="Имя устройства или IP-адрес"
                value={this.vm.query}
                onInput={(event: Event) => this.vm.setQuery(event)}
              />
            </div>
            <Show when={this.vm.isAdmin}>
              <div class="field">
                <label for="clients-group">Группа</label>
                <Select
                  id="clients-group"
                  value={this.vm.groupFilter}
                  options={[{ value: "", label: "Все группы" }, ...this.vm.groups.map((group) => ({ value: group.id, label: group.name }))]}
                  onChange={(value) => this.vm.setGroupFilter(value)}
                  ariaLabel="Группа"
                />
              </div>
            </Show>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">Устройства</div>
            <div class="card__sub">Показано {this.vm.countLabel}</div>
          </div>
          <span class="badge badge--blue">
            <Icon name="clients" size={12} class="" /> клиенты
          </span>
        </div>
        <div class="card__body">
          <Show
            when={!this.vm.loading}
            fallback={<div class="skeleton" style="height:160px"></div>}
          >
            <Show
              when={this.vm.filteredDevices.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__title">
                    {this.vm.devices.length === 0 ? "Пока нет клиентов" : "Ничего не найдено"}
                  </div>
                  <div class="small">
                    {this.vm.devices.length === 0
                      ? "Создайте первое устройство, чтобы подключить его к интерфейсу."
                      : "Измените поисковый запрос или фильтр по группе."}
                  </div>
                  <div style="margin-top:14px">
                    <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.openCreate()}>
                      <Icon name="plus" size={14} class="" /> Создать устройство
                    </button>
                  </div>
                </div>
              }
            >
              <div class="table-wrap">
                <table class="table table--cards">
                  <thead>
                    <tr>
                      <th>Устройство</th>
                      <Show when={this.vm.isAdmin}>
                        <th>Владелец</th>
                      </Show>
                      <th>Адреса</th>
                      <th>Лимиты</th>
                      <th>Интерфейсы и пиры</th>
                      <th>Статус</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.filteredDevices}>
                      {(device) => (
                        <tr>
                          <td data-label="Устройство">
                            <span class="strong">{device.name}</span>
                          </td>
                          <Show when={this.vm.isAdmin}>
                            <td data-label="Владелец">
                              <div class="small strong">{this.vm.userLogin(device.user_id)}</div>
                              <div class="xs muted">{this.vm.groupName(device.group_id)}</div>
                            </td>
                          </Show>
                          <td data-label="Адреса">
                            <Show
                              when={device.addresses.length > 0}
                              fallback={<span class="muted">—</span>}
                            >
                              <span class="mono xs">{device.addresses.join(", ")}</span>
                            </Show>
                          </td>
                          <td data-label="Лимиты">
                            <div class="xs"><span class="muted">↓</span> {formatRate(device.down_kbps)}</div>
                            <div class="xs"><span class="muted">↑</span> {formatRate(device.up_kbps)}</div>
                          </td>
                          <td data-label="Интерфейсы и пиры">
                            <Show
                              when={device.peers.length > 0}
                              fallback={<span class="muted">—</span>}
                            >
                              <div class="small strong">{this.vm.peersLabel(device)}</div>
                              <div class="xs muted">{this.vm.interfaceNames(device)}</div>
                            </Show>
                          </td>
                          <td data-label="Статус">
                            <span class={`badge ${device.revoked ? "badge--red" : "badge--green"}`}>
                              <span class={`dot ${device.revoked ? "dot--red" : "dot--green"}`}></span>
                              {device.revoked ? "Отозвано" : "Активно"}
                            </span>
                          </td>
                          <td>
                            <div class="row" style="gap:6px;justify-content:flex-end">
                              <button
                                class="btn btn--sm btn--ghost"
                                type="button"
                                onClick={() => this.vm.openDevice(device.id)}
                              >
                                Открыть <Icon name="chevron" size={14} class="" />
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
        open={this.vm.createOpen}
        title="Новый клиент"
        onClose={() => this.vm.closeCreate()}
        footer={
          <div class="row" style="gap:8px">
            <button
              class="btn"
              type="button"
              disabled={this.vm.submitting}
              onClick={() => this.vm.closeCreate()}
            >
              Отмена
            </button>
            <button
              class="btn btn--primary"
              type="button"
              disabled={!this.vm.canCreate}
              onClick={() => this.vm.create()}
            >
              <Show
                when={this.vm.submitting}
                fallback={<span>Создать</span>}
              >
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>Создаём…</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <div class="field">
            <label for="client-name">Имя устройства</label>
            <input
              id="client-name"
              class="input"
              type="text"
              placeholder="Например, iPhone"
              value={this.vm.formName}
              onInput={(event: Event) => this.vm.setFormName(event)}
            />
          </div>

          <Show when={this.vm.isAdmin}>
            <div class="grid grid--2">
              <div class="field">
                <label for="client-user">Пользователь</label>
                <Select
                  id="client-user"
                  value={this.vm.formUserId}
                  options={[{ value: "", label: "Выберите пользователя" }, ...this.vm.users.map((user) => ({ value: user.id, label: user.login }))]}
                  onChange={(value) => this.vm.setFormUser(value)}
                  ariaLabel="Пользователь"
                />
              </div>
              <div class="field">
                <label for="client-group">Группа</label>
                <Select
                  id="client-group"
                  value={this.vm.formGroupId}
                  options={[{ value: "", label: "Без группы" }, ...this.vm.groups.map((group) => ({ value: group.id, label: group.name }))]}
                  onChange={(value) => this.vm.setFormGroup(value)}
                  ariaLabel="Группа"
                />
              </div>
            </div>
          </Show>

          <Show when={!this.vm.isAdmin}>
            <div class="alert alert--info">
              Устройство будет создано для вашего аккаунта.
            </div>
          </Show>

          <div class="grid grid--2">
            <div class="field">
              <label for="client-down">Скачивание, Кбит/с</label>
              <input
                id="client-down"
                class="input"
                type="number"
                min="0"
                value={this.vm.formDown}
                onInput={(event: Event) => this.vm.setFormDown(event)}
              />
              <div class="hint">0 — без лимита</div>
            </div>
            <div class="field">
              <label for="client-up">Отдача, Кбит/с</label>
              <input
                id="client-up"
                class="input"
                type="number"
                min="0"
                value={this.vm.formUp}
                onInput={(event: Event) => this.vm.setFormUp(event)}
              />
              <div class="hint">0 — без лимита</div>
            </div>
          </div>

          <label class="checkbox">
            <input
              type="checkbox"
              checked={this.vm.formForwarding}
              onChange={(event: Event) => this.vm.setFormForwarding(event)}
            />
            <span>Разрешить трафик между своими устройствами</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
