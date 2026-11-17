import { For, Show } from "@ivlev-dev/silent-core";

import type { StatsVM } from "./StatsPage.vm";
import { AreaChart } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Skeleton, SkeletonCards, SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

export function StatsPage(this: { vm: StatsVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("stats.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("stats.title")}</h1>
            <p>
              {t("stats.subtitle")}
            </p>
          </div>
          <div class="actions-bar">
            <span class={`badge ${this.vm.liveBadgeClass}`}>
              <span
                class={`dot ${this.vm.liveEnabled && this.vm.liveConnected ? "dot--green" : ""}`}
              ></span>
              {this.vm.liveBadgeLabel}
            </span>
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
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>
      <Show when={this.vm.entitiesError}>
        <div class="alert alert--warn">{this.vm.entitiesError}</div>
      </Show>

      <section class="card">
        <div class="card__body stack">
          <div class="grid grid--2">
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
                  <div class="xs muted" style="padding-top:10px">
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
          </div>

          <div class="row-between wrap">
            <div class="tabs">
              <button
                class={`tab ${this.vm.rangeKey === "24h" ? "is-active" : ""}`}
                type="button"
                onClick={() => this.vm.setRange("24h")}
              >
                {t("stats.range.24h")}
              </button>
              <button
                class={`tab ${this.vm.rangeKey === "7d" ? "is-active" : ""}`}
                type="button"
                onClick={() => this.vm.setRange("7d")}
              >
                {t("stats.range.7d")}
              </button>
              <button
                class={`tab ${this.vm.rangeKey === "30d" ? "is-active" : ""}`}
                type="button"
                onClick={() => this.vm.setRange("30d")}
              >
                {t("stats.range.30d")}
              </button>
            </div>

            <label class="switch">
              <input
                type="checkbox"
                checked={this.vm.liveEnabled}
                onChange={() => this.vm.toggleLive()}
              />
              <span class="track"></span>
              <span>{t("stats.live.toggle")}</span>
            </label>
          </div>

          <Show when={this.vm.liveError}>
            <div class="alert alert--warn">{this.vm.liveError}</div>
          </Show>
        </div>
      </section>

      <Show when={this.vm.initialized} fallback={<SkeletonCards count={4} />}>
        <div class="grid grid--4">
          <div class="stat">
            <div class="stat__label">
              <span class="dot dot--green"></span>{t("stats.card.rx")}
            </div>
            <div class="stat__value">{this.vm.totalRxLabel}</div>
            <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
          </div>
          <div class="stat">
            <div class="stat__label">
              <span class="dot" style="background:var(--brand-3)"></span>{t("stats.card.tx")}
            </div>
            <div class="stat__value">{this.vm.totalTxLabel}</div>
            <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
          </div>
          <div class="stat">
            <div class="stat__label">{t("stats.card.points")}</div>
            <div class="stat__value">{this.vm.points}</div>
            <div class="stat__hint">{this.vm.periodLabel}</div>
          </div>
          <div class="stat">
            <div class="stat__label">{t("stats.card.liveToday")}</div>
            <div class="stat__value">{this.vm.liveEnabled ? this.vm.liveTodayTotal : "—"}</div>
            <div class="stat__hint">
              {this.vm.liveEnabled
                ? t("stats.card.liveHint", { rx: this.vm.liveTodayRx, tx: this.vm.liveTodayTx })
                : t("stats.card.liveHintOff")}
            </div>
          </div>
        </div>
      </Show>

      <section class="card">
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
        <div class="card__body" aria-busy={this.vm.seriesLoading || !this.vm.initialized ? "true" : "false"}>
          <Show
            when={this.vm.seriesLoading || !this.vm.initialized}
            fallback={
              <Show
                when={this.vm.series.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">{t("stats.chart.emptyTitle")}</div>
                    <div class="small">
                      {t("stats.chart.emptyText")}
                    </div>
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

      <Show when={this.vm.liveEnabled}>
        <section class="card">
          <div class="card__body row-between wrap">
            <div>
              <div class="xs muted">{t("stats.livePanel.title")}</div>
              <div class="strong mono">{this.vm.liveTodayTotal}</div>
            </div>
            <div>
              <div class="xs muted">{t("stats.livePanel.rx")}</div>
              <div class="strong mono">{this.vm.liveTodayRx}</div>
            </div>
            <div>
              <div class="xs muted">{t("stats.livePanel.tx")}</div>
              <div class="strong mono">{this.vm.liveTodayTx}</div>
            </div>
            <div>
              <div class="xs muted">{t("stats.livePanel.month")}</div>
              <div class="strong mono">{this.vm.liveMonthTotal}</div>
            </div>
          </div>
        </section>
      </Show>

      <section class="card card--flush" aria-busy={this.vm.devicesLoading || !this.vm.initialized ? "true" : "false"}>
        <div class="card__head">
          <div>
            <div class="card__title">{t("stats.devices.title")}</div>
            <div class="card__sub">{t("stats.devices.subtitle")}</div>
          </div>
          <button
            class="btn btn--sm"
            type="button"
            disabled={this.vm.devicesLoading}
            onClick={() => this.vm.refresh()}
          >
            <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
          </button>
        </div>
        <Show
          when={this.vm.devicesLoading || !this.vm.initialized}
          fallback={
            <Show
              when={this.vm.deviceRowsView.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__title">{t("stats.devices.emptyTitle")}</div>
                  <div class="small">{t("stats.devices.emptyText")}</div>
                </div>
              }
            >
              <div class="table-wrap">
                <table class="table table--cards">
                  <thead>
                    <tr>
                      <th>{t("stats.devices.column.device")}</th>
                      <th>{t("stats.devices.column.todayRx")}</th>
                      <th>{t("stats.devices.column.todayTx")}</th>
                      <th>{t("stats.devices.column.monthRx")}</th>
                      <th>{t("stats.devices.column.monthTx")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.deviceRowsView}>
                      {(row) => (
                        <tr>
                          <td data-label={t("stats.devices.column.device")}>
                            <div class="stack-sm">
                              <span class="strong">{row.name}</span>
                              <span class="xs muted truncate">{row.addresses || "—"}</span>
                            </div>
                          </td>
                          <td data-label={t("stats.devices.column.todayRx")} class="mono">{row.todayRx}</td>
                          <td data-label={t("stats.devices.column.todayTx")} class="mono">{row.todayTx}</td>
                          <td data-label={t("stats.devices.column.monthRx")} class="mono">{row.monthRx}</td>
                          <td data-label={t("stats.devices.column.monthTx")} class="mono">{row.monthTx}</td>
                          <td>
                            <Show
                              when={row.failed}
                              fallback={
                                <button
                                  class="btn btn--sm btn--ghost"
                                  type="button"
                                  onClick={() => this.vm.openDevice(row.id)}
                                >
                                  {t("stats.devices.open")}
                                </button>
                              }
                            >
                              <span class="badge badge--amber">{t("stats.devices.noData")}</span>
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
