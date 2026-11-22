import { For, Show } from "@ivlev-dev/silent-core";

import type { TariffsPageVM, TariffsSortKey } from "./TariffsPage.vm";
import { BulkBar } from "@/components/BulkBar";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { RateField } from "@/components/RateField";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import type { SortState } from "@/domain/table-sort";
import { t } from "@/i18n";
import { formatBytesI18n, formatRateI18n } from "@/i18n/format";

function ariaSort(sort: SortState<TariffsSortKey> | null, key: TariffsSortKey): "ascending" | "descending" | "none" {
  if (sort === null || sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function TariffsPage(this: { vm: TariffsPageVM }) {
  const form = this.vm.tariffForm;
  const name = form.getFieldProps("name");
  const description = form.getFieldProps("description");
  const maxDevices = form.getFieldProps("maxDevices");
  const interfaceId = form.getFieldProps("interfaceId");
  const deviceDown = form.getFieldProps("deviceDownKbps");
  const deviceUp = form.getFieldProps("deviceUpKbps");
  const groupDown = form.getFieldProps("groupDownKbps");
  const groupUp = form.getFieldProps("groupUpKbps");
  const quotaGb = form.getFieldProps("quotaGb");

  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("tariffs.eyebrow")}</div>
        <h1>{t("tariffs.title")}</h1>
        <p>{t("tariffs.subtitle")}</p>
      </div>

      <Show when={this.vm.error && this.vm.tariffs.length > 0}>
        <ErrorState message={this.vm.error ?? ""} onRetry={() => { void this.vm.load(); }} />
      </Show>

      <section class="card card--flush" aria-busy={this.vm.loading || this.vm.refreshing ? "true" : "false"}>
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">{t("tariffs.table.title")}</div>
              <div class="data-toolbar__sub">{t("tariffs.total", { count: this.vm.tariffs.length })}</div>
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
                <Icon name="plus" size={16} class="" /> {t("tariffs.new")}
              </button>
            </div>
          </div>
        </div>

        <Show
          when={!this.vm.loading}
          fallback={
            <div class="card__body">
              <SkeletonTable rows={5} columns={9} />
            </div>
          }
        >
          <div class="card__body" style="padding-bottom:0">
            <div class="list-toolbar">
              <div class="field">
                <label for="tariffs-search">{t("tariffs.search.label")}</label>
                <input
                  id="tariffs-search"
                  class="input"
                  type="search"
                  aria-label={t("tariffs.search.label")}
                  placeholder={t("tariffs.search.placeholder")}
                  value={this.vm.search}
                  onInput={(event: Event) => this.vm.setSearch(event)}
                />
              </div>
              <Show when={this.vm.searchActive}>
                <span class="small muted" aria-live="polite">{this.vm.foundLabel}</span>
                <button class="btn btn--text btn--sm" type="button" onClick={() => this.vm.resetSearch()}>
                  <Icon name="close" size={14} class="" /> {t("filters.reset")}
                </button>
              </Show>
            </div>
          </div>

          <Show
            when={!(this.vm.error && this.vm.tariffs.length === 0)}
            fallback={
              <div class="empty" role="alert">
                <Icon name="warning" size={40} class="empty__icon" />
                <div class="empty__title">{t("tariffs.error.load")}</div>
                <div class="empty__text">{this.vm.error}</div>
                <div style="margin-top:16px">
                  <button class="btn btn--primary btn--sm" type="button" onClick={() => { void this.vm.load(); }}>
                    <Icon name="refresh" size={14} class="" /> {t("common.retry")}
                  </button>
                </div>
              </div>
            }
          >
            <Show
              when={this.vm.visible.length > 0}
              fallback={
                <div class="empty">
                  <Icon name="tariffs" size={40} class="empty__icon" />
                  <div class="empty__title">
                    {this.vm.searchActive ? t("filters.emptyTitle") : t("tariffs.empty.title")}
                  </div>
                  <div class="empty__text">
                    {this.vm.searchActive ? t("filters.emptyText") : t("tariffs.empty.text")}
                  </div>
                  <div style="margin-top:16px">
                    <Show
                      when={this.vm.searchActive}
                      fallback={
                        <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                          <Icon name="plus" size={16} class="" /> {t("tariffs.new")}
                        </button>
                      }
                    >
                      <button class="btn btn--outlined btn--sm" type="button" onClick={() => this.vm.resetSearch()}>
                        <Icon name="close" size={14} class="" /> {t("filters.reset")}
                      </button>
                    </Show>
                  </div>
                </div>
              }
            >
              <div class="data-scroll">
                <table class="table table--cards table--tariffs" aria-label={t("tariffs.table.title")}>
                  <thead>
                    <tr>
                      <th class="cell-select">
                        <input
                          type="checkbox"
                          aria-label={t("tariffs.selectAll")}
                          checked={this.vm.allVisibleSelected}
                          onChange={() => this.vm.toggleSelectAll()}
                        />
                      </th>
                      <th class="is-sortable col-tariff-name" aria-sort={ariaSort(this.vm.sort, "name")}>
                        <button type="button" onClick={() => this.vm.sortBy("name")}>
                          {t("tariffs.column.name")} <span class="sort-indicator">{this.vm.sortMark("name")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-interface" aria-sort={ariaSort(this.vm.sort, "interface_name")}>
                        <button type="button" onClick={() => this.vm.sortBy("interface_name")}>
                          {t("tariffs.column.interface")} <span class="sort-indicator">{this.vm.sortMark("interface_name")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-devices" aria-sort={ariaSort(this.vm.sort, "max_devices")}>
                        <button type="button" onClick={() => this.vm.sortBy("max_devices")}>
                          {t("tariffs.column.maxDevices")} <span class="sort-indicator">{this.vm.sortMark("max_devices")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-rate" aria-sort={ariaSort(this.vm.sort, "device_down_kbps")}>
                        <button type="button" onClick={() => this.vm.sortBy("device_down_kbps")}>
                          {t("tariffs.column.deviceDown")} <span class="sort-indicator">{this.vm.sortMark("device_down_kbps")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-rate" aria-sort={ariaSort(this.vm.sort, "device_up_kbps")}>
                        <button type="button" onClick={() => this.vm.sortBy("device_up_kbps")}>
                          {t("tariffs.column.deviceUp")} <span class="sort-indicator">{this.vm.sortMark("device_up_kbps")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-rate" aria-sort={ariaSort(this.vm.sort, "group_down_kbps")}>
                        <button type="button" onClick={() => this.vm.sortBy("group_down_kbps")}>
                          {t("tariffs.column.groupDown")} <span class="sort-indicator">{this.vm.sortMark("group_down_kbps")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-rate" aria-sort={ariaSort(this.vm.sort, "group_up_kbps")}>
                        <button type="button" onClick={() => this.vm.sortBy("group_up_kbps")}>
                          {t("tariffs.column.groupUp")} <span class="sort-indicator">{this.vm.sortMark("group_up_kbps")}</span>
                        </button>
                      </th>
                      <th class="is-sortable col-quota" aria-sort={ariaSort(this.vm.sort, "traffic_quota_bytes")}>
                        <button type="button" onClick={() => this.vm.sortBy("traffic_quota_bytes")}>
                          {t("tariffs.column.quota")} <span class="sort-indicator">{this.vm.sortMark("traffic_quota_bytes")}</span>
                        </button>
                      </th>
                      <th class="col-actions" aria-label={t("tariffs.column.actions")}></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.visible}>
                      {(tariff) => (
                        <tr class={this.vm.isSelected(tariff.id) ? "is-selected" : ""}>
                          <td class="cell-select">
                            <input
                              type="checkbox"
                              aria-label={t("tariffs.selectRow", { name: tariff.name })}
                              checked={this.vm.isSelected(tariff.id)}
                              onChange={() => this.vm.toggleSelected(tariff.id)}
                            />
                          </td>
                          <td class="col-tariff-name" data-label={t("tariffs.column.name")}>
                            <div class="cell-name">
                              <span class="cell-name__text">
                                <span class="strong">{tariff.name}</span>
                                <Show when={tariff.description}>
                                  <div class="xs muted">{tariff.description}</div>
                                </Show>
                              </span>
                            </div>
                          </td>
                          <td class="col-interface" data-label={t("tariffs.column.interface")}>
                            {tariff.interface_name ?? "—"}
                          </td>
                          <td class="col-devices mono" data-label={t("tariffs.column.maxDevices")}>{tariff.max_devices}</td>
                          <td class="col-rate mono" data-label={t("tariffs.column.deviceDown")}>
                            {formatRateI18n(tariff.device_down_kbps)}
                          </td>
                          <td class="col-rate mono" data-label={t("tariffs.column.deviceUp")}>
                            {formatRateI18n(tariff.device_up_kbps)}
                          </td>
                          <td class="col-rate mono" data-label={t("tariffs.column.groupDown")}>
                            {formatRateI18n(tariff.group_down_kbps)}
                          </td>
                          <td class="col-rate mono" data-label={t("tariffs.column.groupUp")}>
                            {formatRateI18n(tariff.group_up_kbps)}
                          </td>
                          <td class="col-quota mono" data-label={t("tariffs.column.quota")}>
                            {tariff.traffic_quota_bytes === null
                              ? t("tariffs.quota.unlimited")
                              : formatBytesI18n(tariff.traffic_quota_bytes)}
                          </td>
                          <td class="cell-actions col-actions">
                            <div class="row" style="gap:6px">
                              <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openEdit(tariff)} aria-label={t("tariffs.action.edit")} title={t("tariffs.action.edit")}>
                                <Icon name="edit" size={14} class="" />
                              </button>
                              <button class="btn btn--sm btn--danger btn--icon" type="button" onClick={() => { void this.vm.remove(tariff.id); }} aria-label={t("tariffs.action.delete")} title={t("tariffs.action.delete")}>
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
        </Show>
      </section>

      <Show when={this.vm.selectedCount > 0}>
        <BulkBar
          count={this.vm.selectedCount}
          busy={this.vm.bulkBusy}
          onClear={() => this.vm.clearSelection()}
          actions={[
            { label: t("tariffs.bulk.delete"), variant: "danger", onClick: () => { void this.vm.bulkDelete(); } },
          ]}
        />
      </Show>

      <Modal
        open={this.vm.modalOpen}
        title={this.vm.title}
        onClose={() => { void this.vm.closeModal(); }}
        describedBy={this.vm.formError ? "tariffs-form-error" : undefined}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => { void this.vm.closeModal(); }} disabled={this.vm.saving}>
              {t("common.cancelShort")}
            </button>
            <button class="btn btn--primary" type="submit" form="tariffs-form" disabled={this.vm.saving}>
              <Show when={this.vm.saving} fallback={<span>{t("common.saveShort")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("common.saving")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <form
          id="tariffs-form"
          class="stack"
          noValidate
          onSubmit={(event: Event) => {
            event.preventDefault();
            void this.vm.submit();
          }}
        >
          <div class="grid grid--2">
            <div class="field">
              <label for="tariff-name">{t("tariffs.form.name")}</label>
              <input
                id="tariff-name"
                class="input"
                type="text"
                required
                data-autofocus
                aria-invalid={name.error ? "true" : undefined}
                aria-describedby={name.error ? "tariff-name-error" : undefined}
                value={name.value}
                onInput={name.onInput}
              />
              <Show when={name.error}>
                <span class="field-error" id="tariff-name-error" role="alert">{name.error}</span>
              </Show>
            </div>
            <div class="field">
              <label for="tariff-max-devices">{t("tariffs.form.maxDevices")}</label>
              <input
                id="tariff-max-devices"
                class="input"
                type="number"
                min="1"
                max="1000"
                aria-invalid={maxDevices.error ? "true" : undefined}
                aria-describedby={maxDevices.error ? "tariff-max-devices-error" : undefined}
                value={maxDevices.value}
                onInput={maxDevices.onInput}
              />
              <Show when={maxDevices.error}>
                <span class="field-error" id="tariff-max-devices-error" role="alert">{maxDevices.error}</span>
              </Show>
            </div>
          </div>
          <div class="field">
            <label for="tariff-interface">{t("tariffs.form.interface")}</label>
            <Select
              id="tariff-interface"
              value={interfaceId.value}
              options={this.vm.interfaceOptions}
              onChange={(value: string) => interfaceId.setValue(value)}
              ariaLabel={t("tariffs.form.interface")}
              searchable
            />
            <Show
              when={interfaceId.error}
              fallback={<div class="hint">{t("tariffs.form.interfaceHint")}</div>}
            >
              <span class="field-error" id="tariff-interface-error" role="alert">{interfaceId.error}</span>
            </Show>
          </div>
          <div class="field">
            <label for="tariff-description">{t("tariffs.form.description")}</label>
            <textarea
              id="tariff-description"
              class="input"
              rows={2}
              maxlength={500}
              aria-invalid={description.error ? "true" : undefined}
              aria-describedby={description.error ? "tariff-description-error" : undefined}
              value={description.value}
              onInput={description.onInput}
            ></textarea>
            <Show when={description.error}>
              <span class="field-error" id="tariff-description-error" role="alert">{description.error}</span>
            </Show>
          </div>
          <div class="grid grid--2">
            <RateField
              id="tariff-device-down"
              label={t("tariffs.form.deviceDown")}
              value={deviceDown.value}
              hint={t("tariffs.form.rateUnlimited")}
              onChange={(kbps) => deviceDown.setValue(kbps)}
            />
            <RateField
              id="tariff-device-up"
              label={t("tariffs.form.deviceUp")}
              value={deviceUp.value}
              hint={t("tariffs.form.rateUnlimited")}
              onChange={(kbps) => deviceUp.setValue(kbps)}
            />
            <RateField
              id="tariff-group-down"
              label={t("tariffs.form.groupDown")}
              value={groupDown.value}
              hint={t("tariffs.form.rateUnlimited")}
              onChange={(kbps) => groupDown.setValue(kbps)}
            />
            <RateField
              id="tariff-group-up"
              label={t("tariffs.form.groupUp")}
              value={groupUp.value}
              hint={t("tariffs.form.rateUnlimited")}
              onChange={(kbps) => groupUp.setValue(kbps)}
            />
          </div>
          <div class="field">
            <label for="tariff-quota">{t("tariffs.form.quota")}</label>
            <input
              id="tariff-quota"
              class="input"
              type="number"
              min="0"
              step="0.1"
              value={quotaGb.value}
              aria-invalid={quotaGb.error ? "true" : undefined}
              aria-describedby={quotaGb.error ? "tariff-quota-error" : "tariff-quota-hint"}
              onInput={quotaGb.onInput}
            />
            <Show
              when={quotaGb.error}
              fallback={<span class="hint" id="tariff-quota-hint">{t("tariffs.form.quotaHint")}</span>}
            >
              <span class="field-error" id="tariff-quota-error" role="alert">{quotaGb.error}</span>
            </Show>
          </div>
          <Show when={this.vm.formError}>
            <div class="alert alert--error" id="tariffs-form-error" role="alert">{this.vm.formError}</div>
          </Show>
          <button type="submit" class="sr-only">{t("common.saveShort")}</button>
        </form>
      </Modal>
    </div>
  );
}
