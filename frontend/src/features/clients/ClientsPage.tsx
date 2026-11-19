import { For, Show } from "@ivlev-dev/silent-core";

import type { ClientsPageVM } from "./ClientsPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { BulkBar } from "@/components/BulkBar";
import { Modal } from "@/components/Modal";
import { RateField } from "@/components/RateField";
import { SkeletonTable } from "@/components/Skeleton";
import { isRowInteractiveTarget, tableKeyAction } from "@/domain/table-keys";
import { t } from "@/i18n";
import { formatRateI18n } from "@/i18n/format";

function rateLabel(value: number): string {
  return value > 0 ? formatRateI18n(value) : "∞";
}

function handleRowKeyDown(
  event: KeyboardEvent,
  vm: ClientsPageVM,
  deviceId: string,
): void {
  if (isRowInteractiveTarget(event.target)) return;
  const action = tableKeyAction(event.key);
  if (action === null) return;
  event.preventDefault();
  if (action === "activate") {
    vm.openDevice(deviceId);
    return;
  }
  const row = event.currentTarget;
  if (!(row instanceof HTMLTableRowElement)) return;
  const rows = Array.from(
    row.parentElement?.querySelectorAll<HTMLTableRowElement>("tr[tabindex]") ?? [],
  );
  const index = rows.indexOf(row);
  if (index === -1) return;
  const target = action === "next" ? rows[index + 1] : rows[index - 1];
  target?.focus();
}

