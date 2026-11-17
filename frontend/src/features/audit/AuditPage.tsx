import { For, Show } from "@ivlev-dev/silent-core";

import type { AuditPageVM } from "./AuditPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

export function AuditPage(this: { vm: AuditPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("audit.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("audit.title")}</h1>
            <p>{t("audit.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" disabled={this.vm.loading} onClick={() => this.vm.refresh()}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
            <button
              class="btn btn--sm"
              type="button"
              disabled={!this.vm.canExport}
              onClick={() => this.vm.exportCsv()}
            >
              <Icon name="download" size={14} class="" /> {t("audit.export")}
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
              <label for="audit-action">{t("audit.filter.action")}</label>
              <Select
                id="audit-action"
                value={this.vm.action}
                options={this.vm.actionOptions}
                onChange={(value) => this.vm.setAction(value)}
                ariaLabel={t("audit.filter.action")}
              />
            </div>
            <div class="field">
              <label for="audit-status">{t("audit.filter.status")}</label>
              <Select
                id="audit-status"
                value={this.vm.status}
                options={this.vm.statusOptions}
                onChange={(value) => this.vm.setStatus(value)}
                ariaLabel={t("audit.filter.status")}
              />
            </div>
            <div class="field">
              <label for="audit-entity">{t("audit.filter.entity")}</label>
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
              <label for="audit-actor">{t("audit.filter.actor")}</label>
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
              <label for="audit-from">{t("audit.filter.from")}</label>
              <input
                id="audit-from"
                class="input"
                type="datetime-local"
                value={this.vm.from}
                onInput={(event: Event) => this.vm.setFrom(event)}
              />
            </div>
            <div class="field">
              <label for="audit-to">{t("audit.filter.to")}</label>
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
              {t("audit.action.apply")}
            </button>
            <button
              class="btn"
              type="button"
              disabled={this.vm.loading || this.vm.loadingMore}
              onClick={() => this.vm.reset()}
            >
              {t("audit.action.reset")}
            </button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">{t("audit.log.title")}</div>
            <div class="card__sub">{this.vm.loadedLabel}</div>
          </div>
        </div>
        <div class="card__body" aria-busy={this.vm.loading || !this.vm.initialized ? "true" : "false"}>
          <Show
            when={!this.vm.loading && this.vm.initialized}
            fallback={<SkeletonTable rows={6} columns={7} />}
          >
            <Show
              when={this.vm.isEmpty}
              fallback={
                <div class="table-wrap table-wrap--cards">
                  <table class="table table--cards table--audit">
                    <thead>
                      <tr>
                        <th>{t("audit.column.time")}</th>
                        <th>{t("audit.column.actor")}</th>
                        <th>{t("audit.column.action")}</th>
                        <th>{t("audit.column.entity")}</th>
                        <th>{t("audit.column.status")}</th>
                        <th>{t("audit.column.ip")}</th>
                        <th>{t("audit.column.details")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.rows}>
                        {(row) => (
                          <tr>
                            <td data-label={t("audit.column.time")}>
                              <span class="small nowrap mono">{row.at}</span>
                            </td>
                            <td data-label={t("audit.column.actor")}>
                              <span class="strong cell-entity" title={row.actorId ?? undefined}>{row.actor}</span>
                            </td>
                            <td data-label={t("audit.column.action")}>
                              <span class="mono small">{row.action}</span>
                            </td>
                            <td data-label={t("audit.column.entity")}>
                              <span class="cell-entity" title={row.entityId ?? undefined}>{row.entityLabel}</span>
                            </td>
                            <td data-label={t("audit.column.status")}>
                              <span class={`badge ${row.statusClass}`}>{row.status}</span>
                            </td>
                            <td data-label="IP">
                              <span class="small mono">{row.ip}</span>
                            </td>
                            <td class="cell-details" data-label={t("audit.column.details")}>
                              <Show
                                when={row.hasDetails}
                                fallback={<span class="small muted">{row.detailsPreview}</span>}
                              >
                                <button
                                  class="audit-details"
                                  type="button"
                                  aria-expanded={this.vm.expandedId === row.id ? "true" : "false"}
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
              }
            >
              <div class="empty">
                <div class="empty__title">{t("audit.empty.title")}</div>
                <div class="small">{t("audit.empty.text")}</div>
                <Show when={this.vm.hasActiveFilters}>
                  <div style="margin-top:14px">
                    <button class="btn btn--primary btn--sm" type="button" onClick={() => this.vm.reset()}>
                      <Icon name="close" size={14} class="" /> {t("filters.reset")}
                    </button>
                  </div>
                </Show>
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
                {this.vm.loadingMore ? t("common.loading") : t("audit.loadMore")}
              </button>
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
}
