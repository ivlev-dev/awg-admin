import { For, Show } from "@ivlev-dev/silent-core";

import type { AuditPageVM } from "./AuditPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";

export function AuditPage(this: { vm: AuditPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Безопасность</div>
        <div class="row-between wrap">
          <div>
            <h1>Аудит</h1>
            <p>Журнал действий администраторов и изменения конфигурации панели.</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" disabled={this.vm.loading} onClick={() => this.vm.refresh()}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
            <button
              class="btn btn--sm"
              type="button"
              disabled={!this.vm.canExport}
              onClick={() => this.vm.exportCsv()}
            >
              <Icon name="download" size={14} class="" /> Экспорт CSV
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card">
        <div class="card__body stack">
          <div class="grid grid--3">
            <div class="field">
              <label for="audit-action">Действие</label>
              <Select
                id="audit-action"
                value={this.vm.action}
                options={this.vm.actionOptions}
                onChange={(value) => this.vm.setAction(value)}
                ariaLabel="Действие"
              />
            </div>
            <div class="field">
              <label for="audit-status">Статус</label>
              <Select
                id="audit-status"
                value={this.vm.status}
                options={this.vm.statusOptions}
                onChange={(value) => this.vm.setStatus(value)}
                ariaLabel="Статус"
              />
            </div>
            <div class="field">
              <label for="audit-entity">Объект</label>
              <input
                id="audit-entity"
                class="input"
                type="text"
                placeholder="devices"
                value={this.vm.entity}
                onInput={(event: Event) => this.vm.setEntity(event)}
              />
            </div>
            <div class="field">
              <label for="audit-actor">Актор</label>
              <input
                id="audit-actor"
                class="input"
                type="text"
                placeholder="admin"
                value={this.vm.actor}
                onInput={(event: Event) => this.vm.setActor(event)}
              />
            </div>
            <div class="field">
              <label for="audit-from">С периода</label>
              <input
                id="audit-from"
                class="input"
                type="datetime-local"
                value={this.vm.from}
                onInput={(event: Event) => this.vm.setFrom(event)}
              />
            </div>
            <div class="field">
              <label for="audit-to">По</label>
              <input
                id="audit-to"
                class="input"
                type="datetime-local"
                value={this.vm.to}
                onInput={(event: Event) => this.vm.setTo(event)}
              />
            </div>
          </div>
          <div class="row wrap" style="gap:8px">
            <button
              class="btn btn--primary"
              type="button"
              disabled={this.vm.loading || this.vm.loadingMore}
              onClick={() => this.vm.apply()}
            >
              Применить
            </button>
            <button
              class="btn"
              type="button"
              disabled={this.vm.loading || this.vm.loadingMore}
              onClick={() => this.vm.reset()}
            >
              Сбросить
            </button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">Журнал</div>
            <div class="card__sub">Загружено событий: {this.vm.total}</div>
          </div>
        </div>
        <div class="card__body">
          <Show when={!this.vm.loading} fallback={<div class="skeleton" style="height:180px"></div>}>
            <Show
              when={!this.vm.isEmpty}
              fallback={
                <div class="empty">
                  <div class="empty__title">Событий нет</div>
                  <div class="small">Измените фильтры или выберите другой период.</div>
                </div>
              }
            >
              <div class="table-wrap">
                <table class="table table--cards">
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>Актор</th>
                      <th>Действие</th>
                      <th>Объект</th>
                      <th>Статус</th>
                      <th>IP</th>
                      <th>Детали</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.rows}>
                      {(row) => (
                        <tr>
                          <td data-label="Время">
                            <span class="small nowrap mono">{row.at}</span>
                          </td>
                          <td data-label="Актор">
                            <span class="strong" title={row.actorId ?? undefined}>{row.actor}</span>
                          </td>
                          <td data-label="Действие">
                            <span class="mono small">{row.action}</span>
                          </td>
                          <td data-label="Объект">
                            <span title={row.entityId ?? undefined}>{row.entityLabel}</span>
                          </td>
                          <td data-label="Статус">
                            <span class={`badge ${row.statusClass}`}>{row.status}</span>
                          </td>
                          <td data-label="IP">
                            <span class="small mono">{row.ip}</span>
                          </td>
                          <td data-label="Детали">
                            <Show
                              when={row.hasDetails}
                              fallback={<span class="small muted">{row.detailsPreview}</span>}
                            >
                              <button
                                class="audit-details"
                                type="button"
                                aria-expanded={this.vm.expandedId === row.id}
                                title={row.details ?? undefined}
                                onClick={() => this.vm.toggleDetails(row.id)}
                              >
                                <span
                                  class={`audit-details__text ${
                                    this.vm.expandedId === row.id ? "" : "audit-details__text--clamped"
                                  }`}
                                >
                                  {row.details ?? row.detailsPreview}
                                </span>
                              </button>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>

          <Show when={this.vm.hasMore && !this.vm.loading}>
            <div class="row" style="justify-content:center;padding-top:var(--sp-4)">
              <button
                class="btn btn--sm"
                type="button"
                disabled={this.vm.loadingMore}
                onClick={() => this.vm.loadMore()}
              >
                {this.vm.loadingMore ? "Загрузка…" : "Загрузить ещё"}
              </button>
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
}
