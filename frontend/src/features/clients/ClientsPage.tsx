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
              <button class="btn" type="button" onClick={() => this.vm.load()}>
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
                onChange={(value) => { this.vm.statusFilter = value as "all" | "active" | "revoked"; }}
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
        <div class="data-scroll table-wrap--cards" aria-busy={this.vm.loading ? "true" : "false"}>
          <Show
            when={!this.vm.loading}
            fallback={<SkeletonTable rows={5} columns={this.vm.isAdmin ? 8 : 7} />}
          >
            <Show
              when={this.vm.filteredDevices.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__icon"><Icon name="clients" size={28} class="" /></div>
                  <div class="empty__title">
                    {this.vm.devices.length === 0 ? t("clients.empty.title") : t("filters.emptyTitle")}
                  </div>
                  <div class="empty__text">
                    {this.vm.devices.length === 0
                      ? t("clients.empty.text")
                      : t("filters.emptyText")}
                  </div>
                  <div style="margin-top:14px">
                    <Show
                      when={this.vm.devices.length > 0}
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
              <table class="table table--cards table--clients table--fixed table--desktop">
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
                    <th class="col-peers">{t("clients.column.peers")}</th>
                    <th class="is-sortable">
                      <button type="button" onClick={() => this.vm.sortBy("status")}>
                        {t("clients.column.status")} <span class="sort-indicator">{this.vm.sortMark("status")}</span>
                      </button>
                    </th>
                    <th class="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={this.vm.filteredDevices}>
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
                              <span class="small strong">{this.vm.userLogin(device.user_id)}</span>
                            </div>
                          </td>
                        </Show>
                        <td class="col-interface" data-label={t("clients.column.interface")}>
                          <div class="cell-name__text">
                            <span class="small strong">{device.interface_name || "—"}</span>
                            <span class="xs muted">{device.node_name || "—"}</span>
                          </div>
                        </td>
                        <td class="col-address" data-label={t("clients.column.addresses")}>
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
                        <td class="col-peers" data-label={t("clients.column.peers")}>
                          <Show
                            when={device.peers.length > 0}
                            fallback={<span class="muted">—</span>}
                          >
                            <div class="cell-name__text">
                              <span class="small strong">{this.vm.peersLabel(device)}</span>
                              <span class="xs muted">{this.vm.interfaceNames(device)}</span>
                            </div>
                          </Show>
                        </td>
                        <td class="col-status" data-label={t("clients.column.status")}>
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
              <div class="entity-list">
                <For each={this.vm.filteredDevices}>
                  {(device) => (
                    <article class={`entity-card${this.vm.isSelected(device.id) ? " is-selected" : ""}`}>
                      <div class="entity-card__head">
                        <label class="check">
                          <input
                            type="checkbox"
                            aria-label={device.name}
                            checked={this.vm.isSelected(device.id)}
                            onChange={() => this.vm.toggleSelected(device.id)}
                          />
                          <span><Icon name="check" size={12} class="" /></span>
                        </label>
                        <span class="cell-avatar">{device.name.slice(0, 1).toUpperCase()}</span>
                        <div class="entity-card__title">
                          <span class="entity-card__name">{device.name}</span>
                          <span class="entity-card__sub">{this.vm.interfaceSummary(device)}</span>
                        </div>
                        <span class={`status-chip ${device.revoked ? "status-chip--error" : "status-chip--ok"}`}>
                          <span class="status-chip__dot"></span>
                          {device.revoked ? t("clients.status.revoked") : t("clients.status.active")}
                        </span>
                      </div>
                      <dl class="entity-card__meta">
                        <div>
                          <dt>{t("clients.column.interface")}</dt>
                          <dd>{device.interface_name || "—"}</dd>
                        </div>
                        <div>
                          <dt>{t("clients.details.node")}</dt>
                          <dd>{device.node_name || "—"}</dd>
                        </div>
                        <div>
                          <dt>{t("clients.column.addresses")}</dt>
                          <dd class="mono">{device.addresses.length > 0 ? device.addresses.join(", ") : "—"}</dd>
                        </div>
                        <div>
                          <dt>{t("clients.column.limits")}</dt>
                          <dd><span class="nowrap">↓ {rateLabel(device.down_kbps)}</span><br /><span class="nowrap">↑ {rateLabel(device.up_kbps)}</span></dd>
                        </div>
                        <div>
                          <dt>{t("clients.column.peers")}</dt>
                          <dd>{this.vm.peersLabel(device)} · {this.vm.interfaceNames(device)}</dd>
                        </div>
                        <div>
                          <dt>{t("clients.column.owner")}</dt>
                          <dd>{this.vm.userLogin(device.user_id)}</dd>
                        </div>
                      </dl>
                      <div class="entity-card__foot">
                        <button
                          class="btn btn--text btn--sm"
                          type="button"
                          aria-label={t("common.open")} title={t("common.open")}
                          onClick={() => this.vm.openDevice(device.id)}
                        >
                          {t("common.open")} <Icon name="chevron" size={14} class="" />
                        </button>
                      </div>
                    </article>
                  )}
                </For>
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
                  options={[{ value: "", label: t("clients.form.userPlaceholder") }, ...this.vm.users.map((user) => ({ value: user.id, label: user.login }))]}
                  onChange={(value) => this.vm.setFormUser(value)}
                  ariaLabel={t("clients.form.user")}
                />
              </div>
            </Show>
            <Show when={this.vm.isAdmin}>
              <div class="field">
                <label for="client-interface">{t("clients.form.interface")}</label>
                <Select
                  id="client-interface"
                  value={this.vm.formInterfaceId}
                  options={[{ value: "", label: t("clients.form.interfaceNone") }, ...this.vm.formInterfaceOptions]}
                  onChange={(value) => this.vm.setFormInterface(value)}
                  ariaLabel={t("clients.form.interface")}
                />
                <div class="hint">{t("clients.form.interfaceHint")}</div>
              </div>
            </Show>
            <Show when={!this.vm.isAdmin}>
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
