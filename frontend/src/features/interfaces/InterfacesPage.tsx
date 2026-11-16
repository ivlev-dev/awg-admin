import { For, Show } from "@ivlev-dev/silent-core";

import type { InterfacesPageVM } from "./InterfacesPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";

export function InterfacesPage(this: { vm: InterfacesPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Инфраструктура</div>
        <div class="row-between wrap">
          <div>
            <h1>Интерфейсы</h1>
            <p>AmneziaWG-интерфейсы на нодах: адреса, порты, обфускация и пиры.</p>
          </div>
          <div class="actions-bar">
            <span class="badge badge--blue">
              {this.vm.visible.length} из {this.vm.interfaces.length}
            </span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()} disabled={this.vm.loading}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
            <Show when={this.vm.isAdmin}>
              <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                <Icon name="plus" size={14} class="" /> Добавить интерфейс
              </button>
            </Show>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card">
        <div class="card__body grid grid--3">
          <div class="field">
            <label for="iface-search">Поиск</label>
            <input
              id="iface-search"
              class="input"
              type="search"
              placeholder="Название или метка"
              value={this.vm.search}
              onInput={(event: Event) => this.vm.setSearch(event)}
            />
          </div>
          <Show when={this.vm.isAdmin}>
            <div class="field">
              <label for="iface-group">Группа</label>
              <Select
                id="iface-group"
                value={this.vm.groupFilter}
                options={[{ value: "", label: "Все группы" }, ...this.vm.groups.map((group) => ({ value: group.id, label: group.name }))]}
                onChange={(value) => this.vm.setGroupFilter(value)}
                ariaLabel="Группа"
              />
            </div>
            <div class="field">
              <label for="iface-node">Нода</label>
              <Select
                id="iface-node"
                value={this.vm.nodeFilter}
                options={[{ value: "", label: "Все ноды" }, ...this.vm.nodes.map((node) => ({ value: node.id, label: node.name }))]}
                onChange={(value) => this.vm.setNodeFilter(value)}
                ariaLabel="Нода"
              />
            </div>
          </Show>
        </div>
        <Show when={this.vm.filtersActive}>
          <div class="card__foot row-between wrap">
            <span class="xs muted">Найдено: {this.vm.visible.length}</span>
            <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.resetFilters()}>
              Сбросить фильтры
            </button>
          </div>
        </Show>
      </section>

      <Show when={this.vm.loading}>
        <div class="grid grid--2">
          <div class="skeleton" style="height:300px"></div>
          <div class="skeleton" style="height:300px"></div>
        </div>
      </Show>

      <Show when={!this.vm.loading}>
        <Show
          when={this.vm.visible.length > 0}
          fallback={
            <section class="card">
              <div class="empty">
                <Icon name="interfaces" size={40} class="empty__icon" />
                <div class="empty__title">
                  {this.vm.hasInterfaces ? "Ничего не найдено" : "Интерфейсов пока нет"}
                </div>
                <div class="small">
                  {this.vm.hasInterfaces
                    ? "Измените запрос или сбросьте фильтры."
                    : this.vm.isAdmin
                      ? "Создайте интерфейс на ноде, чтобы подключать к нему клиентов."
                      : "Для вашей группы интерфейсы ещё не настроены. Обратитесь к администратору."}
                </div>
              </div>
              <Show when={this.vm.filtersActive || this.vm.isAdmin}>
                <div class="card__foot actions-bar" style="justify-content:flex-end">
                  <Show when={this.vm.filtersActive}>
                    <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.resetFilters()}>
                      Сбросить фильтры
                    </button>
                  </Show>
                  <Show when={this.vm.isAdmin}>
                    <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                      <Icon name="plus" size={14} class="" /> Создать интерфейс
                    </button>
                  </Show>
                </div>
              </Show>
            </section>
          }
        >
          <div class="grid grid--2">
            <For each={this.vm.visible}>
              {(item) => (
                <article class="card">
                  <div class="card__head">
                    <div class="grow">
                      <div class="card__title">{item.name}</div>
                      <div class="card__sub">{item.label || "Без метки"}</div>
                    </div>
                    <span class={`badge ${item.enabled ? "badge--green" : "badge--amber"}`}>
                      <span class={`dot ${item.enabled ? "dot--green" : "dot--red"}`}></span>
                      {item.enabled ? "включён" : "отключён"}
                    </span>
                  </div>

                  <div class="card__body stack-sm">
                    <div class="row wrap" style="gap:6px">
                      <span class="badge badge--blue">
                        <Icon name="groups" size={12} class="" />{item.group_name}
                      </span>
                      <span class="badge badge--violet">
                        <Icon name="nodes" size={12} class="" />{item.node_name}
                      </span>
                      <span class="badge badge--amber">
                        <Icon name="clients" size={12} class="" />{this.vm.peersLabel(item)}
                      </span>
                    </div>

                    <dl class="kv">
                      <dt>Endpoint</dt>
                      <dd>
                        <span class="row" style="justify-content:flex-end;gap:6px">
                          <span class="mono small">{this.vm.endpoint(item)}</span>
                          <button
                            class="btn btn--sm btn--ghost btn--icon"
                            type="button"
                            aria-label="Скопировать endpoint"
                            onClick={() => this.vm.copyEndpoint(item)}
                          >
                            <Icon name="copy" size={14} class="" />
                          </button>
                        </span>
                      </dd>
                      <dt>Listen port</dt>
                      <dd class="mono">{item.listen_port}</dd>
                      <dt>MTU</dt>
                      <dd class="mono">{item.mtu}</dd>
                    </dl>

                    <div class="field">
                      <label>Публичный ключ</label>
                      <div class="copy-row">
                        <input class="input" readonly value={item.public_key} />
                        <button
                          class="btn btn--icon"
                          type="button"
                          aria-label="Скопировать публичный ключ"
                          onClick={() => this.vm.copyPublicKey(item)}
                        >
                          <Icon name="copy" size={16} class="" />
                        </button>
                      </div>
                    </div>

                    <div class="stack-sm">
                      <div class="row-between">
                        <span class="xs muted">Обфускация</span>
                        <Show when={item.obf.random_trailers}>
                          <span class="badge badge--violet">RandomTrailers</span>
                        </Show>
                      </div>
                      <div class="xs mono truncate" title={this.vm.obfHeaders(item)}>{this.vm.obfHeaders(item)}</div>
                      <div class="xs mono">{this.vm.obfSigned(item)}</div>
                    </div>
                  </div>

                  <Show when={this.vm.isAdmin}>
                    <div class="card__foot actions-bar" style="justify-content:flex-end">
                      <button
                        class="btn btn--sm"
                        type="button"
                        disabled={this.vm.busy}
                        onClick={() => this.vm.openEdit(item)}
                      >
                        <Icon name="edit" size={14} class="" /> Изменить
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        disabled={this.vm.busy}
                        onClick={() => this.vm.rotate(item)}
                      >
                        <Icon name="refresh" size={14} class="" /> Перевыпустить
                      </button>
                      <button
                        class="btn btn--sm btn--danger"
                        type="button"
                        disabled={this.vm.busy}
                        onClick={() => this.vm.remove(item)}
                      >
                        <Icon name="trash" size={14} class="" /> Удалить
                      </button>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Modal
        open={this.vm.createOpen}
        title="Новый интерфейс"
        wide={true}
        onClose={() => this.vm.closeCreate()}
        footer={
          <>
            <button class="btn" type="button" onClick={() => this.vm.closeCreate()}>Отмена</button>
            <button
              class="btn btn--primary"
              type="submit"
              form="interface-create"
              disabled={!this.vm.canCreate}
            >
              {this.vm.busy ? "Создаём…" : "Создать"}
            </button>
          </>
        }
      >
        <form id="interface-create" class="stack" onSubmit={(event: Event) => this.vm.submitCreate(event)}>
          <Show when={this.vm.groups.length === 0 || this.vm.nodes.length === 0}>
            <div class="alert alert--warn">
              Сначала создайте хотя бы одну группу и ноду — интерфейсу нужны обе привязки.
            </div>
          </Show>
          <div class="grid grid--2">
            <div class="field">
              <label for="iface-form-group">Группа</label>
              <Select
                id="iface-form-group"
                value={this.vm.formGroupId}
                options={this.vm.groups.map((group) => ({ value: group.id, label: group.name }))}
                onChange={(value) => this.vm.setFormGroup(value)}
                ariaLabel="Группа"
              />
            </div>
            <div class="field">
              <label for="iface-form-node">Нода</label>
              <Select
                id="iface-form-node"
                value={this.vm.formNodeId}
                options={this.vm.nodes.map((node) => ({ value: node.id, label: node.name }))}
                onChange={(value) => this.vm.setFormNode(value)}
                ariaLabel="Нода"
              />
            </div>
            <div class="field">
              <label for="iface-form-name">Имя интерфейса</label>
              <input
                id="iface-form-name"
                class="input"
                type="text"
                placeholder="awg0"
                value={this.vm.formName}
                onInput={(event: Event) => this.vm.setFormName(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-label">Метка</label>
              <input
                id="iface-form-label"
                class="input"
                type="text"
                placeholder="Основной"
                value={this.vm.formLabel}
                onInput={(event: Event) => this.vm.setFormLabel(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-host">Endpoint host</label>
              <input
                id="iface-form-host"
                class="input"
                type="text"
                placeholder="vpn.example.com"
                value={this.vm.formEndpointHost}
                onInput={(event: Event) => this.vm.setFormEndpointHost(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-endpoint-port">Endpoint port</label>
              <input
                id="iface-form-endpoint-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={this.vm.formEndpointPort}
                onInput={(event: Event) => this.vm.setFormEndpointPort(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-listen-port">Listen port</label>
              <input
                id="iface-form-listen-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={this.vm.formListenPort}
                onInput={(event: Event) => this.vm.setFormListenPort(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-mtu">MTU</label>
              <input
                id="iface-form-mtu"
                class="input"
                type="number"
                min="576"
                max="9000"
                value={this.vm.formMtu}
                onInput={(event: Event) => this.vm.setFormMtu(event)}
              />
            </div>
          </div>
          <Show when={this.vm.formError}>
            <div class="alert alert--error">{this.vm.formError}</div>
          </Show>
        </form>
      </Modal>

      <Modal
        open={this.vm.editing !== null}
        title={this.vm.editing ? `Интерфейс «${this.vm.editing.name}»` : "Интерфейс"}
        wide={true}
        onClose={() => this.vm.closeEdit()}
        footer={
          <>
            <button class="btn" type="button" onClick={() => this.vm.closeEdit()}>Отмена</button>
            <button
              class="btn btn--primary"
              type="submit"
              form="interface-edit"
              disabled={!this.vm.canSaveEdit}
            >
              {this.vm.busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </>
        }
      >
        <form id="interface-edit" class="stack" onSubmit={(event: Event) => this.vm.submitEdit(event)}>
          <div class="grid grid--2">
            <div class="field">
              <label for="iface-edit-label">Метка</label>
              <input
                id="iface-edit-label"
                class="input"
                type="text"
                value={this.vm.editLabel}
                onInput={(event: Event) => this.vm.setEditLabel(event)}
              />
            </div>
            <div class="field">
              <label for="iface-edit-host">Endpoint host</label>
              <input
                id="iface-edit-host"
                class="input"
                type="text"
                value={this.vm.editHost}
                onInput={(event: Event) => this.vm.setEditHost(event)}
              />
            </div>
            <div class="field">
              <label for="iface-edit-endpoint-port">Endpoint port</label>
              <input
                id="iface-edit-endpoint-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={this.vm.editEndpointPort}
                onInput={(event: Event) => this.vm.setEditEndpointPort(event)}
              />
            </div>
            <div class="field">
              <label for="iface-edit-listen-port">Listen port</label>
              <input
                id="iface-edit-listen-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={this.vm.editListenPort}
                onInput={(event: Event) => this.vm.setEditListenPort(event)}
              />
            </div>
            <div class="field">
              <label for="iface-edit-mtu">MTU</label>
              <input
                id="iface-edit-mtu"
                class="input"
                type="number"
                min="576"
                max="9000"
                value={this.vm.editMtu}
                onInput={(event: Event) => this.vm.setEditMtu(event)}
              />
            </div>
            <div class="field">
              <label>Состояние</label>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={this.vm.editEnabled}
                  onChange={(event: Event) => this.vm.setEditEnabled(event)}
                />
                <span class="track"></span>
                <span>{this.vm.editEnabled ? "Включён" : "Отключён"}</span>
              </label>
            </div>
          </div>
          <Show when={this.vm.editError}>
            <div class="alert alert--error">{this.vm.editError}</div>
          </Show>
        </form>
      </Modal>

      <Modal
        open={this.vm.rotated !== null}
        title="Ключи перевыпущены"
        onClose={() => this.vm.closeRotated()}
        footer={<button class="btn btn--primary" type="button" onClick={() => this.vm.closeRotated()}>Готово</button>}
      >
        <div class="stack-sm">
          <div class="alert alert--warn">
            Все клиентские конфиги этого интерфейса нужно перевыпустить: старый публичный ключ больше не действует.
          </div>
          <div class="field">
            <label for="iface-rotated-key">Новый публичный ключ</label>
            <div class="copy-row">
              <input id="iface-rotated-key" class="input" readonly value={this.vm.rotated?.public_key ?? ""} />
              <button class="btn" type="button" onClick={() => this.vm.copyRotatedPublicKey()}>
                <Icon name={this.vm.rotatedCopied ? "check" : "copy"} size={16} class="" />
                {this.vm.rotatedCopied ? "Скопировано" : "Копировать"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
