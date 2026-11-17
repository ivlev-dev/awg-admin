import { For, Show } from "@ivlev-dev/silent-core";

import type { InterfacesPageVM } from "./InterfacesPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { t } from "@/i18n";

export function InterfacesPage(this: { vm: InterfacesPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("interfaces.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("interfaces.title")}</h1>
            <p>{t("interfaces.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <span class="badge badge--blue">
              {t("interfaces.count", { visible: this.vm.visible.length, total: this.vm.interfaces.length })}
            </span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()} disabled={this.vm.loading}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
            <Show when={this.vm.isAdmin}>
              <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                <Icon name="plus" size={14} class="" /> {t("interfaces.add")}
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
            <label for="iface-search">{t("interfaces.search.label")}</label>
            <input
              id="iface-search"
              class="input"
              type="search"
              placeholder={t("interfaces.search.placeholder")}
              value={this.vm.search}
              onInput={(event: Event) => this.vm.setSearch(event)}
            />
          </div>
          <Show when={this.vm.isAdmin}>
            <div class="field">
              <label for="iface-group">{t("interfaces.filter.group")}</label>
              <Select
                id="iface-group"
                value={this.vm.groupFilter}
                options={[{ value: "", label: t("interfaces.filter.allGroups") }, ...this.vm.groups.map((group) => ({ value: group.id, label: group.name }))]}
                onChange={(value) => this.vm.setGroupFilter(value)}
                ariaLabel={t("interfaces.filter.group")}
              />
            </div>
            <div class="field">
              <label for="iface-node">{t("interfaces.filter.node")}</label>
              <Select
                id="iface-node"
                value={this.vm.nodeFilter}
                options={[{ value: "", label: t("interfaces.filter.allNodes") }, ...this.vm.nodes.map((node) => ({ value: node.id, label: node.name }))]}
                onChange={(value) => this.vm.setNodeFilter(value)}
                ariaLabel={t("interfaces.filter.node")}
              />
            </div>
          </Show>
        </div>
        <Show when={this.vm.filtersActive}>
          <div class="card__foot row-between wrap">
            <span class="xs muted">{t("interfaces.found", { count: this.vm.visible.length })}</span>
            <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.resetFilters()}>
              {t("filters.reset")}
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
                  {this.vm.hasInterfaces ? t("interfaces.emptyFiltered.title") : t("interfaces.empty.title")}
                </div>
                <div class="small">
                  {this.vm.hasInterfaces
                    ? t("interfaces.emptyFiltered.text")
                    : this.vm.isAdmin
                      ? t("interfaces.empty.textAdmin")
                      : t("interfaces.empty.textUser")}
                </div>
              </div>
              <Show when={this.vm.filtersActive || this.vm.isAdmin}>
                <div class="card__foot actions-bar" style="justify-content:flex-end">
                  <Show when={this.vm.filtersActive}>
                    <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.resetFilters()}>
                      {t("filters.reset")}
                    </button>
                  </Show>
                  <Show when={this.vm.isAdmin}>
                    <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                      <Icon name="plus" size={14} class="" /> {t("interfaces.create")}
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
                      <div class="card__sub">{item.label || t("interfaces.noLabel")}</div>
                    </div>
                    <span class={`badge ${item.enabled ? "badge--green" : "badge--amber"}`}>
                      <span class={`dot ${item.enabled ? "dot--green" : "dot--red"}`}></span>
                      {item.enabled ? t("interfaces.status.enabled") : t("interfaces.status.disabled")}
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
                            aria-label={t("interfaces.endpoint.copyAria")}
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
                      <label>{t("interfaces.publicKey")}</label>
                      <div class="copy-row">
                        <input class="input" readonly value={item.public_key} />
                        <button
                          class="btn btn--icon"
                          type="button"
                          aria-label={t("interfaces.publicKey.copyAria")}
                          onClick={() => this.vm.copyPublicKey(item)}
                        >
                          <Icon name="copy" size={16} class="" />
                        </button>
                      </div>
                    </div>

                    <div class="stack-sm">
                      <div class="row-between">
                        <span class="xs muted">{t("interfaces.obfuscation")}</span>
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
                        <Icon name="edit" size={14} class="" /> {t("interfaces.action.edit")}
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        disabled={this.vm.busy}
                        onClick={() => this.vm.rotate(item)}
                      >
                        <Icon name="refresh" size={14} class="" /> {t("interfaces.action.rotate")}
                      </button>
                      <button
                        class="btn btn--sm btn--danger"
                        type="button"
                        disabled={this.vm.busy}
                        onClick={() => this.vm.remove(item)}
                      >
                        <Icon name="trash" size={14} class="" /> {t("interfaces.action.delete")}
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
        title={t("interfaces.form.title")}
        wide={true}
        onClose={() => this.vm.closeCreate()}
        footer={
          <>
            <button class="btn" type="button" onClick={() => this.vm.closeCreate()}>{t("common.cancelShort")}</button>
            <button
              class="btn btn--primary"
              type="submit"
              form="interface-create"
              disabled={!this.vm.canCreate}
            >
              {this.vm.busy ? t("interfaces.form.creating") : t("interfaces.form.create")}
            </button>
          </>
        }
      >
        <form id="interface-create" class="stack" onSubmit={(event: Event) => this.vm.submitCreate(event)}>
          <Show when={this.vm.groups.length === 0 || this.vm.nodes.length === 0}>
            <div class="alert alert--warn">
              {t("interfaces.form.warning")}
            </div>
          </Show>
          <div class="grid grid--2">
            <div class="field">
              <label for="iface-form-group">{t("interfaces.form.group")}</label>
              <Select
                id="iface-form-group"
                value={this.vm.formGroupId}
                options={this.vm.groups.map((group) => ({ value: group.id, label: group.name }))}
                onChange={(value) => this.vm.setFormGroup(value)}
                ariaLabel={t("interfaces.form.group")}
              />
            </div>
            <div class="field">
              <label for="iface-form-node">{t("interfaces.form.node")}</label>
              <Select
                id="iface-form-node"
                value={this.vm.formNodeId}
                options={this.vm.nodes.map((node) => ({ value: node.id, label: node.name }))}
                onChange={(value) => this.vm.setFormNode(value)}
                ariaLabel={t("interfaces.form.node")}
              />
            </div>
            <div class="field">
              <label for="iface-form-name">{t("interfaces.form.name")}</label>
              <input
                id="iface-form-name"
                class="input"
                type="text"
                placeholder={t("interfaces.form.namePlaceholder")}
                value={this.vm.formName}
                onInput={(event: Event) => this.vm.setFormName(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-label">{t("interfaces.form.label")}</label>
              <input
                id="iface-form-label"
                class="input"
                type="text"
                placeholder={t("interfaces.form.labelPlaceholder")}
                value={this.vm.formLabel}
                onInput={(event: Event) => this.vm.setFormLabel(event)}
              />
            </div>
            <div class="field">
              <label for="iface-form-host">{t("interfaces.form.host")}</label>
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
              <label for="iface-form-endpoint-port">{t("interfaces.form.endpointPort")}</label>
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
              <label for="iface-form-listen-port">{t("interfaces.form.listenPort")}</label>
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
              <label for="iface-form-mtu">{t("interfaces.form.mtu")}</label>
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
        title={this.vm.editing ? t("interfaces.edit.title", { name: this.vm.editing.name }) : t("interfaces.edit.titleFallback")}
        wide={true}
        onClose={() => this.vm.closeEdit()}
        footer={
          <>
            <button class="btn" type="button" onClick={() => this.vm.closeEdit()}>{t("common.cancelShort")}</button>
            <button
              class="btn btn--primary"
              type="submit"
              form="interface-edit"
              disabled={!this.vm.canSaveEdit}
            >
              {this.vm.busy ? t("interfaces.edit.saving") : t("common.saveShort")}
            </button>
          </>
        }
      >
        <form id="interface-edit" class="stack" onSubmit={(event: Event) => this.vm.submitEdit(event)}>
          <div class="grid grid--2">
            <div class="field">
              <label for="iface-edit-label">{t("interfaces.form.label")}</label>
              <input
                id="iface-edit-label"
                class="input"
                type="text"
                value={this.vm.editLabel}
                onInput={(event: Event) => this.vm.setEditLabel(event)}
              />
            </div>
            <div class="field">
              <label for="iface-edit-host">{t("interfaces.form.host")}</label>
              <input
                id="iface-edit-host"
                class="input"
                type="text"
                value={this.vm.editHost}
                onInput={(event: Event) => this.vm.setEditHost(event)}
              />
            </div>
            <div class="field">
              <label for="iface-edit-endpoint-port">{t("interfaces.form.endpointPort")}</label>
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
              <label for="iface-edit-listen-port">{t("interfaces.form.listenPort")}</label>
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
              <label for="iface-edit-mtu">{t("interfaces.form.mtu")}</label>
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
              <label>{t("interfaces.edit.state")}</label>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={this.vm.editEnabled}
                  onChange={(event: Event) => this.vm.setEditEnabled(event)}
                />
                <span class="track"></span>
                <span>{this.vm.editEnabled ? t("interfaces.edit.on") : t("interfaces.edit.off")}</span>
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
        title={t("interfaces.rotated.title")}
        onClose={() => this.vm.closeRotated()}
        footer={<button class="btn btn--primary" type="button" onClick={() => this.vm.closeRotated()}>{t("common.done")}</button>}
      >
        <div class="stack-sm">
          <div class="alert alert--warn">
            {t("interfaces.rotated.warning")}
          </div>
          <div class="field">
            <label for="iface-rotated-key">{t("interfaces.rotated.newKey")}</label>
            <div class="copy-row">
              <input id="iface-rotated-key" class="input" readonly value={this.vm.rotated?.public_key ?? ""} />
              <button class="btn" type="button" onClick={() => this.vm.copyRotatedPublicKey()}>
                <Icon name={this.vm.rotatedCopied ? "check" : "copy"} size={16} class="" />
                {this.vm.rotatedCopied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
