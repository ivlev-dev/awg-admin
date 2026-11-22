import { For, Show } from "@ivlev-dev/silent-core";

import type { InterfacesPageVM, InterfacesSortKey } from "./InterfacesPage.vm";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

function avatarLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function ariaSort(
  vm: InterfacesPageVM,
  key: InterfacesSortKey,
): "ascending" | "descending" | "none" {
  if (vm.sort === null || vm.sort.key !== key) return "none";
  return vm.sort.direction === "asc" ? "ascending" : "descending";
}

export function InterfacesPage(this: { vm: InterfacesPageVM }) {
  const create = this.vm.createForm;
  const edit = this.vm.editForm;
  const createGroup = create.getFieldProps("groupId");
  const createNode = create.getFieldProps("nodeId");
  const createName = create.getFieldProps("name");
  const createLabel = create.getFieldProps("label");
  const createHost = create.getFieldProps("endpointHost");
  const createEndpointPort = create.getFieldProps("endpointPort");
  const createListenPort = create.getFieldProps("listenPort");
  const createMtu = create.getFieldProps("mtu");
  const editLabel = edit.getFieldProps("label");
  const editHost = edit.getFieldProps("endpointHost");
  const editEndpointPort = edit.getFieldProps("endpointPort");
  const editListenPort = edit.getFieldProps("listenPort");
  const editMtu = edit.getFieldProps("mtu");
  const editEnabled = edit.getFieldProps("enabled");

  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("interfaces.eyebrow")}</div>
        <h1>{t("interfaces.title")}</h1>
        <p>{t("interfaces.subtitle")}</p>
      </div>

      <Show when={this.vm.error}>
        <ErrorState message={this.vm.error ?? ""} onRetry={() => this.vm.load()} />
      </Show>

      <section class="card card--flush">
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">{t("interfaces.card.title")}</div>
              <div class="data-toolbar__sub">
                {t("interfaces.count", { visible: this.vm.visible.length, total: this.vm.interfaces.length })}
              </div>
            </div>
            <div class="data-toolbar__actions">
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

          <div class="data-toolbar__bottom">
            <div class="search">
              <Icon name="search" size={18} class="" />
              <input
                id="iface-search"
                type="search"
                aria-label={t("interfaces.search.label")}
                placeholder={t("interfaces.search.placeholder")}
                value={this.vm.search}
                onInput={(event: Event) => this.vm.setSearch(event)}
              />
            </div>
            <Show when={this.vm.isAdmin}>
              <Show when={this.vm.groupFilterEnabled}>
                <div class="field">
                  <label for="iface-group">{t("interfaces.filter.group")}</label>
                  <Select
                    id="iface-group"
                    value={this.vm.groupFilter}
                    options={[{ value: "", label: t("interfaces.filter.allGroups") }, ...this.vm.groups.map((group) => ({ value: group.id, label: group.name }))]}
                    onChange={(value) => this.vm.setGroupFilter(value)}
                    ariaLabel={t("interfaces.filter.group")}
                    searchable
                  />
                </div>
              </Show>
              <div class="field">
                <label for="iface-node">{t("interfaces.filter.node")}</label>
                <Select
                  id="iface-node"
                  value={this.vm.nodeFilter}
                  options={[{ value: "", label: t("interfaces.filter.allNodes") }, ...this.vm.nodes.map((node) => ({ value: node.id, label: node.name }))]}
                  onChange={(value) => this.vm.setNodeFilter(value)}
                  ariaLabel={t("interfaces.filter.node")}
                  searchable
                />
              </div>
            </Show>
            <Show when={this.vm.filtersActive}>
              <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.resetFilters()}>
                <Icon name="close" size={14} class="" /> {t("filters.reset")}
              </button>
            </Show>
          </div>
        </div>

        <div class="data-scroll table-wrap--cards" aria-busy={this.vm.loading ? "true" : "false"}>
          <Show when={!this.vm.loading} fallback={<SkeletonTable rows={5} columns={6} />}>
            <Show
              when={this.vm.visible.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__icon"><Icon name="interfaces" size={28} class="" /></div>
                  <div class="empty__title">
                    {this.vm.hasInterfaces ? t("interfaces.emptyFiltered.title") : t("interfaces.empty.title")}
                  </div>
                  <div class="empty__text">
                    {this.vm.hasInterfaces
                      ? t("interfaces.emptyFiltered.text")
                      : this.vm.isAdmin
                        ? t("interfaces.empty.textAdmin")
                        : t("interfaces.empty.textUser")}
                  </div>
                  <Show when={this.vm.filtersActive || this.vm.isAdmin}>
                    <div class="row" style="justify-content:center;margin-top:14px">
                      <Show when={this.vm.filtersActive}>
                        <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.resetFilters()}>
                          <Icon name="close" size={14} class="" /> {t("filters.reset")}
                        </button>
                      </Show>
                      <Show when={this.vm.isAdmin}>
                        <button class="btn btn--sm" type="button" onClick={() => this.vm.openCreate()}>
                          <Icon name="plus" size={14} class="" /> {t("interfaces.create")}
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>
              }
            >
              <table class="table table--cards table--interfaces table--fixed table--desktop">
                <thead>
                  <tr>
                    <th class="col-interface is-sortable" aria-sort={ariaSort(this.vm, "name")}>
                      <button type="button" onClick={() => this.vm.sortBy("name")}>
                        {t("interfaces.column.interface")} <span class="sort-indicator">{this.vm.sortMark("name")}</span>
                      </button>
                    </th>
                    <th class="col-address is-sortable" style="width:230px" aria-sort={ariaSort(this.vm, "endpoint")}>
                      <button type="button" onClick={() => this.vm.sortBy("endpoint")}>
                        {t("interfaces.column.address")} <span class="sort-indicator">{this.vm.sortMark("endpoint")}</span>
                      </button>
                    </th>
                    <th class="col-peers is-sortable" style="width:110px" aria-sort={ariaSort(this.vm, "peers")}>
                      <button type="button" onClick={() => this.vm.sortBy("peers")}>
                        {t("interfaces.column.peers")} <span class="sort-indicator">{this.vm.sortMark("peers")}</span>
                      </button>
                    </th>
                    <th class="col-limits" style="width:160px">{t("interfaces.column.limits")}</th>
                    <th class="col-status is-sortable" style="width:170px" aria-sort={ariaSort(this.vm, "status")}>
                      <button type="button" onClick={() => this.vm.sortBy("status")}>
                        {t("interfaces.column.status")} <span class="sort-indicator">{this.vm.sortMark("status")}</span>
                      </button>
                    </th>
                    <th class="col-actions" style="width:218px"></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={this.vm.visible}>
                    {(item) => (
                      <tr>
                        <td class="col-interface" data-label={t("interfaces.column.interface")}>
                          <div class="cell-name">
                            <span class="cell-avatar" aria-hidden="true">{avatarLetter(item.name)}</span>
                            <span class="cell-name__text">
                              <span class="strong" title={item.label ? `${item.name} · ${item.label}` : item.name}>
                                {item.name}
                                <Show when={item.label}>
                                  <span class="xs muted"> · {item.label}</span>
                                </Show>
                              </span>
                              <span class="cell-sub xs muted" title={item.node_name}>
                                {item.node_name}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td class="col-address" data-label={t("interfaces.column.address")}>
                          <div class="cell-name">
                            <span class="cell-name__text">
                              <span class="mono xs truncate" title={this.vm.endpoint(item)}>{this.vm.endpoint(item)}</span>
                            </span>
                            <button
                              class="btn btn--icon"
                              type="button"
                              aria-label={t("interfaces.endpoint.copyAria")}
                              title={t("interfaces.endpoint.copyAria")}
                              onClick={() => this.vm.copyEndpoint(item)}
                            >
                              <Icon name="copy" size={16} class="" />
                            </button>
                          </div>
                        </td>
                        <td class="col-peers" data-label={t("interfaces.column.peers")}>
                          <span class="small strong nowrap">{this.vm.peersLabel(item)}</span>
                        </td>
                        <td class="col-limits" data-label={t("interfaces.column.limits")}>
                          <div class="cell-name__text">
                            <span class="xs nowrap">
                              <span class="muted">{t("interfaces.form.listenPort")}</span>{" "}
                              <span class="mono strong">{item.listen_port}</span>
                            </span>
                            <span class="cell-sub xs muted nowrap">
                              <span>{t("interfaces.form.mtu")}</span>{" "}
                              <span class="mono strong">{item.mtu}</span>
                            </span>
                          </div>
                        </td>
                        <td class="col-status" data-label={t("interfaces.column.status")}>
                          <div class="cell-name__text">
                            <span class={`status-chip ${item.enabled ? "status-chip--ok" : "status-chip--warn"}`}>
                              <span class="status-chip__dot"></span>
                              {item.enabled ? t("interfaces.status.enabled") : t("interfaces.status.disabled")}
                            </span>
                            <Show when={item.obf.random_trailers}>
                              <span class="cell-sub xs muted">RandomTrailers</span>
                            </Show>
                          </div>
                        </td>
                        <td class="cell-actions col-actions">
                          <button
                            class="btn btn--icon"
                            type="button"
                            aria-label={t("interfaces.publicKey.copyAria")}
                            title={`${t("interfaces.publicKey")}: ${item.public_key}`}
                            onClick={() => this.vm.copyPublicKey(item)}
                          >
                            <Icon name="copy" size={16} class="" />
                            <span class="btn__label">{t("common.copy")}</span>
                          </button>
                          <Show when={this.vm.isAdmin}>
                            <button
                              class="btn btn--icon"
                              type="button"
                              disabled={this.vm.busy}
                              aria-label={t("interfaces.action.edit")}
                              title={t("interfaces.action.edit")}
                              onClick={() => this.vm.openEdit(item)}
                            >
                              <Icon name="edit" size={16} class="" />
                              <span class="btn__label">{t("interfaces.action.edit")}</span>
                            </button>
                            <button
                              class="btn btn--icon"
                              type="button"
                              disabled={this.vm.busy}
                              aria-label={t("interfaces.action.rotate")}
                              title={t("interfaces.action.rotate")}
                              onClick={() => this.vm.rotate(item)}
                            >
                              <Icon name="refresh" size={16} class="" />
                              <span class="btn__label">{t("interfaces.action.rotate")}</span>
                            </button>
                            <button
                              class="btn btn--icon btn--danger"
                              type="button"
                              disabled={this.vm.busy}
                              aria-label={t("interfaces.action.delete")}
                              title={t("interfaces.action.delete")}
                              onClick={() => this.vm.remove(item)}
                            >
                              <Icon name="trash" size={16} class="" />
                              <span class="btn__label">{t("interfaces.action.delete")}</span>
                            </button>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              <div class="entity-list">
                <For each={this.vm.visible}>
                  {(item) => (
                    <article class="entity-card">
                      <div class="entity-card__head">
                        <span class="cell-avatar" aria-hidden="true">{avatarLetter(item.name)}</span>
                        <div class="entity-card__title">
                          <span class="entity-card__name">
                            {item.name}
                            <Show when={item.label}>
                              <span class="xs muted"> · {item.label}</span>
                            </Show>
                          </span>
                          <span class="entity-card__sub xs muted" title={item.node_name}>
                            {item.node_name}
                          </span>
                        </div>
                        <span class={`status-chip ${item.enabled ? "status-chip--ok" : "status-chip--warn"}`}>
                          <span class="status-chip__dot"></span>
                          {item.enabled ? t("interfaces.status.enabled") : t("interfaces.status.disabled")}
                        </span>
                      </div>
                      <dl class="entity-card__meta">
                        <div>
                          <dt>{t("interfaces.column.address")}</dt>
                          <dd>
                            <span class="mono xs" title={this.vm.endpoint(item)}>{this.vm.endpoint(item)}</span>
                            <button
                              class="btn btn--icon"
                              type="button"
                              aria-label={t("interfaces.endpoint.copyAria")}
                              title={t("interfaces.endpoint.copyAria")}
                              onClick={() => this.vm.copyEndpoint(item)}
                            >
                              <Icon name="copy" size={16} class="" />
                            </button>
                          </dd>
                        </div>
                        <div>
                          <dt>{t("interfaces.column.peers")}</dt>
                          <dd>{this.vm.peersLabel(item)}</dd>
                        </div>
                        <div>
                          <dt>{t("interfaces.column.limits")}</dt>
                          <dd>
                            <span class="xs nowrap">
                              <span class="muted">{t("interfaces.form.listenPort")}</span>{" "}
                              <span class="mono strong">{item.listen_port}</span>
                            </span>
                            <br />
                            <span class="cell-sub xs muted nowrap">
                              <span>{t("interfaces.form.mtu")}</span>{" "}
                              <span class="mono strong">{item.mtu}</span>
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt>{t("interfaces.filter.node")}</dt>
                          <dd>{item.node_name}</dd>
                        </div>
                      </dl>
                      <div class="entity-card__foot">
                        <button
                          class="btn btn--text btn--sm"
                          type="button"
                          aria-label={t("interfaces.publicKey.copyAria")}
                          title={`${t("interfaces.publicKey")}: ${item.public_key}`}
                          onClick={() => this.vm.copyPublicKey(item)}
                        >
                          <Icon name="copy" size={14} class="" /> {t("common.copy")}
                        </button>
                        <Show when={this.vm.isAdmin}>
                          <button
                            class="btn btn--text btn--sm"
                            type="button"
                            disabled={this.vm.busy}
                            aria-label={t("interfaces.action.edit")}
                            title={t("interfaces.action.edit")}
                            onClick={() => this.vm.openEdit(item)}
                          >
                            <Icon name="edit" size={14} class="" /> {t("interfaces.action.edit")}
                          </button>
                          <button
                            class="btn btn--text btn--sm"
                            type="button"
                            disabled={this.vm.busy}
                            aria-label={t("interfaces.action.rotate")}
                            title={t("interfaces.action.rotate")}
                            onClick={() => this.vm.rotate(item)}
                          >
                            <Icon name="refresh" size={14} class="" /> {t("interfaces.action.rotate")}
                          </button>
                          <button
                            class="btn btn--danger btn--sm"
                            type="button"
                            disabled={this.vm.busy}
                            aria-label={t("interfaces.action.delete")}
                            title={t("interfaces.action.delete")}
                            onClick={() => this.vm.remove(item)}
                          >
                            <Icon name="trash" size={14} class="" /> {t("interfaces.action.delete")}
                          </button>
                        </Show>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </section>

      <Modal
        open={this.vm.createOpen}
        title={t("interfaces.form.title")}
        wide={true}
        onClose={() => { void this.vm.closeCreate(); }}
        footer={
          <>
            <button class="btn" type="button" onClick={() => { void this.vm.closeCreate(); }}>{t("common.cancelShort")}</button>
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
              <Show when={this.vm.groups.length > 1}>
                <label for="iface-form-group">{t("interfaces.form.group")}</label>
                <Select
                  id="iface-form-group"
                  value={createGroup.value}
                  options={this.vm.groups.map((group) => ({ value: group.id, label: group.name }))}
                  onChange={(value) => createGroup.onChange({ currentTarget: { value } })}
                  ariaLabel={t("interfaces.form.group")}
                />
              </Show>
            </div>
            <div class="field">
              <label for="iface-form-node">{t("interfaces.form.node")}</label>
              <Select
                id="iface-form-node"
                value={createNode.value}
                options={this.vm.nodes.map((node) => ({ value: node.id, label: node.name }))}
                onChange={(value) => createNode.onChange({ currentTarget: { value } })}
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
                value={createName.value}
                aria-invalid={createName.touched && createName.error ? "true" : "false"}
                aria-describedby={createName.touched && createName.error ? "name-error" : undefined}
                onInput={(event: Event) => createName.onInput(event)}
                onBlur={() => createName.onBlur()}
              />
              <Show when={createName.touched && createName.error}>
                <span class="hint" id="name-error" style="color:var(--md-error)">{createName.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-form-label">{t("interfaces.form.label")}</label>
              <input
                id="iface-form-label"
                class="input"
                type="text"
                placeholder={t("interfaces.form.labelPlaceholder")}
                value={createLabel.value}
                aria-invalid={createLabel.touched && createLabel.error ? "true" : "false"}
                aria-describedby={createLabel.touched && createLabel.error ? "label-error" : undefined}
                onInput={(event: Event) => createLabel.onInput(event)}
                onBlur={() => createLabel.onBlur()}
              />
              <Show when={createLabel.touched && createLabel.error}>
                <span class="hint" id="label-error" style="color:var(--md-error)">{createLabel.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-form-host">{t("interfaces.form.host")}</label>
              <input
                id="iface-form-host"
                class="input"
                type="text"
                placeholder="vpn.example.com"
                value={createHost.value}
                aria-invalid={createHost.touched && createHost.error ? "true" : "false"}
                aria-describedby={createHost.touched && createHost.error ? "endpoint-host-error" : undefined}
                onInput={(event: Event) => createHost.onInput(event)}
                onBlur={() => createHost.onBlur()}
              />
              <Show when={createHost.touched && createHost.error}>
                <span class="hint" id="endpoint-host-error" style="color:var(--md-error)">{createHost.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-form-endpoint-port">{t("interfaces.form.endpointPort")}</label>
              <input
                id="iface-form-endpoint-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={createEndpointPort.value}
                aria-invalid={createEndpointPort.touched && createEndpointPort.error ? "true" : "false"}
                aria-describedby={createEndpointPort.touched && createEndpointPort.error ? "endpoint-port-error" : undefined}
                onInput={(event: Event) => createEndpointPort.onInput(event)}
                onBlur={() => createEndpointPort.onBlur()}
              />
              <Show when={createEndpointPort.touched && createEndpointPort.error}>
                <span class="hint" id="endpoint-port-error" style="color:var(--md-error)">{createEndpointPort.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-form-listen-port">{t("interfaces.form.listenPort")}</label>
              <input
                id="iface-form-listen-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={createListenPort.value}
                aria-invalid={createListenPort.touched && createListenPort.error ? "true" : "false"}
                aria-describedby={createListenPort.touched && createListenPort.error ? "listen-port-error" : undefined}
                onInput={(event: Event) => createListenPort.onInput(event)}
                onBlur={() => createListenPort.onBlur()}
              />
              <Show when={createListenPort.touched && createListenPort.error}>
                <span class="hint" id="listen-port-error" style="color:var(--md-error)">{createListenPort.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-form-mtu">{t("interfaces.form.mtu")}</label>
              <input
                id="iface-form-mtu"
                class="input"
                type="number"
                min="576"
                max="65535"
                value={createMtu.value}
                aria-invalid={createMtu.touched && createMtu.error ? "true" : "false"}
                aria-describedby={createMtu.touched && createMtu.error ? "mtu-error" : undefined}
                onInput={(event: Event) => createMtu.onInput(event)}
                onBlur={() => createMtu.onBlur()}
              />
              <Show when={createMtu.touched && createMtu.error}>
                <span class="hint" id="mtu-error" style="color:var(--md-error)">{createMtu.error ?? ""}</span>
              </Show>
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
        onClose={() => { void this.vm.closeEdit(); }}
        footer={
          <>
            <button class="btn" type="button" onClick={() => { void this.vm.closeEdit(); }}>{t("common.cancelShort")}</button>
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
                value={editLabel.value}
                aria-invalid={editLabel.touched && editLabel.error ? "true" : "false"}
                aria-describedby={editLabel.touched && editLabel.error ? "edit-label-error" : undefined}
                onInput={(event: Event) => editLabel.onInput(event)}
                onBlur={() => editLabel.onBlur()}
              />
              <Show when={editLabel.touched && editLabel.error}>
                <span class="hint" id="edit-label-error" style="color:var(--md-error)">{editLabel.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-edit-host">{t("interfaces.form.host")}</label>
              <input
                id="iface-edit-host"
                class="input"
                type="text"
                value={editHost.value}
                aria-invalid={editHost.touched && editHost.error ? "true" : "false"}
                aria-describedby={editHost.touched && editHost.error ? "edit-host-error" : undefined}
                onInput={(event: Event) => editHost.onInput(event)}
                onBlur={() => editHost.onBlur()}
              />
              <Show when={editHost.touched && editHost.error}>
                <span class="hint" id="edit-host-error" style="color:var(--md-error)">{editHost.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-edit-endpoint-port">{t("interfaces.form.endpointPort")}</label>
              <input
                id="iface-edit-endpoint-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={editEndpointPort.value}
                aria-invalid={editEndpointPort.touched && editEndpointPort.error ? "true" : "false"}
                aria-describedby={editEndpointPort.touched && editEndpointPort.error ? "edit-endpoint-port-error" : undefined}
                onInput={(event: Event) => editEndpointPort.onInput(event)}
                onBlur={() => editEndpointPort.onBlur()}
              />
              <Show when={editEndpointPort.touched && editEndpointPort.error}>
                <span class="hint" id="edit-endpoint-port-error" style="color:var(--md-error)">{editEndpointPort.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-edit-listen-port">{t("interfaces.form.listenPort")}</label>
              <input
                id="iface-edit-listen-port"
                class="input"
                type="number"
                min="1"
                max="65535"
                value={editListenPort.value}
                aria-invalid={editListenPort.touched && editListenPort.error ? "true" : "false"}
                aria-describedby={editListenPort.touched && editListenPort.error ? "edit-listen-port-error" : undefined}
                onInput={(event: Event) => editListenPort.onInput(event)}
                onBlur={() => editListenPort.onBlur()}
              />
              <Show when={editListenPort.touched && editListenPort.error}>
                <span class="hint" id="edit-listen-port-error" style="color:var(--md-error)">{editListenPort.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label for="iface-edit-mtu">{t("interfaces.form.mtu")}</label>
              <input
                id="iface-edit-mtu"
                class="input"
                type="number"
                min="576"
                max="65535"
                value={editMtu.value}
                aria-invalid={editMtu.touched && editMtu.error ? "true" : "false"}
                aria-describedby={editMtu.touched && editMtu.error ? "edit-mtu-error" : undefined}
                onInput={(event: Event) => editMtu.onInput(event)}
                onBlur={() => editMtu.onBlur()}
              />
              <Show when={editMtu.touched && editMtu.error}>
                <span class="hint" id="edit-mtu-error" style="color:var(--md-error)">{editMtu.error ?? ""}</span>
              </Show>
            </div>
            <div class="field">
              <label>{t("interfaces.edit.state")}</label>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={editEnabled.value}
                  onChange={(event: Event) => editEnabled.onChange(event)}
                />
                <span class="track"></span>
                <span>{editEnabled.value ? t("interfaces.edit.on") : t("interfaces.edit.off")}</span>
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