export function ClientsPage(this: { vm: ClientsPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("clients.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("clients.title")}</h1>
            <p>{t("clients.subtitle")}</p>
          </div>
        </div>
      </div>

      <section class="card card--flush">
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">{t("clients.card.title")}</div>
              <div class="data-toolbar__sub">{this.vm.countLabel}</div>
            </div>
            <div class="data-toolbar__actions">
              <button class="btn" type="button" disabled={this.vm.loading || this.vm.refreshing} onClick={() => this.vm.load()}>
                <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
              </button>
              <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                <Icon name="plus" size={16} class="" /> {t("clients.new")}
              </button>
            </div>
          </div>
          <div class="data-toolbar__bottom">
            <div class="search">
              <Icon name="search" size={18} class="" />
              <input
                id="clients-search"
                type="search"
                aria-label={t("filters.search")}
                placeholder={t("filters.search.clients")}
                value={this.vm.query}
                onInput={(event: Event) => this.vm.setQuery(event)}
              />
            </div>
            <Show when={this.vm.isAdmin && this.vm.interfaceOptions.length > 0}>
              <div class="field">
                <label for="clients-interface">{t("clients.filter.interface")}</label>
                <Select
                  id="clients-interface"
                  value={this.vm.interfaceFilter}
                  options={[{ value: "", label: t("clients.filter.allInterfaces") }, ...this.vm.interfaceOptions]}
                  onChange={(value) => this.vm.setInterfaceFilter(value)}
                  ariaLabel={t("clients.filter.interface")}
                />
              </div>
            </Show>
            <div class="field">
              <label for="clients-status">{t("clients.column.status")}</label>
              <Select
                id="clients-status"
                value={this.vm.statusFilter}
                options={[
                  { value: "all", label: t("clients.filter.allStatuses") },
                  { value: "active", label: t("clients.status.active") },
                  { value: "revoked", label: t("clients.status.revoked") },
                ]}
                onChange={(value) => this.vm.setStatusFilter(value)}
                ariaLabel={t("clients.column.status")}
              />
            </div>
            <Show when={this.vm.hasActiveFilters}>
              <button class="btn btn--text btn--sm" type="button" onClick={() => this.vm.resetFilters()}>
                <Icon name="close" size={14} class="" /> {t("filters.reset")}
              </button>
            </Show>
          </div>
        </div>
        <div class="data-scroll table-wrap--cards" aria-busy={this.vm.loading || this.vm.refreshing ? "true" : "false"}>
          <Show
            when={!this.vm.loading}
            fallback={<SkeletonTable rows={5} columns={this.vm.isAdmin ? 8 : 7} />}
          >
            <Show
              when={!(this.vm.error && this.vm.devices.length === 0)}
              fallback={
                <div class="empty" role="alert">
                  <div class="empty__icon"><Icon name="warning" size={28} class="" /></div>
                  <div class="empty__title">{t("common.error")}</div>
                  <div class="empty__text">{this.vm.error}</div>
                  <div style="margin-top:14px">
                    <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.load()}>
                      <Icon name="refresh" size={14} class="" /> {t("common.retry")}
                    </button>
                  </div>
                </div>
              }
            >
            <Show
              when={this.vm.devices.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__icon"><Icon name="clients" size={28} class="" /></div>
                  <div class="empty__title">
                    {this.vm.hasActiveFilters ? t("filters.emptyTitle") : t("clients.empty.title")}
                  </div>
                  <div class="empty__text">
                    {this.vm.hasActiveFilters
                      ? t("filters.emptyText")
                      : t("clients.empty.text")}
                  </div>
                  <div style="margin-top:14px">
                    <Show
                      when={this.vm.hasActiveFilters}
                      fallback={
                        <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.openCreate()}>
                          <Icon name="plus" size={14} class="" /> {t("clients.empty.action")}
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
              <table class="table table--cards table--clients table--desktop" aria-label={t("clients.card.title")}>
                <thead>
                  <tr>
                    <th class="cell-select">
                      <input
                        type="checkbox"
                        aria-label={t("clients.selectAll")}
                        checked={this.vm.allFilteredSelected}
                        onChange={() => this.vm.toggleSelectAll()}
                      />
                    </th>
                    <th class="is-sortable">
                      <button type="button" onClick={() => this.vm.sortBy("name")}>
                        {t("clients.column.device")} <span class="sort-indicator">{this.vm.sortMark("name")}</span>
                      </button>
                    </th>
                    <Show when={this.vm.isAdmin}>
                      <th class="col-owner">{t("clients.column.owner")}</th>
                    </Show>
                    <th class="col-interface">{t("clients.column.interface")}</th>
                    <th class="col-address">{t("clients.column.addresses")}</th>
                    <th class="col-limits">{t("clients.column.limits")}</th>
                    <th class="col-status">{t("clients.column.status")}</th>
                    <th class="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={this.vm.pagedDevices}>
                    {(device) => (
                      <tr
                        class={this.vm.isSelected(device.id) ? "is-selected" : ""}
                        tabindex={0}
                        data-device={device.id}
                        onKeyDown={(event: KeyboardEvent) => handleRowKeyDown(event, this.vm, device.id)}
                      >
                        <td class="cell-select">
                          <input
                            type="checkbox"
                            aria-label={device.name}
                            checked={this.vm.isSelected(device.id)}
                            onChange={() => this.vm.toggleSelected(device.id)}
                          />
                        </td>
                        <td class="col-device" data-label={t("clients.column.device")}>
                          <div class="cell-name">
                            <span class="cell-avatar">{device.name.slice(0, 1).toUpperCase()}</span>
                            <span class="cell-name__text">
                              <span class="strong" title={device.name}>{device.name}</span>
                            </span>
                          </div>
                        </td>
                        <Show when={this.vm.isAdmin}>
                          <td class="col-owner" data-label={t("clients.column.owner")}>
                            <div class="cell-name__text cell-stack">
                              <span class="small strong">{this.vm.userEmail(device.user_id)}</span>
                            </div>
                          </td>
                        </Show>
                        <td class="col-interface" data-label={t("clients.column.interface")}>
                          <div class="cell-name__text">
                            <span class="small strong">{device.interface_name || "—"}</span>
                            <span class="xs muted">{device.node_name || "—"}</span>
                            <span class="row wrap" style="gap:4px;margin-top:4px">
                              <span class="badge badge--blue" title={t("clients.column.tunnels")}>
                                {this.vm.tunnelsLabel(device)}
                              </span>
                              <Show when={this.vm.tunnelCount(device) > 1}>
                                <For each={this.vm.interfaceChips(device)}>
                                  {(chip) => (
                                    <span class="badge badge--gray mono">
                                      {chip.count > 1 ? `${chip.name} ×${chip.count}` : chip.name}
                                    </span>
                                  )}
                                </For>
                              </Show>
                            </span>
                          </div>
                        </td>
                        <td class="col-address cell-addresses" data-label={t("clients.column.addresses")}>
                          <Show
                            when={device.addresses.length > 0}
                            fallback={<span class="muted">—</span>}
                          >
                            <span class="mono xs">{device.addresses.join(", ")}</span>
                          </Show>
                        </td>
                        <td class="col-limits" data-label={t("clients.column.limits")}>
                          <div class="cell-name__text">
                            <span class="xs nowrap" title={formatRateI18n(device.down_kbps)}>
                              <span class="muted">↓</span> {rateLabel(device.down_kbps)}
                            </span>
                            <span class="xs nowrap" title={formatRateI18n(device.up_kbps)}>
                              <span class="muted">↑</span> {rateLabel(device.up_kbps)}
                            </span>
                          </div>
                        </td>
                        <td class="col-status cell-status" data-label={t("clients.column.status")}>
                          <span class={`status-chip ${device.revoked ? "status-chip--error" : "status-chip--ok"}`}>
                            <span class="status-chip__dot"></span>
                            {device.revoked ? t("clients.status.revoked") : t("clients.status.active")}
                          </span>
                        </td>
                        <td class="cell-actions col-actions">
                          <button
                            class="btn btn--text btn--sm"
                            type="button"
                            aria-label={t("common.open")} title={t("common.open")}
                            onClick={() => this.vm.openDevice(device.id)}
                          >
                            {t("common.open")} <Icon name="chevron" size={14} class="" />
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
                  <span class="small">{this.vm.currentPage} / {this.vm.pageCount}</span>
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
            { label: t("clients.bulk.revokeShares"), onClick: () => { void this.vm.bulkRevokeShares(); } },
            { label: t("bulk.delete"), variant: "danger", onClick: () => { void this.vm.bulkDelete(); } },
          ]}
        />
      </Show>

      <Modal
        open={this.vm.createOpen}
        title={t("clients.form.title")}
        onClose={() => void this.vm.closeCreate()}
        footer={
          <div class="row" style="gap:8px">
            <button
              class="btn"
              type="button"
              disabled={this.vm.submitting}
              onClick={() => void this.vm.closeCreate()}
            >
              {t("common.cancelShort")}
            </button>
            <button
              class="btn btn--primary"
              type="button"
              disabled={!this.vm.canCreate}
              onClick={() => this.vm.create()}
            >
              <Show
                when={this.vm.submitting}
                fallback={<span>{t("clients.form.create")}</span>}
              >
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("clients.form.creating")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <div class="field">
            <label for="client-name">{t("clients.form.name")}</label>
            <input
              id="client-name"
              class="input"
              type="text"
              placeholder={t("clients.form.namePlaceholder")}
              value={this.vm.formName}
              onInput={(event: Event) => this.vm.setFormName(event)}
            />
          </div>

          <div class={this.vm.isAdmin ? "grid grid--2" : "stack"}>
            <Show when={this.vm.isAdmin}>
              <div class="field">
                <label for="client-user">{t("clients.form.user")}</label>
                <Select
                  id="client-user"
                  value={this.vm.formUserId}
                  options={[{ value: "", label: t("clients.form.userPlaceholder") }, ...this.vm.users.map((user) => ({ value: user.id, label: user.email ?? user.login }))]}
                  onChange={(value) => this.vm.setFormUser(value)}
                  ariaLabel={t("clients.form.user")}
                />
              </div>
            </Show>
            <Show when={this.vm.isAdmin || this.vm.formInterfaceOptions.length > 0}>
              <div class="field">
                <span class="xs muted">{t("clients.form.interfaces")}</span>
                <Show
                  when={this.vm.formInterfaceOptions.length > 0}
                  fallback={<div class="hint">{t("clients.form.interfacesEmpty")}</div>}
                >
                  <input
                    class="input"
                    type="search"
                    aria-label={t("clients.form.interfacesSearch")}
                    placeholder={t("clients.form.interfacesSearch")}
                    value={this.vm.formInterfaceQuery}
                    onInput={(event: Event) => this.vm.setFormInterfaceQuery(event)}
                  />
                  <Show when={this.vm.formInterfacesPinned}>
                    <div class="hint">{t("clients.form.interfacesPinned")}</div>
                  </Show>
                  <div
                    class="interface-checklist"
                    role="group"
                    aria-label={t("clients.form.interfaces")}
                  >
                    <For each={this.vm.filteredFormInterfaceOptions}>
                      {(option) => (
                        <label class={`checkbox interface-option${option.disabled ? " is-disabled" : ""}`}>
                          <input
                            type="checkbox"
                            checked={this.vm.isFormInterfaceSelected(option.value)}
                            disabled={option.disabled}
                            onChange={() => this.vm.toggleFormInterface(option.value)}
                          />
                          <span class="interface-option__text">
                            <span>{option.label}</span>
                            <Show when={option.hint}>
                              <span class="xs muted">{option.hint}</span>
                            </Show>
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                  <div class="hint">{t("clients.form.interfacesHint")}</div>
                  <div class="hint">{t("clients.form.interfaceHint")}</div>
                  <Show when={this.vm.selectedFormInterfaceCount > 0}>
                    <div class="hint">{this.vm.formTunnelsLabel}</div>
                  </Show>
                </Show>
              </div>
            </Show>
            <Show when={!this.vm.isAdmin && this.vm.formInterfaceOptions.length === 0}>
              <div class="hint">{t("clients.form.interfaceAuto")}</div>
            </Show>
          </div>

          <Show when={!this.vm.isAdmin}>
            <div class="alert alert--info">
              {t("clients.form.ownAccount")}
            </div>
          </Show>

          <div class="grid grid--2">
            <RateField
              id="client-down"
              label={t("clients.form.down")}
              value={this.vm.formDownKbps}
              hint={t("clients.form.limitHint")}
              onChange={(kbps) => this.vm.setFormDownKbps(kbps)}
            />
            <RateField
              id="client-up"
              label={t("clients.form.up")}
              value={this.vm.formUpKbps}
              hint={t("clients.form.limitHint")}
              onChange={(kbps) => this.vm.setFormUpKbps(kbps)}
            />
          </div>

          <label class="checkbox">
            <input
              type="checkbox"
              checked={this.vm.formForwarding}
              onChange={(event: Event) => this.vm.setFormForwarding(event)}
            />
            <span>{t("clients.form.forwarding")}</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
