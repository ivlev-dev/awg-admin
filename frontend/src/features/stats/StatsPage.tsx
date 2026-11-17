import { For, Show } from "@ivlev-dev/silent-core";

import type { StatsVM } from "./StatsPage.vm";
import { AreaChart } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Skeleton, SkeletonCards, SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

function avatarLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function StatsPage(this: { vm: StatsVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("stats.eyebrow")}</div>
        <h1>{t("stats.title")}</h1>
        <p>{t("stats.subtitle")}</p>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>
      <Show when={this.vm.entitiesError}>
        <div class="alert alert--warn">{this.vm.entitiesError}</div>
      </Show>

      <section class="card card--flush">
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">{this.vm.selectedScopeLabel}</div>
              <div class="data-toolbar__sub">{this.vm.periodLabel}</div>
            </div>
            <div class="data-toolbar__actions">
              <button
                class="btn btn--sm"
                type="button"
                disabled={this.vm.seriesLoading}
                onClick={() => this.vm.refresh()}
              >
                <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
              </button>
              <button class="btn btn--sm" type="button" onClick={() => this.vm.exportCsv()}>
                <Icon name="download" size={14} class="" /> CSV
              </button>
            </div>
          </div>

          <div class="data-toolbar__bottom">
            <div class="field">
              <label for="stats-scope">{t("stats.scope.label")}</label>
              <Select
                id="stats-scope"
                value={this.vm.scope}
                options={this.vm.scopeOptions.map((option) => ({ value: option.value, label: option.label }))}
                onChange={(value) => this.vm.setScope(value)}
                ariaLabel={t("stats.scope.label")}
              />
            </div>

            <Show
              when={this.vm.requiresEntity}
              fallback={
                <div class="field">
                  <label>{t("stats.detail.label")}</label>
                  <div class="small muted" style="padding-top:8px">
                    {this.vm.isAdmin
                      ? t("stats.detail.admin")
                      : t("stats.detail.user")}
                  </div>
                </div>
              }
            >
              <div class="field">
                <label for="stats-entity">{this.vm.entityLabel}</label>
                <Select
                  id="stats-entity"
                  value={this.vm.entityId ?? ""}
                  options={this.vm.entityOptions.map((option) => ({ value: option.id, label: option.label }))}
                  onChange={(value) => this.vm.setEntity(value)}
                  disabled={this.vm.entitiesLoading || this.vm.entityOptions.length === 0}
                  placeholder={t("stats.entity.placeholder")}
                  ariaLabel={this.vm.entityLabel}
                />
              </div>
            </Show>

            <div class="data-toolbar__spacer"></div>

            <button
              class={`chip ${this.vm.rangeKey === "24h" ? "is-selected" : ""}`}
              type="button"
              aria-pressed={this.vm.rangeKey === "24h" ? "true" : "false"}
              onClick={() => this.vm.setRange("24h")}
            >
              <Icon name="check" size={14} class="chip__check" /> {t("stats.range.24h")}
            </button>
            <button
              class={`chip ${this.vm.rangeKey === "7d" ? "is-selected" : ""}`}
              type="button"
              aria-pressed={this.vm.rangeKey === "7d" ? "true" : "false"}
              onClick={() => this.vm.setRange("7d")}
            >
              <Icon name="check" size={14} class="chip__check" /> {t("stats.range.7d")}
            </button>
            <button
              class={`chip ${this.vm.rangeKey === "30d" ? "is-selected" : ""}`}
              type="button"
              aria-pressed={this.vm.rangeKey === "30d" ? "true" : "false"}
              onClick={() => this.vm.setRange("30d")}
            >
              <Icon name="check" size={14} class="chip__check" /> {t("stats.range.30d")}
            </button>
          </div>
        </div>
      </section>

      <Show when={this.vm.initialized} fallback={<SkeletonCards count={4} />}>
        <div class="grid grid--4">
          <div class="stat">
            <div class="stat__top" style="justify-content:flex-start">
              <div class="stat__icon"><Icon name="arrowDown" size={22} class="" /></div>
              <div class="stat__label">{t("stats.card.rx")}</div>
            </div>
            <div class="stat__value">{this.vm.totalRxLabel}</div>
            <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
          </div>
          <div class="stat">
            <div class="stat__top" style="justify-content:flex-start">
              <div class="stat__icon"><Icon name="arrowUp" size={22} class="" /></div>
              <div class="stat__label">{t("stats.card.tx")}</div>
            </div>
            <div class="stat__value">{this.vm.totalTxLabel}</div>
            <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
          </div>
          <div class="stat">
            <div class="stat__top" style="justify-content:flex-start">
              <div class="stat__icon"><Icon name="stats" size={22} class="" /></div>
              <div class="stat__label">{t("stats.card.average")}</div>
            </div>
            <div class="stat__value">{this.vm.averageRxLabel}</div>
            <div class="stat__hint">
              {t("stats.card.averageHint", { tx: this.vm.averageTxLabel })}
            </div>
          </div>
          <div class="stat">
            <div class="stat__top" style="justify-content:flex-start">
              <div class="stat__icon"><Icon name="traffic" size={22} class="" /></div>
              <div class="stat__label">{t("stats.card.points")}</div>
            </div>
            <div class="stat__value">{this.vm.points}</div>
            <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
          </div>
        </div>
      </Show>

      <section
        class="card card--elevated"
        aria-busy={this.vm.seriesLoading || !this.vm.initialized ? "true" : "false"}
      >
        <div class="card__head">
          <div>
            <div class="card__title">{t("stats.chart.title")}</div>
            <div class="card__sub">
              {this.vm.periodLabel} · {this.vm.selectedScopeLabel}
            </div>
          </div>
          <div class="chart__legend no-mobile">
            <span><i style="background:var(--accent)"></i>{t("stats.chart.rx")}</span>
            <span><i style="background:var(--brand-3)"></i>{t("stats.chart.tx")}</span>
          </div>
        </div>
        <div class="card__body">
          <Show
            when={this.vm.seriesLoading || !this.vm.initialized}
            fallback={
              <Show
                when={this.vm.series.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__icon"><Icon name="traffic" size={28} class="" /></div>
                    <div class="empty__title">{t("stats.chart.emptyTitle")}</div>
                    <div class="empty__text">{t("stats.chart.emptyText")}</div>
                  </div>
                }
              >
                <AreaChart data={this.vm.series} />
              </Show>
            }
          >
            <Skeleton height={220} />
          </Show>
        </div>
      </section>

      <section
        class="card card--flush"
        aria-busy={this.vm.devicesLoading || !this.vm.initialized ? "true" : "false"}
      >
        <div class="card__head">
          <div>
            <div class="card__title">{t("stats.devices.breakdown")}</div>
            <div class="card__sub">{t("stats.devices.subtitle")}</div>
          </div>
        </div>
        <Show
          when={this.vm.devicesLoading || !this.vm.initialized}
          fallback={
            <Show
              when={this.vm.deviceRowsView.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__icon"><Icon name="clients" size={28} class="" /></div>
                  <div class="empty__title">{t("stats.devices.emptyTitle")}</div>
                  <div class="empty__text">{t("stats.devices.emptyText")}</div>
                </div>
              }
            >
              <div class="data-scroll">
                <table class="table table--cards table--fixed">
                  <thead>
                    <tr>
                      <th>{t("stats.devices.column.device")}</th>
                      <th style="width:132px">{t("stats.devices.column.todayRx")}</th>
                      <th style="width:132px">{t("stats.devices.column.todayTx")}</th>
                      <th style="width:132px">{t("stats.devices.column.monthRx")}</th>
                      <th style="width:132px">{t("stats.devices.column.monthTx")}</th>
                      <th style="width:116px"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.deviceRowsView}>
                      {(row) => (
                        <tr>
                          <td data-label={t("stats.devices.column.device")}>
                            <div class="cell-name">
                              <span class="cell-avatar">{avatarLetter(row.name)}</span>
                              <span class="cell-name__text">
                                <span class="strong" title={row.name}>{row.name}</span>
                                <span class="xs muted truncate">{row.addresses || "—"}</span>
                              </span>
                            </div>
                          </td>
                          <td data-label={t("stats.devices.column.todayRx")} class="mono">{row.todayRx}</td>
                          <td data-label={t("stats.devices.column.todayTx")} class="mono">{row.todayTx}</td>
                          <td data-label={t("stats.devices.column.monthRx")} class="mono">{row.monthRx}</td>
                          <td data-label={t("stats.devices.column.monthTx")} class="mono">{row.monthTx}</td>
                          <td class="cell-actions">
                            <Show
                              when={row.failed}
                              fallback={
                                <button
                                  class="btn btn--text btn--sm"
                                  type="button"
                                  aria-label={t("stats.devices.open")}
                                  onClick={() => this.vm.openDevice(row.id)}
                                >
                                  {t("stats.devices.open")} <Icon name="chevron" size={14} class="" />
                                </button>
                              }
                            >
                              <span class="status-chip status-chip--error">
                                <span class="status-chip__dot"></span>
                                {t("stats.devices.noData")}
                              </span>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          }
        >
          <div class="card__body">
            <SkeletonTable rows={4} columns={6} />
          </div>
        </Show>
      </section>
    </div>
  );
}
