import { For, Show } from "@ivlev-dev/silent-core";

import type { GroupsPageVM } from "./GroupsPage.vm";
import { BulkBar } from "@/components/BulkBar";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { t } from "@/i18n";

function fromInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, input, textarea, select, a") !== null;
}

function onCardKeyDown(event: KeyboardEvent, open: () => void): void {
  if (event.key === "Enter" || event.key === " ") {
    if (fromInteractive(event.target)) return;
    event.preventDefault();
    open();
    return;
  }
  if (
    event.key !== "ArrowRight" &&
    event.key !== "ArrowDown" &&
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowUp"
  ) {
    return;
  }
  if (!(event.currentTarget instanceof HTMLElement)) return;
  if (focusSiblingCard(event.currentTarget, event.key)) event.preventDefault();
}

function focusSiblingCard(current: HTMLElement, key: string): boolean {
  const grid = current.closest(".grid");
  if (grid === null) return false;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>("article[tabindex]"));
  const index = cards.indexOf(current);
  if (index < 0) return false;
  const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const next = cards[index + delta];
  if (next === undefined) return false;
  next.focus();
  return true;
}

export function GroupsPage(this: { vm: GroupsPageVM }) {
  const form = (
    <form id="group-form" class="stack" onSubmit={(event: Event) => this.vm.save(event)}>
      <div class="field">
        <label for="group-name">{t("groups.form.name")}</label>
        <input
          id="group-name"
          class="input"
          type="text"
          placeholder={t("groups.form.namePlaceholder")}
          value={this.vm.formName}
          onInput={(event: Event) => this.vm.setName(event)}
        />
      </div>
      <div class="field">
        <label for="group-description">{t("groups.form.description")}</label>
        <textarea
          id="group-description"
          class="textarea"
          placeholder={t("groups.form.descriptionPlaceholder")}
          value={this.vm.formDescription}
          onInput={(event: Event) => this.vm.setDescription(event)}
        ></textarea>
      </div>
      <div class="field">
        <label for="group-cidr">{t("groups.form.baseCidr")}</label>
        <input
          id="group-cidr"
          class="input mono"
          type="text"
          placeholder="10.8.0.0/16"
          value={this.vm.formBaseCidr}
          onInput={(event: Event) => this.vm.setBaseCidr(event)}
        />
        <span class="hint">{t("groups.form.baseCidrHint")}</span>
      </div>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={this.vm.formForwarding}
          onChange={(event: Event) => this.vm.setForwarding(event)}
        />
        <span>{t("groups.forwardingDefault")}</span>
      </label>
      <Show when={this.vm.formError}>
        <div class="alert alert--error">{this.vm.formError}</div>
      </Show>
    </form>
  );

  const footer = (
    <div class="actions-bar">
      <button class="btn" type="button" onClick={() => { void this.vm.closeModal(); }} disabled={this.vm.saving}>
        {t("common.cancelShort")}
      </button>
      <button class="btn btn--primary" type="submit" form="group-form" disabled={!this.vm.canSave}>
        {this.vm.saving ? t("common.saving") : t("common.saveShort")}
      </button>
    </div>
  );

  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("groups.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("groups.title")}</h1>
            <p>{t("groups.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
            <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
              <Icon name="plus" size={14} class="" /> {t("groups.create")}
            </button>
          </div>
        </div>
        <Show when={!this.vm.loading && this.vm.groups.length > 0}>
          <div class="row-between wrap" style="margin-top:12px">
            <label class="checkbox">
              <input
                type="checkbox"
                checked={this.vm.allSelected}
                indeterminate={this.vm.someSelected}
                onChange={() => this.vm.toggleSelectAll()}
              />
              <span>{t("groups.selectAll")}</span>
            </label>
            <span class="small muted">{t("bulk.selected", { count: this.vm.selectedCount })}</span>
          </div>
        </Show>
      </div>

      <Show when={this.vm.error}>
        <ErrorState message={this.vm.error ?? ""} onRetry={() => this.vm.load()} />
      </Show>

      <Show
        when={!this.vm.loading}
        fallback={
          <div class="grid grid--3">
            <div class="skeleton" style="height:190px"></div>
            <div class="skeleton" style="height:190px"></div>
            <div class="skeleton" style="height:190px"></div>
          </div>
        }
      >
        <Show
          when={this.vm.groups.length > 0}
          fallback={
            <div class="empty">
              <Icon name="groups" size={40} class="empty__icon" />
              <div class="empty__title">{t("groups.empty.title")}</div>
              <div class="small">{t("groups.empty.text")}</div>
              <div style="margin-top:16px">
                <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                  <Icon name="plus" size={16} class="" /> {t("groups.create")}
                </button>
              </div>
            </div>
          }
        >
          <div class="grid grid--3">
            <For each={this.vm.groups}>
              {(group) => (
                <article
                  class="card"
                  tabindex={0}
                  role="link"
                  aria-label={t("groups.card.openAria", { name: group.name })}
                  onKeyDown={(event: KeyboardEvent) => onCardKeyDown(event, () => this.vm.open(group))}
                >
                  <div class="card__body stack-sm">
                    <div class="row-between">
                      <div class="row" style="min-width:0">
                        <label class="checkbox" title={t("groups.selectAria", { name: group.name })}>
                          <input
                            type="checkbox"
                            aria-label={t("groups.selectAria", { name: group.name })}
                            checked={this.vm.isSelected(group.id)}
                            onChange={() => this.vm.toggleSelected(group.id)}
                          />
                        </label>
                        <div class="card__title truncate">{group.name}</div>
                      </div>
                      <Show when={group.forwarding_default}>
                        <span class="badge badge--blue">forwarding_default</span>
                      </Show>
                    </div>
                    <div class="small muted">{group.description || t("groups.noDescription")}</div>
                    <hr class="divider" />
                    <dl class="kv">
                      <dt>{t("groups.baseCidr")}</dt>
                      <dd class="mono">{group.base_cidr}</dd>
                      <dt>{t("groups.interfaces")}</dt>
                      <dd>{group.interfaces}</dd>
                      <dt>{t("groups.devices")}</dt>
                      <dd>{group.devices}</dd>
                    </dl>
                  </div>
                  <div class="card__foot row-between">
                    <button class="btn btn--sm btn--tonal" type="button" onClick={() => this.vm.open(group)}>
                      {t("groups.action.open")}
                    </button>
                    <div class="actions-bar">
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("groups.action.editAria")}
                        onClick={() => this.vm.openEdit(group)}
                      >
                        <Icon name="edit" size={14} class="" />
                      </button>
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("groups.action.deleteAria")}
                        onClick={() => this.vm.remove(group)}
                      >
                        <Icon name="trash" size={14} class="" />
                      </button>
                    </div>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={this.vm.selectedCount > 0}>
        <BulkBar
          count={this.vm.selectedCount}
          busy={this.vm.bulkBusy}
          onClear={() => this.vm.clearSelection()}
          actions={[
            {
              label: t("groups.bulk.delete"),
              variant: "danger",
              disabled: this.vm.bulkBusy,
              onClick: () => { void this.vm.bulkDelete(); },
            },
          ]}
        />
      </Show>

      <Modal
        open={this.vm.modalOpen}
        title={this.vm.modalTitle}
        onClose={() => { void this.vm.closeModal(); }}
        footer={footer}
      >
        {form}
      </Modal>
    </div>
  );
}
