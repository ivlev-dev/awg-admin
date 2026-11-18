import { For, Show } from "@ivlev-dev/silent-core";

import type { InterfacesPageVM, InterfacesSortKey } from "./InterfacesPage.vm";
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
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("interfaces.eyebrow")}</div>
        <h1>{t("interfaces.title")}</h1>
        <p>{t("interfaces.subtitle")}</p>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
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
                              <span class="cell-sub xs muted" title={`${item.group_name} · ${item.node_name}`}>
                                {item.group_name} · {item.node_name}
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
                          <span class="entity-card__sub xs muted" title={`${item.group_name} · ${item.node_name}`}>
                            {item.group_name} · {item.node_name}
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
                          <dt>{t("interfaces.filter.group")} / {t("interfaces.filter.node")}</dt>
                          <dd>{item.group_name} · {item.node_name}</dd>
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
