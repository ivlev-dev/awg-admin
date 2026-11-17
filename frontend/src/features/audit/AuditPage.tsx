import { For, Show } from "@ivlev-dev/silent-core";

import type { AuditPageVM } from "./AuditPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

function statusTone(status: number): string {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  if (status >= 200 && status < 300) return "ok";
  return "info";
}

function splitAt(value: string): { date: string; time: string } {
  const index = value.indexOf(",");
  return index === -1
    ? { date: value, time: "" }
    : { date: value.slice(0, index), time: value.slice(index + 1).trim() };
}

function actorInitial(actor: string): string {
  const trimmed = actor.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}

export function AuditPage(this: { vm: AuditPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("audit.eyebrow")}</div>
        <h1>{t("audit.title")}</h1>
        <p>{t("audit.subtitle")}</p>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section
        class="card card--flush"
        aria-busy={this.vm.loading || !this.vm.initialized ? "true" : "false"}
      >
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">{t("audit.log.title")}</div>
              <div class="data-toolbar__sub">{this.vm.loadedLabel}</div>
            </div>
            <div class="data-toolbar__actions">
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

          <div class="data-toolbar__bottom">
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
            <div class="data-toolbar__spacer"></div>
            <button
              class="btn btn--primary btn--sm"
              type="button"
              disabled={this.vm.loading || this.vm.loadingMore}
              onClick={() => this.vm.apply()}
            >
              {t("audit.action.apply")}
            </button>
            <button
              class="btn btn--sm"
              type="button"
              disabled={this.vm.loading || this.vm.loadingMore}
              onClick={() => this.vm.reset()}
            >
              {t("audit.action.reset")}
            </button>
          </div>
        </div>

        <Show
          when={!this.vm.loading && this.vm.initialized}
          fallback={
            <div class="card__body">
              <SkeletonTable rows={6} columns={7} />
            </div>
          }
        >
          <Show
            when={this.vm.isEmpty}
            fallback={
              <div class="data-scroll">
                <table class="table table--cards table--audit table--fixed">
                  <thead>
                    <tr>
                      <th class="col-time">{t("audit.column.time")}</th>
                      <th class="col-actor">{t("audit.column.actor")}</th>
                      <th class="col-action">{t("audit.column.action")}</th>
                      <th class="col-entity">{t("audit.column.entity")}</th>
                      <th class="col-status">{t("audit.column.status")}</th>
                      <th class="col-ip">{t("audit.column.ip")}</th>
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
                          <td class="col-actor" data-label={t("audit.column.actor")}>
                            <div class="cell-name">
                              <span class="cell-avatar">{actorInitial(row.actor)}</span>
                              <span class="cell-name__text">
                                <span class="strong cell-entity" title={row.actorId ?? undefined}>
                                  {row.actor}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td class="col-action" data-label={t("audit.column.action")}>
                            <span class="mono small">{row.action}</span>
                          </td>
                          <td class="col-entity" data-label={t("audit.column.entity")}>
                            <span class="cell-entity" title={row.entityId ?? undefined}>{row.entityLabel}</span>
                          </td>
                          <td class="col-status" data-label={t("audit.column.status")}>
                            <span class={`status-chip status-chip--${statusTone(row.status)}`}>
                              <span class="status-chip__dot"></span>
                              {row.status}
                            </span>
                          </td>
                          <td class="col-ip" data-label="IP">
                            <span class="small mono">{row.ip}</span>
                          </td>
                          <td class="cell-details col-details" data-label={t("audit.column.details")}>
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
              <div class="empty__icon">
                <Icon name="clock" size={24} class="" />
              </div>
              <div class="empty__title">{t("audit.empty.title")}</div>
              <div class="empty__text">{t("audit.empty.text")}</div>
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
          <div class="card__foot">
            <div class="row" style="justify-content:center">
              <button
                class="btn btn--sm"
                type="button"
                disabled={this.vm.loadingMore}
                onClick={() => this.vm.loadMore()}
              >
                {this.vm.loadingMore ? t("common.loading") : t("audit.loadMore")}
              </button>
            </div>
          </div>
        </Show>
      </section>
    </div>
  );
}
