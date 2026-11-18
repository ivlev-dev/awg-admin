import { For, Show } from "@ivlev-dev/silent-core";

import type { TariffsPageVM, TariffsSortKey } from "./TariffsPage.vm";
import { BulkBar } from "@/components/BulkBar";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { RateField } from "@/components/RateField";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import { formatBytes, formatRate } from "@/domain/format";
import type { SortState } from "@/domain/table-sort";
import { t } from "@/i18n";

function ariaSort(sort: SortState<TariffsSortKey> | null, key: TariffsSortKey): "ascending" | "descending" | "none" {
  if (sort === null || sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function TariffsPage(this: { vm: TariffsPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Тарифы</div>
        <h1>Тарифы</h1>
        <p>Управление тарифами и лимитами скорости.</p>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card card--flush" aria-busy={this.vm.loading ? "true" : "false"}>
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">Список тарифов</div>
              <div class="data-toolbar__sub">Всего: {this.vm.tariffs.length}</div>
            </div>
            <div class="data-toolbar__actions">
              <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                <Icon name="plus" size={16} class="" /> Новый тариф
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
            when={this.vm.visible.length > 0}
            fallback={
              <div class="empty">
                <Icon name="tariffs" size={40} class="empty__icon" />
                <div class="empty__title">
                  {this.vm.searchActive ? t("filters.emptyTitle") : "Нет тарифов"}
                </div>
                <div class="empty__text">
                  {this.vm.searchActive ? t("filters.emptyText") : "Создайте первый тариф."}
                </div>
                <div style="margin-top:16px">
                  <Show
                    when={this.vm.searchActive}
                    fallback={
                      <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                        <Icon name="plus" size={16} class="" /> Новый тариф
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
              <table class="table table--cards table--fixed">
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
                    <th class="is-sortable" aria-sort={ariaSort(this.vm.sort, "name")}>
                      <button type="button" onClick={() => this.vm.sortBy("name")}>
                        {t("tariffs.column.name")} <span class="sort-indicator">{this.vm.sortMark("name")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:170px" aria-sort={ariaSort(this.vm.sort, "interface_name")}>
                      <button type="button" onClick={() => this.vm.sortBy("interface_name")}>
                        {t("tariffs.column.interface")} <span class="sort-indicator">{this.vm.sortMark("interface_name")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:110px" aria-sort={ariaSort(this.vm.sort, "max_devices")}>
                      <button type="button" onClick={() => this.vm.sortBy("max_devices")}>
                        {t("tariffs.column.maxDevices")} <span class="sort-indicator">{this.vm.sortMark("max_devices")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:130px" aria-sort={ariaSort(this.vm.sort, "device_down_kbps")}>
                      <button type="button" onClick={() => this.vm.sortBy("device_down_kbps")}>
                        {t("tariffs.column.deviceDown")} <span class="sort-indicator">{this.vm.sortMark("device_down_kbps")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:130px" aria-sort={ariaSort(this.vm.sort, "device_up_kbps")}>
                      <button type="button" onClick={() => this.vm.sortBy("device_up_kbps")}>
                        {t("tariffs.column.deviceUp")} <span class="sort-indicator">{this.vm.sortMark("device_up_kbps")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:130px" aria-sort={ariaSort(this.vm.sort, "group_down_kbps")}>
                      <button type="button" onClick={() => this.vm.sortBy("group_down_kbps")}>
                        {t("tariffs.column.groupDown")} <span class="sort-indicator">{this.vm.sortMark("group_down_kbps")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:130px" aria-sort={ariaSort(this.vm.sort, "group_up_kbps")}>
                      <button type="button" onClick={() => this.vm.sortBy("group_up_kbps")}>
                        {t("tariffs.column.groupUp")} <span class="sort-indicator">{this.vm.sortMark("group_up_kbps")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" style="width:130px" aria-sort={ariaSort(this.vm.sort, "traffic_quota_bytes")}>
                      <button type="button" onClick={() => this.vm.sortBy("traffic_quota_bytes")}>
                        {t("tariffs.column.quota")} <span class="sort-indicator">{this.vm.sortMark("traffic_quota_bytes")}</span>
                      </button>
                    </th>
                    <th style="width:110px" aria-label={t("tariffs.column.actions")}></th>
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
                        <td data-label={t("tariffs.column.name")}>
                          <div class="cell-name">
                            <span class="cell-name__text">
                              <span class="strong">{tariff.name}</span>
                              <Show when={tariff.description}>
                                <div class="xs muted">{tariff.description}</div>
                              </Show>
                            </span>
                          </div>
                        </td>
                        <td data-label={t("tariffs.column.interface")}>
                          {tariff.interface_name ?? "—"}
                        </td>
                        <td data-label={t("tariffs.column.maxDevices")} class="mono">{tariff.max_devices}</td>
                        <td data-label={t("tariffs.column.deviceDown")} class="mono">
                          {formatRate(tariff.device_down_kbps)}
                        </td>
                        <td data-label={t("tariffs.column.deviceUp")} class="mono">
                          {formatRate(tariff.device_up_kbps)}
                        </td>
                        <td data-label={t("tariffs.column.groupDown")} class="mono">
                          {formatRate(tariff.group_down_kbps)}
                        </td>
                        <td data-label={t("tariffs.column.groupUp")} class="mono">
                          {formatRate(tariff.group_up_kbps)}
                        </td>
                        <td data-label={t("tariffs.column.quota")} class="mono">
                          {tariff.traffic_quota_bytes === null
                            ? t("tariffs.quota.unlimited")
                            : formatBytes(tariff.traffic_quota_bytes)}
                        </td>
                        <td class="cell-actions">
                          <div class="row" style="gap:6px">
                            <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openEdit(tariff)} aria-label="Редактировать">
                              <Icon name="edit" size={14} class="" />
                            </button>
                            <button class="btn btn--sm btn--danger btn--icon" type="button" onClick={() => this.vm.remove(tariff.id)} aria-label="Удалить">
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
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => { void this.vm.closeModal(); }} disabled={this.vm.saving}>
              Отмена
            </button>
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
              <label>Название</label>
              <input class="input" type="text" value={this.vm.name} onInput={(event: Event) => this.vm.setName(event)} />
            </div>
            <div class="field">
              <label>Макс. устройств</label>
              <input class="input" type="number" min="1" value={this.vm.max_devices} onInput={(event: Event) => this.vm.setMaxDevices(event)} />
            </div>
          </div>
          <div class="field">
            <label for="tariff-interface">{t("tariffs.form.interface")}</label>
            <Select
              id="tariff-interface"
              value={this.vm.formInterfaceId}
              options={this.vm.interfaceOptions}
              onChange={(value: string) => this.vm.setFormInterface(value)}
              ariaLabel={t("tariffs.form.interface")}
            />
            <div class="hint">{t("tariffs.form.interfaceHint")}</div>
          </div>
          <div class="field">
            <label>Описание</label>
            <textarea class="input" rows={2} value={this.vm.description} onInput={(event: Event) => this.vm.setDescription(event)}></textarea>
          </div>
          <div class="grid grid--2">
            <RateField
              id="tariff-device-down"
              label="Устр. скачивание"
              value={this.vm.device_down_kbps}
              hint="0 — без лимита"
              onChange={(kbps) => this.vm.setDeviceDownKbps(kbps)}
            />
            <RateField
              id="tariff-device-up"
              label="Устр. отдача"
              value={this.vm.device_up_kbps}
              hint="0 — без лимита"
              onChange={(kbps) => this.vm.setDeviceUpKbps(kbps)}
            />
            <RateField
              id="tariff-group-down"
              label="Группа скачивание"
              value={this.vm.group_down_kbps}
              hint="0 — без лимита"
              onChange={(kbps) => this.vm.setGroupDownKbps(kbps)}
            />
            <RateField
              id="tariff-group-up"
              label="Группа отдача"
              value={this.vm.group_up_kbps}
              hint="0 — без лимита"
              onChange={(kbps) => this.vm.setGroupUpKbps(kbps)}
            />
          </div>
          <div class="field">
            <label>Квота трафика, ГБ (0/пусто = безлимит)</label>
            <input class="input" type="number" min="0" step="0.1" value={this.vm.quotaGb} onInput={(event: Event) => this.vm.setQuota(event)} />
          </div>
          <Show when={this.vm.formError}>
            <div class="alert alert--error">{this.vm.formError}</div>
          </Show>
        </div>
      </Modal>
    </div>
  );
}
