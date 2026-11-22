import { Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

export function GroupStep(props: { vm: ImportVM }) {
  const vm = props.vm;
  const form = vm.groupForm;
  const groupName = form.getFieldProps("groupName");
  const groupDescription = form.getFieldProps("groupDescription");
  const baseCidr = form.getFieldProps("baseCidr");
  const node = form.getFieldProps("nodeId");
  const owner = form.getFieldProps("ownerUserId");
  return (
    <section class="card card--elevated">
      <div class="card__head">
        <div>
          <div class="card__title">{t("import.group.title")}</div>
          <div class="card__sub">{t("import.group.subtitle")}</div>
        </div>
        <span class={`status-chip ${vm.groupValid ? "status-chip--ok" : "status-chip--warn"}`}>
          <span class="status-chip__dot"></span>
          {vm.groupValid ? t("import.badge.ready") : t("import.badge.fillFields")}
        </span>
      </div>
      <div class="card__body stack">
        <div class="grid grid--2">
          <div class="field">
            <label for="import-group-name">{t("import.field.groupName")}</label>
            <input
              id="import-group-name"
              class={`input ${groupName.error ? "is-invalid" : ""}`}
              type="text"
              placeholder={t("import.field.groupNamePlaceholder")}
              value={groupName.value}
              aria-invalid={groupName.error !== undefined}
              onInput={groupName.onInput}
              onBlur={groupName.onBlur}
            />
            <Show when={groupName.error}>
              <div class="hint" style="color:var(--md-error)">{groupName.error}</div>
            </Show>
          </div>
          <div class="field">
            <label for="import-base-cidr">{t("import.field.baseCidr")}</label>
            <input
              id="import-base-cidr"
              class={`input mono ${baseCidr.error ? "is-invalid" : ""}`}
              type="text"
              placeholder="10.8.0.0/24"
              value={baseCidr.value}
              aria-invalid={
                baseCidr.error !== undefined ||
                (vm.baseCidr.trim().length > 0 && vm.baseCidrError !== null)
              }
              onInput={baseCidr.onInput}
              onBlur={(event: Event) => {
                vm.normalizeBaseCidr();
                baseCidr.onBlur(event);
              }}
            />
            <Show
              when={
                baseCidr.error ??
                (vm.baseCidr.trim().length > 0 ? vm.baseCidrError : null)
              }
            >
              <div class="hint" style="color:var(--md-error)">
                {baseCidr.error ?? vm.baseCidrError}
              </div>
            </Show>
          </div>
        </div>

        <div class="field">
          <label for="import-group-description">{t("import.field.groupDescription")}</label>
          <input
            id="import-group-description"
            class={`input ${groupDescription.error ? "is-invalid" : ""}`}
            type="text"
            placeholder={t("import.field.groupDescriptionPlaceholder")}
            value={groupDescription.value}
            aria-invalid={groupDescription.error !== undefined}
            onInput={groupDescription.onInput}
            onBlur={groupDescription.onBlur}
          />
          <Show when={groupDescription.error}>
            <div class="hint" style="color:var(--md-error)">{groupDescription.error}</div>
          </Show>
        </div>

        <div class="list-toolbar">
          <div class="field field--compact">
            <label for="import-node">{t("import.field.node")}</label>
            <Show
              when={!vm.nodesLoading}
              fallback={<div class="skeleton" style="height:40px"></div>}
            >
              <Select
                id="import-node"
                value={node.value}
                options={vm.nodeOptions}
                onChange={(value) => vm.setNode(value)}
                disabled={vm.nodes.length === 0}
                placeholder={t("import.nodes.empty")}
                ariaLabel={t("import.field.node")}
                searchable
              />
            </Show>
            <Show when={node.error}>
              <div class="hint" style="color:var(--md-error)">{node.error}</div>
            </Show>
            <Show when={vm.nodesError}>
              <div class="hint" style="color:var(--md-error)">{vm.nodesError}</div>
            </Show>
            <Show when={!vm.nodesLoading && vm.nodes.length === 0}>
              <button class="btn btn--sm btn--ghost" type="button" onClick={() => vm.openNodes()}>
                {t("import.action.nodes")}
              </button>
            </Show>
          </div>

          <div class="field field--compact">
            <label for="import-owner">{t("import.field.owner")}</label>
            <Show
              when={!vm.ownersLoading}
              fallback={<div class="skeleton" style="height:40px"></div>}
            >
              <Select
                id="import-owner"
                value={owner.value}
                options={vm.ownerOptions}
                onChange={(value) => vm.setOwner(value)}
                disabled={vm.owners.length === 0}
                placeholder={t("import.owner.none")}
                ariaLabel={t("import.field.owner")}
                searchable
              />
            </Show>
            <Show when={owner.error}>
              <div class="hint" style="color:var(--md-error)">{owner.error}</div>
            </Show>
            <Show when={vm.ownersError}>
              <div class="hint" style="color:var(--md-error)">{vm.ownersError}</div>
            </Show>
          </div>
        </div>
      </div>
      <div class="card__foot actions-bar">
        <div class="data-toolbar__actions">
          <button class="btn" type="button" onClick={() => vm.reset()}>
            {t("import.action.reset")}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            disabled={!vm.groupValid}
            onClick={() => vm.next()}
          >
            {t("import.action.next")}
          </button>
        </div>
      </div>
    </section>
  );
}
