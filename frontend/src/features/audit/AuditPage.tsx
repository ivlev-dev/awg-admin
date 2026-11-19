import { For, Show } from "@ivlev-dev/silent-core";

import type { AuditPageVM } from "./AuditPage.vm";
import { AuditDetailsDrawer } from "@/components/AuditDetailsDrawer";
import { ErrorState } from "@/components/ErrorState";
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
        <ErrorState message={this.vm.error ?? ""} onRetry={() => this.vm.refresh()} />
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
              <button
                class="btn btn--sm"
                type="button"
                disabled={!this.vm.hasActiveFilters}
                onClick={() => this.vm.openPresetForm()}
              >
                <Icon name="plus" size={14} class="" /> {t("audit.presets.save")}
              </button>
              <Show when={this.vm.presets.length > 0}>
                <div class="preset-anchor">
                  <button
                    class="btn btn--sm"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={this.vm.presetMenuOpen ? "true" : "false"}
                    onClick={() => this.vm.togglePresetMenu()}
                  >
                    <Icon name="chevron" size={14} class="" /> {t("audit.presets.apply")}
                  </button>
                  <Show when={this.vm.presetMenuOpen}>
                    <div class="preset-backdrop" onClick={() => this.vm.closePresetMenu()}></div>
                    <div class="preset-menu" role="menu">
                      <Show
                        when={this.vm.presets.length > 0}
                        fallback={<div class="preset-menu__empty">{t("audit.presets.empty")}</div>}
                      >
                        <For each={this.vm.presets}>
                          {(preset) => (
                            <div class="preset-menu__row">
                              <button
                                class="preset-menu__item"
                                type="button"
                                role="menuitem"
                                title={preset.name}
                                onClick={() => void this.vm.applyPreset(preset.id)}
                              >
                                <span class="preset-menu__name">{preset.name}</span>
                              </button>
                              <button
                                class="preset-menu__remove"
                                type="button"
                                aria-label={t("audit.presets.delete")}
                                title={t("audit.presets.delete")}
                                onClick={() => this.vm.deletePreset(preset.id)}
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Show>
              <button
                class="btn btn--sm btn--danger"
                type="button"
                disabled={!this.vm.canClear}
                onClick={() => this.vm.clearFiltered()}
              >
                <Icon name="trash" size={14} class="" /> {t("audit.clear")}
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
                placeholder="admin@local"
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

        <Show when={this.vm.presetFormOpen}>
          <div class="preset-form">
            <div class="field">
              <label for="audit-preset-name">{t("audit.presets.name")}</label>
              <input
                id="audit-preset-name"
                class="input"
                type="text"
                maxlength="80"
                placeholder={t("audit.presets.placeholder")}
                value={this.vm.presetName}
                onInput={(event: Event) => this.vm.setPresetName(event)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    this.vm.savePreset();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    this.vm.closePresetForm();
                  }
                }}
              />
            </div>
            <button
              class="btn btn--primary btn--sm"
              type="button"
              disabled={!this.vm.canSavePreset}
              onClick={() => this.vm.savePreset()}
            >
              {t("common.saveShort")}
            </button>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.closePresetForm()}>
              {t("common.cancelShort")}
            </button>
          </div>
        </Show>

        <Show when={this.vm.activeFilterChips.length > 0}>
          <div class="filter-chips">
            <For each={this.vm.activeFilterChips}>
              {(chip) => (
                <span class="filter-chip">
                  {chip.label}
                  <button
                    type="button"
                    aria-label={t("audit.filter.remove", { label: chip.label })}
                    title={t("audit.filter.remove", { label: chip.label })}
                    onClick={() => this.vm.clearFilter(chip.key)}
                  >
                    ×
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>

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
                <table class="table table--cards table--audit table--fixed table--desktop">
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
                            <div class="audit-details-cell">
                              <span class="small muted audit-details-cell__preview" title={row.details ?? undefined}>
                                {row.detailsPreview}
                              </span>
                              <button
                                class="btn btn--sm btn--ghost audit-details-cell__open"
                                type="button"
                                onClick={() => this.vm.openDetails(row)}
                              >
                                {t("audit.drawer.show")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <div class="entity-list">
                  <For each={this.vm.rows}>
                    {(row) => (
                      <article class="entity-card">
                        <div class="entity-card__head">
                          <span class="cell-avatar">{actorInitial(row.actor)}</span>
                          <div class="entity-card__title">
                            <span class="entity-card__name">{row.actor} · {row.action}</span>
                            <span class="entity-card__sub" title={row.entityId ?? undefined}>
                              {row.entityLabel}
                            </span>
                          </div>
                          <span class={`status-chip status-chip--${statusTone(row.status)}`}>
                            <span class="status-chip__dot"></span>
                            {row.status}
                          </span>
                        </div>
                        <dl class="entity-card__meta">
                          <div>
                            <dt>{t("audit.column.time")}</dt>
                            <dd><span class="mono">{splitAt(row.at).date}</span>{" "}<span class="muted">{splitAt(row.at).time}</span></dd>
                          </div>
                          <div>
                            <dt>{t("audit.column.ip")}</dt>
                            <dd class="mono">{row.ip}</dd>
                          </div>
                          <div>
                            <dt>{t("audit.column.entity")}</dt>
                            <dd title={row.entityId ?? undefined}>{row.entityLabel}</dd>
                          </div>
                          <div>
                            <dt>{t("audit.column.status")}</dt>
                            <dd>{row.status}</dd>
                          </div>
                          <div class="entity-card__wide">
                            <dt>{t("audit.column.details")}</dt>
                            <dd>
                              <div class="audit-details-cell">
                                <span class="small muted audit-details-cell__preview" title={row.details ?? undefined}>
                                  {row.detailsPreview}
                                </span>
                                <button
                                  class="btn btn--sm btn--ghost audit-details-cell__open"
                                  type="button"
                                  onClick={() => this.vm.openDetails(row)}
                                >
                                  {t("audit.drawer.show")}
                                </button>
                              </div>
                            </dd>
                          </div>
                        </dl>
                      </article>
                    )}
                  </For>
                </div>
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

      <AuditDetailsDrawer
        row={this.vm.detailsRow}
        onClose={() => this.vm.closeDetails()}
        onCopy={(row) => {
          void this.vm.copyDetails(row);
        }}
      />
    </div>
  );
}
