import { For, Show } from "@ivlev-dev/silent-core";

import type { StatsVM } from "./StatsPage.vm";
import { AreaChart } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";

export function StatsPage(this: { vm: StatsVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Аналитика</div>
        <div class="row-between wrap">
          <div>
            <h1>Статистика</h1>
            <p>
              Трафик по пользователям, группам, интерфейсам и устройствам за выбранный период.
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
              <Icon name="refresh" size={14} class="" /> Обновить
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
              <label for="stats-scope">Область статистики</label>
              <Select
                id="stats-scope"
                value={this.vm.scope}
                options={this.vm.scopeOptions.map((option) => ({ value: option.value, label: option.label }))}
                onChange={(value) => this.vm.setScope(value)}
                ariaLabel="Область статистики"
              />
            </div>

            <Show
              when={this.vm.requiresEntity}
              fallback={
                <div class="field">
                  <label>Детализация</label>
                  <div class="xs muted" style="padding-top:10px">
                    {this.vm.isAdmin
                      ? "Сводка по всем устройствам"
                      : "Статистика вашего аккаунта"}
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
                  placeholder="Нет доступных сущностей"
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
                24 часа
              </button>
              <button
                class={`tab ${this.vm.rangeKey === "7d" ? "is-active" : ""}`}
                type="button"
                onClick={() => this.vm.setRange("7d")}
              >
                7 дней
              </button>
              <button
                class={`tab ${this.vm.rangeKey === "30d" ? "is-active" : ""}`}
                type="button"
                onClick={() => this.vm.setRange("30d")}
              >
                30 дней
              </button>
            </div>

            <label class="switch">
              <input
                type="checkbox"
                checked={this.vm.liveEnabled}
                onChange={() => this.vm.toggleLive()}
              />
              <span class="track"></span>
              <span>Live</span>
            </label>
          </div>

          <Show when={this.vm.liveError}>
            <div class="alert alert--warn">{this.vm.liveError}</div>
          </Show>
        </div>
      </section>

      <div class="grid grid--4">
        <div class="stat">
          <div class="stat__label">
            <span class="dot dot--green"></span>Принято
          </div>
          <div class="stat__value">{this.vm.totalRxLabel}</div>
          <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
        </div>
        <div class="stat">
          <div class="stat__label">
            <span class="dot" style="background:var(--brand-3)"></span>Передано
          </div>
          <div class="stat__value">{this.vm.totalTxLabel}</div>
          <div class="stat__hint">{this.vm.periodLabel} · {this.vm.selectedScopeLabel}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Точек на графике</div>
          <div class="stat__value">{this.vm.points}</div>
          <div class="stat__hint">{this.vm.periodLabel}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Live сегодня</div>
          <div class="stat__value">{this.vm.liveEnabled ? this.vm.liveTodayTotal : "—"}</div>
          <div class="stat__hint">
            {this.vm.liveEnabled
              ? `rx ${this.vm.liveTodayRx} · tx ${this.vm.liveTodayTx}`
              : "включите Live-режим"}
          </div>
        </div>
      </div>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">Трафик</div>
            <div class="card__sub">
              {this.vm.periodLabel} · {this.vm.selectedScopeLabel}
            </div>
          </div>
          <div class="chart__legend no-mobile">
            <span><i style="background:var(--accent)"></i>Входящий</span>
            <span><i style="background:var(--brand-3)"></i>Исходящий</span>
          </div>
        </div>
        <div class="card__body">
          <Show
            when={this.vm.seriesLoading}
            fallback={
              <Show
                when={this.vm.series.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">Нет данных за период</div>
                    <div class="small">
                      Выберите другую область или диапазон, либо обновите статистику.
                    </div>
                  </div>
                }
              >
                <AreaChart data={this.vm.series} />
              </Show>
            }
          >
            <div class="skeleton" style="height:220px"></div>
          </Show>
        </div>
      </section>

      <Show when={this.vm.liveEnabled}>
        <section class="card">
          <div class="card__body row-between wrap">
            <div>
              <div class="xs muted">Сегодня (live)</div>
              <div class="strong mono">{this.vm.liveTodayTotal}</div>
            </div>
            <div>
              <div class="xs muted">Принято</div>
              <div class="strong mono">{this.vm.liveTodayRx}</div>
            </div>
            <div>
              <div class="xs muted">Передано</div>
              <div class="strong mono">{this.vm.liveTodayTx}</div>
            </div>
            <div>
              <div class="xs muted">Месяц</div>
              <div class="strong mono">{this.vm.liveMonthTotal}</div>
            </div>
          </div>
        </section>
      </Show>

      <section class="card card--flush">
        <div class="card__head">
          <div>
            <div class="card__title">Устройства</div>
            <div class="card__sub">Сегодня и текущий месяц</div>
          </div>
          <button
            class="btn btn--sm"
            type="button"
            disabled={this.vm.devicesLoading}
            onClick={() => this.vm.refresh()}
          >
            <Icon name="refresh" size={14} class="" /> Обновить
          </button>
        </div>
        <Show
          when={this.vm.devicesLoading}
          fallback={
            <Show
              when={this.vm.deviceRowsView.length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__title">Устройств нет</div>
                  <div class="small">Создайте клиента, и здесь появится его трафик.</div>
                </div>
              }
            >
              <div class="table-wrap">
                <table class="table table--cards">
                  <thead>
                    <tr>
                      <th>Устройство</th>
                      <th>Сегодня вход</th>
                      <th>Сегодня исход</th>
                      <th>Месяц вход</th>
                      <th>Месяц исход</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.deviceRowsView}>
                      {(row) => (
                        <tr>
                          <td data-label="Устройство">
                            <div class="stack-sm">
                              <span class="strong">{row.name}</span>
                              <span class="xs muted truncate">{row.addresses || "—"}</span>
                            </div>
                          </td>
                          <td data-label="Сегодня вход" class="mono">{row.todayRx}</td>
                          <td data-label="Сегодня исход" class="mono">{row.todayTx}</td>
                          <td data-label="Месяц вход" class="mono">{row.monthRx}</td>
                          <td data-label="Месяц исход" class="mono">{row.monthTx}</td>
                          <td>
                            <Show
                              when={row.failed}
                              fallback={
                                <button
                                  class="btn btn--sm btn--ghost"
                                  type="button"
                                  onClick={() => this.vm.openDevice(row.id)}
                                >
                                  Открыть
                                </button>
                              }
                            >
                              <span class="badge badge--amber">нет данных</span>
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
            <div class="skeleton" style="height:120px"></div>
          </div>
        </Show>
      </section>
    </div>
  );
}
